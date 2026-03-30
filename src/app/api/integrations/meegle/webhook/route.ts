import { NextResponse } from 'next/server'
import { TaskBounty } from '@/lib/types'
import {
  fetchMeegleIssuesFromMcp,
  parseGitHubRepoRef,
  updateGitHubIssue,
  updateMeegleIssueFieldsByMcp,
  verifySimpleWebhookSecret
} from '@/lib/integrations'
import { v4 as uuidv4 } from 'uuid'
import { buildWebhookIdempotencyKey, executeWorkflowEvent } from '@/lib/workflow/events'
import { listInternalMemberBindingsDb, listRepoConfigsDb, listTaskBountiesDb, recordIntegrationRunDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'
import { getCompanyById, listCompanies } from '@/lib/access-control-db'
import {
  buildRequirementBindingSnapshotAsync,
  buildRequirementSummaryCandidate,
  extractAcceptanceCriteriaCandidate,
  extractLarkDocUrlCandidate,
  extractRequirementIdCandidate,
  generateRequirementIdCandidate,
  hydrateTaskRequirementFromBindingAsync,
  syncRequirementBindingFromTaskAsync
} from '@/lib/repositories/requirement-binding-repository'

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeScalarString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }
  return undefined
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function extractFieldValueText(value: unknown): string | undefined {
  const scalar = normalizeScalarString(value)
  if (scalar) return scalar
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        const itemScalar = normalizeScalarString(item)
        if (itemScalar) return itemScalar
        const obj = asRecord(item)
        return obj
          ? normalizeScalarString(obj.name) || normalizeScalarString(obj.label) || normalizeScalarString(obj.value) || normalizeScalarString(obj.user_key) || normalizeScalarString(obj.id)
          : undefined
      })
      .filter((item): item is string => Boolean(item))
    return parts.length ? parts.join(', ') : undefined
  }
  const obj = asRecord(value)
  if (!obj) return undefined
  return normalizeScalarString(obj.name)
    || normalizeScalarString(obj.label)
    || normalizeScalarString(obj.value)
    || normalizeScalarString(obj.user_key)
    || normalizeScalarString(obj.id)
}

function extractLabelsFromFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return []
  for (const item of fields) {
    const field = asRecord(item)
    if (!field) continue
    const alias = normalizeOptionalString(field.field_alias) || normalizeOptionalString(field.field_key) || ''
    if (!/(label|tag)/i.test(alias)) continue
    const value = field.field_value
    if (!Array.isArray(value)) {
      const single = extractFieldValueText(value)
      if (single) return [single]
      continue
    }
    const labels = value
      .map((entry) => extractFieldValueText(entry))
      .filter((entry): entry is string => Boolean(entry))
    if (labels.length) return labels
  }
  return []
}

function extractFieldMap(fields: unknown) {
  const map: Record<string, string> = {}
  if (!Array.isArray(fields)) return map
  for (const item of fields) {
    const field = asRecord(item)
    if (!field) continue
    const alias = normalizeOptionalString(field.field_alias) || normalizeOptionalString(field.field_key)
    if (!alias) continue
    const value = extractFieldValueText(field.field_value)
    if (value) map[alias] = value
  }
  return map
}

function collectPayloadCandidates(body: Record<string, unknown>) {
  const nestedKeys = ['data', 'payload', 'object', 'issue', 'workItem', 'work_item', 'node', 'item']
  const candidates: Record<string, unknown>[] = [body]
  for (const key of nestedKeys) {
    const nested = asRecord(body[key])
    if (nested) candidates.push(nested)
  }
  for (const candidate of [...candidates]) {
    for (const key of nestedKeys) {
      const nested = asRecord(candidate[key])
      if (nested && !candidates.includes(nested)) candidates.push(nested)
    }
  }
  return candidates
}

function pickFirstString(candidates: Record<string, unknown>[], keys: string[]) {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = normalizeScalarString(candidate[key])
      if (value) return value
    }
  }
  return undefined
}

function pickLabels(candidates: Record<string, unknown>[]) {
  for (const candidate of candidates) {
    for (const key of ['labels', 'tags', 'tagNames']) {
      const raw = candidate[key]
      if (!Array.isArray(raw)) continue
      const labels = raw
        .map((item) => {
          if (typeof item === 'string') return item.trim()
          const obj = asRecord(item)
          return obj
            ? normalizeOptionalString(obj.name) || normalizeOptionalString(obj.label) || normalizeOptionalString(obj.value) || normalizeOptionalString(obj.title) || ''
            : ''
        })
        .filter(Boolean)
      if (labels.length) return labels
    }
  }
  return [] as string[]
}

function extractMeegleWebhookFields(body: Record<string, unknown>) {
  const candidates = collectPayloadCandidates(body)
  const payload = asRecord(body.payload)
  const fieldMap = extractFieldMap(payload?.fields)
  return {
    issueId: pickFirstString(candidates, ['issueId', 'id', 'workItemId', 'work_item_id', 'nodeId', 'node_id']),
    title: pickFirstString(candidates, ['title', 'name', 'summary']),
    description: pickFirstString(candidates, ['description', 'content', 'body']) || fieldMap.description || fieldMap.desc,
    assignee: pickFirstString(candidates, ['assignee', 'owner', 'executor', 'assigneeName', 'ownerName']) || fieldMap.owner || fieldMap.assignee,
    requirementId: pickFirstString(candidates, ['requirementId', 'requirement_id']) || fieldMap.requirement_id,
    larkDocUrl: pickFirstString(candidates, ['larkDocUrl', 'lark_doc_url']) || fieldMap.lark_doc_url,
    larkDocTitle: pickFirstString(candidates, ['larkDocTitle', 'lark_doc_title']) || fieldMap.lark_doc_title,
    meegleUrl: pickFirstString(candidates, ['url', 'link', 'workItemUrl', 'work_item_url']),
    labels: pickLabels(candidates).length ? pickLabels(candidates) : extractLabelsFromFields(payload?.fields),
    payloadKeys: candidates.map((candidate) => Object.keys(candidate)),
    fieldAliases: Object.keys(fieldMap)
  }
}

function buildIssueTitle(task: TaskBounty): string {
  return task.requirementId && !task.title.includes(task.requirementId)
    ? `[${task.requirementId}] ${task.title}`
    : task.title
}

function buildIssueBody(task: TaskBounty): string {
  const acceptanceCriteria = (task.acceptanceCriteriaSnapshot || []).length
    ? task.acceptanceCriteriaSnapshot || []
    : extractAcceptanceCriteriaCandidate(task.description)
  const summary = task.requirementSummarySnapshot
    || buildRequirementSummaryCandidate(task)

  return [
    '## Summary',
    summary,
    '',
    '## Reference Context',
    `- Reference Doc: ${task.requirementDocUrl || 'Optional, pending'}`,
    `- Requirement ID: ${task.requirementId || 'Pending'}`,
    `- Doc Title: ${task.requirementDocTitle || task.title}`,
    '',
    '## Acceptance Criteria',
    ...(acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((item) => `- [ ] ${item}`)
      : ['- [ ] Refer to the requirement summary, acceptance criteria, and reference materials recorded on the platform']),
    '',
    '## Status Source',
    `- Meegle: ${task.meegleUrl || task.meegleIssueId || 'Pending link'}`,
    '',
    '## Platform Trace',
    `- PlatformTaskId: ${task.id}`
  ].join('\n')
}

async function syncLinksToMeegle(task: TaskBounty): Promise<string[]> {
  const binding = await buildRequirementBindingSnapshotAsync(task)
  if (!binding.meegleIssueId) return []
  const company = task.companyId ? await getCompanyById(task.companyId) : null

  const fields: Array<{ field_key: string; field_value: string | number | boolean }> = []
  if (binding.requirementId) {
    fields.push({
      field_key: process.env.MEEGLE_REQUIREMENT_ID_FIELD_KEY || 'requirement_id',
      field_value: binding.requirementId
    })
  }
  if (binding.larkDocUrl) {
    fields.push({
      field_key: process.env.MEEGLE_LARK_DOC_URL_FIELD_KEY || 'lark_doc_url',
      field_value: binding.larkDocUrl
    })
  }
  if (binding.githubIssueUrl) {
    fields.push({
      field_key: process.env.MEEGLE_GITHUB_ISSUE_URL_FIELD_KEY || 'github_issue_url',
      field_value: binding.githubIssueUrl
    })
  }
  if (typeof binding.githubIssueNumber === 'number') {
    fields.push({
      field_key: process.env.MEEGLE_GITHUB_ISSUE_NUMBER_FIELD_KEY || 'github_issue_number',
      field_value: binding.githubIssueNumber
    })
  }

  if (!fields.length) return []
  const result = await updateMeegleIssueFieldsByMcp(binding.meegleIssueId, fields, {
    token: company?.meegleMcpToken
  })
  return [result.success ? `meegle:${result.detail}` : `meegle_error:${result.detail}`]
}

async function ensureGitHubIssueLinked(taskId: string): Promise<string[]> {
  const tasks = await listTaskBountiesDb()
  const task = tasks.find((item) => item.id === taskId)
  if (!task) return ['task_missing']
  await hydrateTaskRequirementFromBindingAsync(task)
  const binding = await buildRequirementBindingSnapshotAsync(task)
  const repoConfig = task.repoConfigId ? (await listRepoConfigsDb()).find((item) => item.id === task.repoConfigId) : undefined
  if (!binding.larkDocUrl) return ['skip:no_lark_doc']
  if (task.source !== 'external') return ['skip:not_external']
  if (!task.githubIssueNumber || !task.githubRepoOwner || !task.githubRepoName) {
    return ['skip:not_published_to_github']
  }

  const parsedRepo = parseGitHubRepoRef(String(binding.githubRepo || task.repo || ''))
  if (!parsedRepo) return ['skip:no_repo']

  const title = buildIssueTitle(task)
  const body = buildIssueBody(task)

  const updateResult = await updateGitHubIssue({
    owner: task.githubRepoOwner,
    repo: task.githubRepoName,
    issueNumber: task.githubIssueNumber,
    title,
    body,
    labels: task.labels || [],
    tokenRef: repoConfig?.tokenRef
  })
  if (!updateResult.success) return [`github_error:${updateResult.detail}`]
  task.githubIssueId = String(updateResult.issue.issueId)
  task.githubIssueUrl = updateResult.issue.htmlUrl
  task.githubRepoOwner = task.githubRepoOwner || parsedRepo.owner
  task.githubRepoName = task.githubRepoName || parsedRepo.repo
  await syncRequirementBindingFromTaskAsync(task)
  await saveTaskBountiesDb(tasks)
  const meegleResults = await syncLinksToMeegle(task)
  return ['github:updated', ...meegleResults]
}

async function upsertFromIssue(input: {
  issueId: string
  companyId?: string
  companyName?: string
  title?: string
  description?: string
  labels?: string[]
  assignee?: string
  requirementId?: string
  larkDocUrl?: string
  larkDocTitle?: string
  meegleUrl?: string
}) {
  const issueId = input.issueId
  const labels: string[] = input.labels || []
  if (!issueId) return { success: true, ignored: true, detail: 'Webhook payload did not contain a supported issue/work item id' }
  const isExternalTask = labels.includes('external-task') || labels.some((x) => /^bounty:/i.test(x)) || labels.includes('auto-payout:on')
  const requirementDocUrl = input.larkDocUrl || extractLarkDocUrlCandidate(input.description)
  const requirementDocTitle = input.larkDocTitle || input.title

  const binding = input.assignee
    ? (await listInternalMemberBindingsDb({ enabledOnly: true })).find((x) => x.meegleAssignee === input.assignee)
    : undefined
  const repoConfig = binding?.repoConfigId ? (await listRepoConfigsDb()).find((r) => r.id === binding.repoConfigId) : undefined

  const tasks = await listTaskBountiesDb()
  const requirementId = input.requirementId || extractRequirementIdCandidate(input.title, input.description) || generateRequirementIdCandidate(tasks)
  const existed = tasks.find((t) =>
    t.meegleIssueId === issueId && (
      (input.companyId && t.companyId === input.companyId)
      || (!input.companyId && !t.companyId)
      || t.id.startsWith(`meegle-${issueId}`)
    )
  )
  if (existed) {
    existed.companyId = input.companyId || existed.companyId
    existed.companyName = input.companyName || existed.companyName
    existed.title = input.title || existed.title
    existed.description = input.description || existed.description
    existed.labels = labels.length ? labels : existed.labels
    existed.source = isExternalTask ? 'external' : 'internal'
    existed.meegleIssueId = issueId
    existed.meegleUrl = input.meegleUrl || existed.meegleUrl
    existed.meegleAssignee = input.assignee || existed.meegleAssignee
    existed.requirementId = requirementId || existed.requirementId
    existed.requirementDocUrl = requirementDocUrl || existed.requirementDocUrl
    existed.requirementDocTitle = requirementDocTitle || existed.requirementDocTitle
    existed.internalGithubLogin = binding?.githubLogin || existed.internalGithubLogin
    if (binding?.repoConfigId) existed.repoConfigId = binding.repoConfigId
    if (binding?.repo) existed.repo = binding.repo
    else if (repoConfig) existed.repo = `${repoConfig.owner}/${repoConfig.repo}`
    if (!isExternalTask) {
      existed.rewardAmount = 0
      existed.developerWallet = ''
    }
    existed.updatedAt = new Date().toISOString()
    await syncRequirementBindingFromTaskAsync(existed)
    await saveTaskBountiesDb(tasks)
    return { success: true, updated: true, taskId: existed.id }
  }

  const task: TaskBounty = {
    id: `meegle-${issueId}-${uuidv4().slice(0, 8)}`,
    companyId: input.companyId,
    companyName: input.companyName,
    title: input.title || 'Meegle Requirement Task',
    description: input.description || '',
    requirementId,
    requirementDocUrl,
    requirementDocTitle,
    source: isExternalTask ? 'external' : 'internal',
    rewardAmount: isExternalTask ? 50 : 0,
    rewardToken: 'USDT',
    labels,
    developerName: input.assignee || (isExternalTask ? 'External Dev' : 'Internal Owner'),
    meegleIssueId: issueId,
    meegleUrl: input.meegleUrl,
    meegleAssignee: input.assignee || '',
    internalGithubLogin: binding?.githubLogin,
    repoConfigId: binding?.repoConfigId,
    repo: binding?.repo || (repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : undefined),
    developerWallet: isExternalTask ? '' : '',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  tasks.push(task)
  await syncRequirementBindingFromTaskAsync(task)
  await saveTaskBountiesDb(tasks)
  return { success: true, created: true, taskId: task.id }
}

export async function runMeegleSync(input?: { companyId?: string }) {
  const scopedCompany = input?.companyId ? await getCompanyById(input.companyId) : null
  const companies = scopedCompany
    ? [scopedCompany]
    : (await listCompanies()).filter((item) => item.projectManagementTool === 'meegle' && item.meegleProjectKey)

  const syncTargets = companies.length > 0
    ? companies.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      workspaceId: company.meegleWorkspaceId,
      projectKey: company.meegleProjectKey,
      token: company.meegleMcpToken,
      viewUrl: company.meegleViewUrl || (company.meegleWorkspaceId && company.meegleProjectKey
        ? `https://meegle.com/${company.meegleWorkspaceId}/storyView/${company.meegleProjectKey}`
        : undefined)
    }))
    : [{
      companyId: undefined,
      companyName: undefined,
      workspaceId: process.env.MEEGLE_WORKSPACE_ID,
      projectKey: process.env.MEEGLE_PROJECT_KEY,
      token: process.env.MEEGLE_MCP_TOKEN,
      viewUrl: process.env.MEEGLE_MCP_VIEW_URL
    }]

  let created = 0
  let updated = 0
  const bindings: string[] = []
  const details: string[] = []
  let gotIssues = false

  for (const target of syncTargets) {
    const { issues, detail } = await fetchMeegleIssuesFromMcp({
      workspaceId: target.workspaceId,
      projectKey: target.projectKey,
      viewUrl: target.viewUrl,
      token: target.token
    })
    details.push(`${target.companyName || 'global'}:${detail}`)
    if (!issues.length) continue
    gotIssues = true

    for (const issue of issues) {
      const result = await upsertFromIssue({
        companyId: target.companyId,
        companyName: target.companyName,
        issueId: issue.id,
        title: issue.title,
        description: issue.description,
        labels: issue.labels,
        assignee: issue.assignee,
        requirementId: issue.requirementId,
        larkDocUrl: issue.larkDocUrl,
        larkDocTitle: issue.larkDocTitle,
        meegleUrl: issue.url
      })
      if ('created' in result && result.created) created += 1
      if ('updated' in result && result.updated) updated += 1
      if ('taskId' in result && result.taskId) {
        const linkage = await ensureGitHubIssueLinked(result.taskId)
        bindings.push(`${result.taskId}:${linkage.join('|')}`)
      }
    }
  }

  const detail = details.join(' | ')
  if (!gotIssues) {
    await recordIntegrationRunDb('meegle_sync', 'failure', detail)
    return { success: false, detail, created: 0, updated: 0 }
  }
  await recordIntegrationRunDb('meegle_sync', 'success', `${detail} | created=${created} updated=${updated}`)
  return { success: true, mode: 'mcp', detail, created, updated, bindings }
}

export async function GET() {
  try {
    const result = await runMeegleSync()
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await recordIntegrationRunDb('meegle_sync', 'failure', detail)
    return NextResponse.json({ success: false, detail, created: 0, updated: 0 }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const rawBody = await req.text()
  let body: Record<string, unknown> = {}
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      body = {}
    }
  }
  const routeCompanyId = normalizeOptionalString(url.searchParams.get('companyId'))
  const bodyCompanyId = normalizeOptionalString(body?.companyId)
  const companyId = bodyCompanyId || routeCompanyId
  const header = asRecord(body.header)
  const providedSecret = req.headers.get('x-meegle-secret')
    || normalizeOptionalString(url.searchParams.get('secret'))
    || normalizeOptionalString(body?.secret)
    || normalizeOptionalString(header?.token)
  const secretOk = verifySimpleWebhookSecret(
    providedSecret ?? null,
    process.env.MEEGLE_WEBHOOK_SECRET
  )
  if (!secretOk) return NextResponse.json({ error: 'Meegle webhook signature verification failed' }, { status: 401 })
  const extracted = extractMeegleWebhookFields(body)
  const idempotencyKey = buildWebhookIdempotencyKey({
    provider: 'meegle',
    deliveryId: req.headers.get('x-meegle-delivery') || normalizeOptionalString(body?.eventId) || normalizeOptionalString(header?.uuid),
    replayAttempt: req.headers.get('x-workflow-replay-attempt'),
    fallbackParts: [companyId, extracted.issueId, extracted.title, normalizeOptionalString(header?.event_type), rawBody]
  })
  const replayQuery = new URLSearchParams()
  if (companyId) replayQuery.set('companyId', companyId)
  const querySecret = normalizeOptionalString(url.searchParams.get('secret'))
  if (querySecret) replayQuery.set('secret', querySecret)
  const executed = await executeWorkflowEvent({
    eventType: 'meegle.webhook.issue',
    actorType: 'webhook',
    actorId: req.headers.get('x-meegle-delivery') || normalizeOptionalString(body?.eventId) || normalizeOptionalString(header?.uuid) || normalizeOptionalString(header?.operator),
    companyId,
    idempotencyKey,
    payload: {
      replayRequest: {
        path: `/api/integrations/meegle/webhook${replayQuery.toString() ? `?${replayQuery.toString()}` : ''}`,
        method: 'POST',
        body: rawBody,
        headers: {
          'x-meegle-secret': req.headers.get('x-meegle-secret') || '',
          'x-meegle-delivery': req.headers.get('x-meegle-delivery') || ''
        }
      }
    },
    handler: async () => {
      const company = companyId ? await getCompanyById(companyId) : null
      const result = await upsertFromIssue({
        companyId: company?.id,
        companyName: company?.name,
        issueId: extracted.issueId || '',
        title: extracted.title,
        description: extracted.description,
        labels: extracted.labels,
        assignee: extracted.assignee,
        requirementId: extracted.requirementId,
        larkDocUrl: extracted.larkDocUrl,
        larkDocTitle: extracted.larkDocTitle,
        meegleUrl: extracted.meegleUrl
      })
      const linkage = 'taskId' in result && result.taskId ? await ensureGitHubIssueLinked(result.taskId) : []
      return { ...result, mode: 'webhook', linkage, extracted }
    }
  })

  if (executed.duplicate) {
    return NextResponse.json({
      success: true,
      duplicate: true,
      workflowEventId: executed.event.id,
      result: executed.result || executed.event.result || null
    })
  }

  return NextResponse.json({
    ...executed.result,
    workflowEventId: executed.event?.id
  })
}
