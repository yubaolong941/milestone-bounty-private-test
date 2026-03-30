import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createHash } from 'crypto'
import { queryMysql } from '@/lib/db'
import { loadRequirementBindings, saveRequirementBindings } from '@/lib/storage'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import { RequirementBinding, RequirementBindingSource, TaskBounty } from '@/lib/types'

export const REQUIREMENT_ID_PATTERN = /\bREQ-\d{8}-\d{3}\b/i
export const LARK_URL_PATTERN = /https?:\/\/[^\s]+(?:larksuite\.com|feishu\.cn|feishu\.com)[^\s)]*/i

export interface RequirementBindingSnapshot {
  bindingId?: string
  requirementId?: string
  title: string
  larkDocUrl?: string
  larkDocTitle?: string
  meegleIssueId?: string
  meegleUrl?: string
  githubRepo?: string
  githubIssueNumber?: number
  githubIssueUrl?: string
  acceptanceCriteriaSnapshot: string[]
  summarySnapshot: string
}

function toMysqlDate(value?: string) {
  return (value || new Date().toISOString()).slice(0, 23).replace('T', ' ')
}

function toIso(value: unknown) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value)).toISOString()
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function mapRequirementBindingRow(row: RowDataPacket): RequirementBinding {
  const binding = parseJson<RequirementBinding>(row.binding_json, {} as RequirementBinding)
  return {
    ...binding,
    id: String(row.id),
    requirementId: String(row.requirement_id),
    title: String(row.title || binding.title || ''),
    companyId: row.company_id ? String(row.company_id) : binding.companyId,
    companyName: row.company_name ? String(row.company_name) : binding.companyName,
    larkDocUrl: String(row.lark_doc_url || binding.larkDocUrl || ''),
    larkDocTitle: row.lark_doc_title ? String(row.lark_doc_title) : binding.larkDocTitle,
    meegleIssueId: row.meegle_issue_id ? String(row.meegle_issue_id) : binding.meegleIssueId,
    meegleUrl: row.meegle_url ? String(row.meegle_url) : binding.meegleUrl,
    meegleStatus: row.meegle_status ? String(row.meegle_status) : binding.meegleStatus,
    githubRepo: row.github_repo ? String(row.github_repo) : binding.githubRepo,
    githubIssueNumber: row.github_issue_number !== null && row.github_issue_number !== undefined
      ? Number(row.github_issue_number)
      : binding.githubIssueNumber,
    githubIssueUrl: row.github_issue_url ? String(row.github_issue_url) : binding.githubIssueUrl,
    acceptanceCriteriaSnapshot: parseJson<string[]>(row.acceptance_criteria_json, binding.acceptanceCriteriaSnapshot || []),
    summarySnapshot: String(row.summary_snapshot || binding.summarySnapshot || ''),
    contentVersion: row.content_version ? String(row.content_version) : binding.contentVersion,
    statusVersion: row.status_version ? String(row.status_version) : binding.statusVersion,
    source: (row.source || binding.source) as RequirementBindingSource,
    createdAt: toIso(row.created_at || binding.createdAt),
    updatedAt: toIso(row.updated_at || binding.updatedAt)
  }
}

export function extractRequirementIdCandidate(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue
    const match = value.match(REQUIREMENT_ID_PATTERN)
    if (match?.[0]) return match[0].toUpperCase()
  }
  return undefined
}

export function extractLarkDocUrlCandidate(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue
    const match = value.match(LARK_URL_PATTERN)
    if (match?.[0]) return match[0]
  }
  return undefined
}

export function extractAcceptanceCriteriaCandidate(text: string | undefined): string[] {
  if (!text) return []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const bullets = lines
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+\.)\s+/, '').trim())
    .filter(Boolean)
  if (bullets.length > 0) return Array.from(new Set(bullets))
  return Array.from(new Set(lines.filter((line) => line.length >= 8).slice(0, 5)))
}

export function generateRequirementIdCandidate(tasks: TaskBounty[], now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const prefix = `REQ-${year}${month}${day}-`
  const used = new Set(
    tasks
      .map((task) => task.requirementId)
      .filter((value): value is string => Boolean(value))
      .filter((value) => value.startsWith(prefix))
  )
  let next = 1
  while (used.has(`${prefix}${String(next).padStart(3, '0')}`)) next += 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

export function buildRequirementSummaryCandidate(input: {
  description?: string
  requirementClaritySummary?: string
}): string {
  const summary = input.requirementClaritySummary?.trim()
  if (summary) return summary
  const description = input.description?.trim()
  if (!description) return 'Please refer to the Lark requirements document for full background, flow diagrams, and acceptance criteria.'
  return description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('\n')
}

function inferRequirementBindingSource(task: TaskBounty): RequirementBindingSource {
  if (task.meegleIssueId) return 'meegle_sync'
  if (task.githubIssueUrl) return 'github_issue_sync'
  if (task.source === 'external') return 'task_promote'
  return 'task_create'
}

function toVersionDigest(prefix: string, raw: string) {
  const digest = createHash('sha256').update(raw).digest('hex')
  return `${prefix}:${digest}`
}

function buildContentVersion(task: TaskBounty) {
  const raw = [
    task.requirementDocUrl || '',
    task.requirementDocTitle || '',
    task.requirementSummarySnapshot || task.description || '',
    ...(task.acceptanceCriteriaSnapshot || [])
  ].join('|')
  return toVersionDigest('cv1', raw)
}

function buildStatusVersion(task: TaskBounty) {
  const raw = [
    task.meegleIssueId || '',
    task.meegleUrl || '',
    task.githubIssueNumber ? String(task.githubIssueNumber) : '',
    task.githubIssueUrl || ''
  ].join('|')
  return toVersionDigest('sv1', raw)
}

export function deriveRequirementBindingFromTask(task: TaskBounty): RequirementBinding | null {
  if (!task.requirementId || !task.requirementDocUrl) return null
  const createdAt = task.createdAt || new Date().toISOString()
  const updatedAt = task.updatedAt || createdAt

  return {
    id: task.requirementBindingId || `requirement-${task.requirementId}`,
    requirementId: task.requirementId,
    title: task.requirementDocTitle || task.title,
    companyId: task.companyId,
    companyName: task.companyName,
    larkDocUrl: task.requirementDocUrl,
    larkDocTitle: task.requirementDocTitle,
    meegleIssueId: task.meegleIssueId,
    meegleUrl: task.meegleUrl,
    meegleStatus: undefined,
    githubRepo: task.repo,
    githubIssueNumber: task.githubIssueNumber,
    githubIssueUrl: task.githubIssueUrl,
    acceptanceCriteriaSnapshot: task.acceptanceCriteriaSnapshot || [],
    summarySnapshot: task.requirementSummarySnapshot || task.description || '',
    contentVersion: buildContentVersion(task),
    statusVersion: buildStatusVersion(task),
    source: inferRequirementBindingSource(task),
    createdAt,
    updatedAt
  }
}

export function listRequirementBindings(): RequirementBinding[] {
  return loadRequirementBindings().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getRequirementBindingById(id: string): RequirementBinding | null {
  return loadRequirementBindings().find((item) => item.id === id) ?? null
}

export function getRequirementBindingByRequirementId(requirementId: string): RequirementBinding | null {
  return loadRequirementBindings().find((item) => item.requirementId === requirementId) ?? null
}

export function resolveRequirementBindingForTask(task: TaskBounty): RequirementBinding | null {
  if (task.requirementBindingId) {
    const byId = getRequirementBindingById(task.requirementBindingId)
    if (byId) return byId
  }
  if (task.requirementId) {
    return getRequirementBindingByRequirementId(task.requirementId)
  }
  return null
}

export async function listRequirementBindingsAsync(): Promise<RequirementBinding[]> {
  if (shouldUseFileStorage()) return listRequirementBindings()
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_requirement_bindings ORDER BY updated_at DESC')
  return rows.map(mapRequirementBindingRow)
}

export async function getRequirementBindingByIdAsync(id: string): Promise<RequirementBinding | null> {
  if (shouldUseFileStorage()) return getRequirementBindingById(id)
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_requirement_bindings WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapRequirementBindingRow(rows[0]) : null
}

export async function getRequirementBindingByRequirementIdAsync(requirementId: string): Promise<RequirementBinding | null> {
  if (shouldUseFileStorage()) return getRequirementBindingByRequirementId(requirementId)
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_requirement_bindings WHERE requirement_id = ? LIMIT 1', [requirementId])
  return rows[0] ? mapRequirementBindingRow(rows[0]) : null
}

export async function resolveRequirementBindingForTaskAsync(task: TaskBounty): Promise<RequirementBinding | null> {
  if (task.requirementBindingId) {
    const byId = await getRequirementBindingByIdAsync(task.requirementBindingId)
    if (byId) return byId
  }
  if (task.requirementId) {
    return getRequirementBindingByRequirementIdAsync(task.requirementId)
  }
  return null
}

export function upsertRequirementBinding(item: RequirementBinding): RequirementBinding {
  const items = loadRequirementBindings()
  const index = items.findIndex((existing) => existing.id === item.id || existing.requirementId === item.requirementId)
  if (index >= 0) {
    items[index] = {
      ...items[index],
      ...item,
      id: items[index].id,
      createdAt: items[index].createdAt
    }
  } else {
    items.push(item)
  }
  saveRequirementBindings(items)
  return index >= 0 ? items[index] : item
}

export async function upsertRequirementBindingAsync(item: RequirementBinding): Promise<RequirementBinding> {
  if (shouldUseFileStorage()) {
    return upsertRequirementBinding(item)
  }

  const stored = item
  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_requirement_bindings
      (id, requirement_id, title, company_id, company_name, lark_doc_url, lark_doc_title, meegle_issue_id, meegle_url, meegle_status, github_repo, github_issue_number, github_issue_url, acceptance_criteria_json, summary_snapshot, content_version, status_version, source, binding_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      requirement_id = VALUES(requirement_id),
      title = VALUES(title),
      company_id = VALUES(company_id),
      company_name = VALUES(company_name),
      lark_doc_url = VALUES(lark_doc_url),
      lark_doc_title = VALUES(lark_doc_title),
      meegle_issue_id = VALUES(meegle_issue_id),
      meegle_url = VALUES(meegle_url),
      meegle_status = VALUES(meegle_status),
      github_repo = VALUES(github_repo),
      github_issue_number = VALUES(github_issue_number),
      github_issue_url = VALUES(github_issue_url),
      acceptance_criteria_json = VALUES(acceptance_criteria_json),
      summary_snapshot = VALUES(summary_snapshot),
      content_version = VALUES(content_version),
      status_version = VALUES(status_version),
      source = VALUES(source),
      binding_json = VALUES(binding_json),
      updated_at = VALUES(updated_at)`,
    [
      stored.id,
      stored.requirementId,
      stored.title,
      stored.companyId || null,
      stored.companyName || null,
      stored.larkDocUrl,
      stored.larkDocTitle || null,
      stored.meegleIssueId || null,
      stored.meegleUrl || null,
      stored.meegleStatus || null,
      stored.githubRepo || null,
      stored.githubIssueNumber ?? null,
      stored.githubIssueUrl || null,
      JSON.stringify(stored.acceptanceCriteriaSnapshot || []),
      stored.summarySnapshot,
      stored.contentVersion || null,
      stored.statusVersion || null,
      stored.source,
      JSON.stringify(stored),
      toMysqlDate(stored.createdAt),
      toMysqlDate(stored.updatedAt)
    ]
  )
  return stored
}

export function syncRequirementBindingFromTask(task: TaskBounty): RequirementBinding | null {
  const derived = deriveRequirementBindingFromTask(task)
  if (!derived) return null

  const existing = (task.requirementBindingId && getRequirementBindingById(task.requirementBindingId))
    || getRequirementBindingByRequirementId(derived.requirementId)

  const item = upsertRequirementBinding(existing
    ? {
        ...existing,
        ...derived,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: task.updatedAt || new Date().toISOString()
      }
    : derived)

  task.requirementBindingId = item.id
  return item
}

export async function syncRequirementBindingFromTaskAsync(task: TaskBounty): Promise<RequirementBinding | null> {
  const derived = deriveRequirementBindingFromTask(task)
  if (!derived) return null

  const existing = (task.requirementBindingId && await getRequirementBindingByIdAsync(task.requirementBindingId))
    || await getRequirementBindingByRequirementIdAsync(derived.requirementId)

  const item = await upsertRequirementBindingAsync(existing
    ? {
        ...existing,
        ...derived,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: task.updatedAt || new Date().toISOString()
      }
    : derived)

  task.requirementBindingId = item.id
  return item
}

export function buildRequirementBindingSnapshot(task: TaskBounty): RequirementBindingSnapshot {
  const binding = resolveRequirementBindingForTask(task)
  return {
    bindingId: binding?.id || task.requirementBindingId,
    requirementId: binding?.requirementId || task.requirementId,
    title: binding?.title || task.title,
    larkDocUrl: binding?.larkDocUrl || task.requirementDocUrl,
    larkDocTitle: binding?.larkDocTitle || task.requirementDocTitle || binding?.title,
    meegleIssueId: binding?.meegleIssueId || task.meegleIssueId,
    meegleUrl: binding?.meegleUrl || task.meegleUrl,
    githubRepo: binding?.githubRepo || task.repo,
    githubIssueNumber: binding?.githubIssueNumber || task.githubIssueNumber,
    githubIssueUrl: binding?.githubIssueUrl || task.githubIssueUrl,
    acceptanceCriteriaSnapshot: binding?.acceptanceCriteriaSnapshot || task.acceptanceCriteriaSnapshot || [],
    summarySnapshot: binding?.summarySnapshot || task.requirementSummarySnapshot || task.description || ''
  }
}

export async function buildRequirementBindingSnapshotAsync(task: TaskBounty): Promise<RequirementBindingSnapshot> {
  const binding = await resolveRequirementBindingForTaskAsync(task)
  return {
    bindingId: binding?.id || task.requirementBindingId,
    requirementId: binding?.requirementId || task.requirementId,
    title: binding?.title || task.title,
    larkDocUrl: binding?.larkDocUrl || task.requirementDocUrl,
    larkDocTitle: binding?.larkDocTitle || task.requirementDocTitle || binding?.title,
    meegleIssueId: binding?.meegleIssueId || task.meegleIssueId,
    meegleUrl: binding?.meegleUrl || task.meegleUrl,
    githubRepo: binding?.githubRepo || task.repo,
    githubIssueNumber: binding?.githubIssueNumber || task.githubIssueNumber,
    githubIssueUrl: binding?.githubIssueUrl || task.githubIssueUrl,
    acceptanceCriteriaSnapshot: binding?.acceptanceCriteriaSnapshot || task.acceptanceCriteriaSnapshot || [],
    summarySnapshot: binding?.summarySnapshot || task.requirementSummarySnapshot || task.description || ''
  }
}

export function hydrateTaskRequirementFromBinding(task: TaskBounty) {
  const binding = resolveRequirementBindingForTask(task)
  if (!binding) return task

  task.requirementBindingId = binding.id
  task.requirementId = binding.requirementId
  task.requirementDocUrl = binding.larkDocUrl
  task.requirementDocTitle = binding.larkDocTitle || binding.title
  task.requirementSummarySnapshot = binding.summarySnapshot
  task.acceptanceCriteriaSnapshot = binding.acceptanceCriteriaSnapshot
  task.meegleIssueId = binding.meegleIssueId || task.meegleIssueId
  task.meegleUrl = binding.meegleUrl || task.meegleUrl
  task.githubIssueNumber = binding.githubIssueNumber || task.githubIssueNumber
  task.githubIssueUrl = binding.githubIssueUrl || task.githubIssueUrl
  task.repo = binding.githubRepo || task.repo
  return task
}

export async function hydrateTaskRequirementFromBindingAsync(task: TaskBounty) {
  const binding = await resolveRequirementBindingForTaskAsync(task)
  if (!binding) return task

  task.requirementBindingId = binding.id
  task.requirementId = binding.requirementId
  task.requirementDocUrl = binding.larkDocUrl
  task.requirementDocTitle = binding.larkDocTitle || binding.title
  task.requirementSummarySnapshot = binding.summarySnapshot
  task.acceptanceCriteriaSnapshot = binding.acceptanceCriteriaSnapshot
  task.meegleIssueId = binding.meegleIssueId || task.meegleIssueId
  task.meegleUrl = binding.meegleUrl || task.meegleUrl
  task.githubIssueNumber = binding.githubIssueNumber || task.githubIssueNumber
  task.githubIssueUrl = binding.githubIssueUrl || task.githubIssueUrl
  task.repo = binding.githubRepo || task.repo
  return task
}
