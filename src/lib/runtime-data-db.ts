import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { normalizePagination, PaginationInput, PaginationSlice } from '@/lib/pagination'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import {
  loadInternalMemberBindings,
  loadIntegrationHealthStates,
  loadNotifications,
  loadProjects,
  loadPayments,
  loadRepoConfigs,
  loadTaskBounties,
  loadWalletIdentityBindings,
  saveInternalMemberBindings,
  saveIntegrationHealthStates,
  saveNotifications,
  saveProjects,
  savePayments,
  saveRepoConfigs,
  saveTaskBounties,
  saveWalletIdentityBindings,
  loadPaymentRetryJobs,
  savePaymentRetryJobs
} from '@/lib/storage'
import {
  InternalMemberBinding,
  IntegrationHealthState,
  IntegrationKey,
  IntegrationRunStatus,
  NotificationEvent,
  PaymentRecord,
  PaymentRetryJob,
  Project,
  RepoConfig,
  TaskBounty,
  WalletIdentityBinding,
  WalletActorRole
} from '@/lib/types'

interface JsonLikeObject {
  [key: string]: unknown
}

function toMysqlDate(value?: string) {
  return (value || new Date().toISOString()).slice(0, 23).replace('T', ' ')
}

function parseJsonObject(value: unknown): JsonLikeObject {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonLikeObject : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonLikeObject : {}
}

function pruneShadowFields<T extends JsonLikeObject>(value: T, shadowFields: string[]) {
  const next: JsonLikeObject = { ...value }
  for (const key of shadowFields) {
    delete next[key]
  }
  return next
}

function buildPaginationSql(pagination: PaginationSlice | null) {
  if (!pagination) return { suffix: '', params: [] as unknown[] }
  return {
    suffix: ' LIMIT ? OFFSET ?',
    params: [pagination.limit, pagination.offset]
  }
}

async function countMysql(table: string, where?: string, params?: unknown[]): Promise<number> {
  const sql = where ? `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${where}` : `SELECT COUNT(*) AS cnt FROM ${table}`
  const rows = await queryMysql<RowDataPacket[]>(sql, params || [])
  return Number(rows[0]?.cnt ?? 0)
}

function normalizePayment(payment: PaymentRecord): PaymentRecord {
  return {
    ...payment,
    reportId: payment.reportId ?? payment.milestoneId ?? '',
    reportTitle: payment.reportTitle ?? payment.milestoneName ?? 'Unnamed Vulnerability Report'
  }
}

function mapTaskRow(row: RowDataPacket): TaskBounty {
  const task = parseJsonObject(row.task_json) as Partial<TaskBounty>
  const claimedByGithubLogin = row.claimed_by_github_login === null || row.claimed_by_github_login === undefined
    ? undefined
    : String(row.claimed_by_github_login)
  return {
    ...task,
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : task.companyId,
    status: String(row.status) as TaskBounty['status'],
    source: row.source as TaskBounty['source'],
    title: String(row.title),
    description: String(task.description || ''),
    labels: Array.isArray(task.labels) ? task.labels : [],
    repo: row.repo ? String(row.repo) : task.repo,
    rewardAmount: Number(row.reward_amount ?? task.rewardAmount ?? 0),
    rewardToken: row.reward_token ? String(row.reward_token) : (task.rewardToken || 'USD1'),
    claimedByGithubLogin,
    developerName: String(task.developerName || ''),
    developerWallet: row.developer_wallet ? String(row.developer_wallet) : (task.developerWallet || ''),
    payerCompanyWalletId: row.payer_company_wallet_id ? String(row.payer_company_wallet_id) : task.payerCompanyWalletId,
    githubIssueNumber: row.github_issue_number !== null && row.github_issue_number !== undefined
      ? Number(row.github_issue_number)
      : task.githubIssueNumber,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  }
}

function mapPaymentRow(row: RowDataPacket): PaymentRecord {
  const payment = normalizePayment(parseJsonObject(row.payment_json) as Partial<PaymentRecord> as PaymentRecord)
  return {
    ...payment,
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : payment.companyId,
    projectId: String(row.project_id),
    reportId: String(row.report_id),
    txHash: String(row.tx_hash),
    toAddress: String(row.to_address),
    fromAddress: row.from_address ? String(row.from_address) : payment.fromAddress,
    amount: Number(row.amount ?? payment.amount ?? 0),
    rewardToken: row.token_symbol ? String(row.token_symbol) : payment.rewardToken,
    timestamp: new Date(String(row.paid_at)).toISOString(),
    reportTitle: payment.reportTitle
  }
}

function mapWalletBindingRow(row: RowDataPacket): WalletIdentityBinding {
  const binding = parseJsonObject(row.binding_json) as Partial<WalletIdentityBinding>
  return {
    ...binding,
    id: String(row.id),
    actorRole: row.actor_role as WalletIdentityBinding['actorRole'],
    githubLogin: row.github_login ? String(row.github_login) : binding.githubLogin,
    walletAddress: String(row.wallet_address),
    externalUserId: row.external_user_id ? String(row.external_user_id) : binding.externalUserId,
    authSource: row.auth_source as WalletIdentityBinding['authSource'],
    status: row.status as WalletIdentityBinding['status'],
    verifiedAt: new Date(String(row.verified_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  }
}

function mapProjectRow(row: RowDataPacket): Project {
  const project = parseJsonObject(row.project_json) as Partial<Project>
  return {
    ...project,
    id: String(row.id),
    name: String(row.name),
    description: project.description || '',
    totalBudget: Number(row.total_budget ?? project.totalBudget ?? 0),
    spentAmount: Number(row.spent_amount ?? project.spentAmount ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    reports: Array.isArray(project.reports) ? project.reports : []
  }
}

function mapRepoConfigRow(row: RowDataPacket): RepoConfig {
  const config = parseJsonObject(row.config_json) as Partial<RepoConfig>
  return {
    ...config,
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : config.companyId,
    provider: (row.provider || config.provider || 'github') as RepoConfig['provider'],
    owner: String(row.owner),
    repo: String(row.repo),
    defaultBranch: String(row.default_branch || config.defaultBranch || 'main'),
    tokenRef: row.token_ref ? String(row.token_ref) : config.tokenRef,
    enabled: Boolean(row.enabled),
    syncIntervalSec: row.sync_interval_sec !== null && row.sync_interval_sec !== undefined
      ? Number(row.sync_interval_sec)
      : config.syncIntervalSec,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  }
}

function mapInternalBindingRow(row: RowDataPacket): InternalMemberBinding {
  const binding = parseJsonObject(row.binding_json) as Partial<InternalMemberBinding>
  return {
    ...binding,
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : binding.companyId,
    meegleAssignee: String(row.meegle_assignee),
    githubLogin: String(row.github_login),
    repoConfigId: row.repo_config_id ? String(row.repo_config_id) : binding.repoConfigId,
    repo: row.repo ? String(row.repo) : binding.repo,
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  }
}

function mapNotificationRow(row: RowDataPacket): NotificationEvent {
  const notification = parseJsonObject(row.notification_json) as Partial<NotificationEvent>
  return {
    ...notification,
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : notification.companyId,
    severity: row.severity as NotificationEvent['severity'],
    channel: row.channel as NotificationEvent['channel'],
    category: row.category as NotificationEvent['category'],
    title: String(row.title),
    message: String(row.message),
    acknowledged: Boolean(row.acknowledged),
    createdAt: new Date(String(row.created_at)).toISOString()
  }
}

function mapIntegrationHealthRow(row: RowDataPacket): IntegrationHealthState {
  return {
    integration: row.integration as IntegrationKey,
    lastStatus: row.last_status as IntegrationRunStatus,
    lastSuccessAt: row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : undefined,
    lastFailureAt: row.last_failure_at ? new Date(String(row.last_failure_at)).toISOString() : undefined,
    lastDetail: String(row.last_detail || ''),
    consecutiveFailures: Number(row.consecutive_failures || 0),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  }
}

export async function listTaskBountiesDb(input?: { pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    const items = loadTaskBounties()
    return pagination ? items.slice(pagination.offset, pagination.offset + pagination.limit) : items
  }
  const paginationSql = buildPaginationSql(pagination)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_task_bounties ORDER BY updated_at DESC${paginationSql.suffix}`,
    paginationSql.params
  )
  return rows.map(mapTaskRow)
}

export async function getTaskBountyByIdDb(id: string) {
  if (shouldUseFileStorage()) {
    return loadTaskBounties().find((task) => task.id === id) || null
  }
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_task_bounties WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapTaskRow(rows[0]) : null
}

export async function upsertTaskBountyDb(task: TaskBounty) {
  if (shouldUseFileStorage()) {
    const tasks = loadTaskBounties()
    const index = tasks.findIndex((item) => item.id === task.id)
    if (index >= 0) tasks[index] = task
    else tasks.push(task)
    saveTaskBounties(tasks)
    return task
  }

  const taskJson = pruneShadowFields(task as unknown as JsonLikeObject, [
    'id',
    'companyId',
    'status',
    'source',
    'title',
    'repo',
    'rewardAmount',
    'rewardToken',
    'claimedByGithubLogin',
    'developerWallet',
    'payerCompanyWalletId',
    'githubIssueNumber',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_task_bounties
      (id, company_id, status, source, title, repo, reward_amount, reward_token, claimed_by_github_login, developer_wallet, payer_company_wallet_id, github_issue_number, task_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      company_id = VALUES(company_id),
      status = VALUES(status),
      source = VALUES(source),
      title = VALUES(title),
      repo = VALUES(repo),
      reward_amount = VALUES(reward_amount),
      reward_token = VALUES(reward_token),
      claimed_by_github_login = VALUES(claimed_by_github_login),
      developer_wallet = VALUES(developer_wallet),
      payer_company_wallet_id = VALUES(payer_company_wallet_id),
      github_issue_number = VALUES(github_issue_number),
      task_json = VALUES(task_json),
      updated_at = VALUES(updated_at)`,
    [
      task.id,
      task.companyId || null,
      task.status,
      task.source,
      task.title,
      task.repo || null,
      task.rewardAmount || 0,
      task.rewardToken || 'USD1',
      task.claimedByGithubLogin || null,
      task.developerWallet || null,
      task.payerCompanyWalletId || null,
      task.githubIssueNumber ?? null,
      JSON.stringify(taskJson),
      toMysqlDate(task.createdAt),
      toMysqlDate(task.updatedAt)
    ]
  )
  return task
}

export async function saveTaskBountiesDb(tasks: TaskBounty[]) {
  if (tasks.length === 0) return
  if (shouldUseFileStorage()) {
    saveTaskBounties(tasks)
    return
  }
  await Promise.all(tasks.map((task) => upsertTaskBountyDb(task)))
}

export async function listPaymentsDb(companyId?: string, input?: { pagination?: PaginationInput }): Promise<PaymentRecord[] | { items: PaymentRecord[]; total: number }> {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    const payments = loadPayments()
    const filtered = companyId ? payments.filter((payment) => payment.companyId === companyId) : payments
    if (!pagination) return filtered
    return { items: filtered.slice(pagination.offset, pagination.offset + pagination.limit), total: filtered.length }
  }
  const paginationSql = buildPaginationSql(pagination)
  const whereClause = companyId ? 'company_id = ?' : undefined
  const whereParams = companyId ? [companyId] : []
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_payments${whereClause ? ` WHERE ${whereClause}` : ''} ORDER BY paid_at DESC${paginationSql.suffix}`,
    [...whereParams, ...paginationSql.params]
  )
  const items = rows.map(mapPaymentRow)
  if (!pagination) return items
  const total = await countMysql('wlfi_payments', whereClause, whereParams)
  return { items, total }
}

export async function listProjectsDb(input?: { pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    const items = loadProjects()
    return pagination ? items.slice(pagination.offset, pagination.offset + pagination.limit) : items
  }
  const paginationSql = buildPaginationSql(pagination)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_projects ORDER BY created_at DESC${paginationSql.suffix}`,
    paginationSql.params
  )
  return rows.map(mapProjectRow)
}

export async function listRepoConfigsDb(input?: { companyId?: string; includeGlobal?: boolean; enabledOnly?: boolean; pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    let items = loadRepoConfigs()
    if (input?.companyId) {
      items = items.filter((item) => item.companyId === input.companyId || (input.includeGlobal !== false && !item.companyId))
    }
    if (input?.enabledOnly) items = items.filter((item) => item.enabled)
    return pagination ? items.slice(pagination.offset, pagination.offset + pagination.limit) : items
  }

  const clauses: string[] = []
  const params: unknown[] = []
  if (input?.companyId) {
    if (input.includeGlobal === false) {
      clauses.push('company_id = ?')
      params.push(input.companyId)
    } else {
      clauses.push('(company_id = ? OR company_id IS NULL)')
      params.push(input.companyId)
    }
  }
  if (input?.enabledOnly) {
    clauses.push('enabled = 1')
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const paginationSql = buildPaginationSql(pagination)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_repo_configs ${where} ORDER BY updated_at DESC${paginationSql.suffix}`,
    [...params, ...paginationSql.params]
  )
  return rows.map(mapRepoConfigRow)
}

export async function getRepoConfigByIdDb(id: string) {
  if (shouldUseFileStorage()) {
    return loadRepoConfigs().find((item) => item.id === id) || null
  }
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_repo_configs WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapRepoConfigRow(rows[0]) : null
}

export async function upsertRepoConfigDb(config: RepoConfig) {
  if (shouldUseFileStorage()) {
    const items = loadRepoConfigs()
    const index = items.findIndex((item) => item.id === config.id)
    if (index >= 0) items[index] = config
    else items.push(config)
    saveRepoConfigs(items)
    return config
  }

  const configJson = pruneShadowFields(config as unknown as JsonLikeObject, [
    'id',
    'companyId',
    'provider',
    'owner',
    'repo',
    'defaultBranch',
    'tokenRef',
    'enabled',
    'syncIntervalSec',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_repo_configs
      (id, company_id, provider, owner, repo, default_branch, token_ref, enabled, sync_interval_sec, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      company_id = VALUES(company_id),
      provider = VALUES(provider),
      owner = VALUES(owner),
      repo = VALUES(repo),
      default_branch = VALUES(default_branch),
      token_ref = VALUES(token_ref),
      enabled = VALUES(enabled),
      sync_interval_sec = VALUES(sync_interval_sec),
      config_json = VALUES(config_json),
      updated_at = VALUES(updated_at)`,
    [
      config.id,
      config.companyId || null,
      config.provider,
      config.owner,
      config.repo,
      config.defaultBranch,
      config.tokenRef || null,
      config.enabled ? 1 : 0,
      config.syncIntervalSec ?? null,
      JSON.stringify(configJson),
      toMysqlDate(config.createdAt),
      toMysqlDate(config.updatedAt)
    ]
  )
  return config
}

export async function deleteRepoConfigDb(id: string) {
  if (shouldUseFileStorage()) {
    saveRepoConfigs(loadRepoConfigs().filter((item) => item.id !== id))
    return
  }
  await queryMysql<ResultSetHeader>('DELETE FROM wlfi_repo_configs WHERE id = ?', [id])
}

export async function upsertProjectDb(project: Project) {
  if (shouldUseFileStorage()) {
    const projects = loadProjects()
    const index = projects.findIndex((item) => item.id === project.id)
    if (index >= 0) projects[index] = project
    else projects.push(project)
    saveProjects(projects)
    return project
  }

  const projectJson = pruneShadowFields(project as unknown as JsonLikeObject, [
    'id',
    'name',
    'totalBudget',
    'spentAmount',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_projects
      (id, name, total_budget, spent_amount, project_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      total_budget = VALUES(total_budget),
      spent_amount = VALUES(spent_amount),
      project_json = VALUES(project_json),
      updated_at = VALUES(updated_at)`,
    [
      project.id,
      project.name,
      project.totalBudget || 0,
      project.spentAmount || 0,
      JSON.stringify(projectJson),
      toMysqlDate(project.createdAt),
      toMysqlDate(project.updatedAt || project.createdAt || new Date().toISOString())
    ]
  )
  return project
}

export async function saveProjectsDb(projects: Project[]) {
  if (projects.length === 0) return
  if (shouldUseFileStorage()) {
    saveProjects(projects)
    return
  }
  await Promise.all(projects.map((project) => upsertProjectDb(project)))
}

export async function listNotificationsDb(input?: { companyId?: string; acknowledged?: boolean; pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    let items = loadNotifications()
    if (input?.companyId) items = items.filter((item) => !item.companyId || item.companyId === input.companyId)
    if (input?.acknowledged !== undefined) items = items.filter((item) => item.acknowledged === input.acknowledged)
    return pagination ? items.slice(pagination.offset, pagination.offset + pagination.limit) : items
  }

  const clauses: string[] = []
  const params: unknown[] = []

  if (input?.companyId) {
    clauses.push('(company_id IS NULL OR company_id = ?)')
    params.push(input.companyId)
  }
  if (input?.acknowledged !== undefined) {
    clauses.push('acknowledged = ?')
    params.push(input.acknowledged ? 1 : 0)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const paginationSql = buildPaginationSql(pagination)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_notifications ${where} ORDER BY created_at DESC${pagination ? paginationSql.suffix : ' LIMIT 500'}`,
    pagination ? [...params, ...paginationSql.params] : params
  )
  return rows.map(mapNotificationRow)
}

export async function listInternalMemberBindingsDb(input?: { companyId?: string; includeGlobal?: boolean; enabledOnly?: boolean; pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    let items = loadInternalMemberBindings()
    if (input?.companyId) {
      items = items.filter((item) => item.companyId === input.companyId || (input.includeGlobal !== false && !item.companyId))
    }
    if (input?.enabledOnly) items = items.filter((item) => item.enabled)
    return pagination ? items.slice(pagination.offset, pagination.offset + pagination.limit) : items
  }

  const clauses: string[] = []
  const params: unknown[] = []
  if (input?.companyId) {
    if (input.includeGlobal === false) {
      clauses.push('company_id = ?')
      params.push(input.companyId)
    } else {
      clauses.push('(company_id = ? OR company_id IS NULL)')
      params.push(input.companyId)
    }
  }
  if (input?.enabledOnly) clauses.push('enabled = 1')

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const paginationSql = buildPaginationSql(pagination)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_internal_member_bindings ${where} ORDER BY updated_at DESC${paginationSql.suffix}`,
    [...params, ...paginationSql.params]
  )
  return rows.map(mapInternalBindingRow)
}

export async function getInternalMemberBindingByIdDb(id: string) {
  if (shouldUseFileStorage()) {
    return loadInternalMemberBindings().find((item) => item.id === id) || null
  }
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_internal_member_bindings WHERE id = ? LIMIT 1',
    [id]
  )
  return rows[0] ? mapInternalBindingRow(rows[0]) : null
}

export async function upsertInternalMemberBindingDb(binding: InternalMemberBinding) {
  if (shouldUseFileStorage()) {
    const items = loadInternalMemberBindings()
    const index = items.findIndex((item) => item.id === binding.id)
    if (index >= 0) items[index] = binding
    else items.push(binding)
    saveInternalMemberBindings(items)
    return binding
  }

  const bindingJson = pruneShadowFields(binding as unknown as JsonLikeObject, [
    'id',
    'companyId',
    'meegleAssignee',
    'githubLogin',
    'repoConfigId',
    'repo',
    'enabled',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_internal_member_bindings
      (id, company_id, meegle_assignee, github_login, repo_config_id, repo, enabled, binding_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      company_id = VALUES(company_id),
      meegle_assignee = VALUES(meegle_assignee),
      github_login = VALUES(github_login),
      repo_config_id = VALUES(repo_config_id),
      repo = VALUES(repo),
      enabled = VALUES(enabled),
      binding_json = VALUES(binding_json),
      updated_at = VALUES(updated_at)`,
    [
      binding.id,
      binding.companyId || null,
      binding.meegleAssignee,
      binding.githubLogin,
      binding.repoConfigId || null,
      binding.repo || null,
      binding.enabled ? 1 : 0,
      JSON.stringify(bindingJson),
      toMysqlDate(binding.createdAt),
      toMysqlDate(binding.updatedAt)
    ]
  )
  return binding
}

export async function deleteInternalMemberBindingDb(id: string) {
  if (shouldUseFileStorage()) {
    saveInternalMemberBindings(loadInternalMemberBindings().filter((item) => item.id !== id))
    return
  }
  await queryMysql<ResultSetHeader>('DELETE FROM wlfi_internal_member_bindings WHERE id = ?', [id])
}

export async function insertNotificationDb(notification: NotificationEvent) {
  if (shouldUseFileStorage()) {
    const items = loadNotifications()
    saveNotifications([notification, ...items].slice(0, 500))
    return notification
  }

  const notificationJson = pruneShadowFields(notification as unknown as JsonLikeObject, [
    'id',
    'companyId',
    'severity',
    'channel',
    'category',
    'title',
    'message',
    'acknowledged',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_notifications
      (id, company_id, severity, channel, category, title, message, task_id, task_title, action_url, acknowledged, metadata, notification_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      severity = VALUES(severity),
      channel = VALUES(channel),
      category = VALUES(category),
      title = VALUES(title),
      message = VALUES(message),
      task_id = VALUES(task_id),
      task_title = VALUES(task_title),
      action_url = VALUES(action_url),
      acknowledged = VALUES(acknowledged),
      metadata = VALUES(metadata),
      notification_json = VALUES(notification_json),
      updated_at = VALUES(updated_at)`,
    [
      notification.id,
      notification.companyId || null,
      notification.severity,
      notification.channel,
      notification.category,
      notification.title,
      notification.message,
      notification.taskId || null,
      notification.taskTitle || null,
      notification.actionUrl || null,
      notification.acknowledged ? 1 : 0,
      notification.metadata ? JSON.stringify(notification.metadata) : null,
      JSON.stringify(notificationJson),
      toMysqlDate(notification.createdAt),
      toMysqlDate(notification.createdAt)
    ]
  )
  return notification
}

export async function updateNotificationAckDb(id: string, acknowledged: boolean) {
  if (shouldUseFileStorage()) {
    const items = loadNotifications()
    const target = items.find((item) => item.id === id)
    if (!target) return null
    target.acknowledged = acknowledged
    saveNotifications(items)
    return target
  }

  await queryMysql<ResultSetHeader>(
    `UPDATE wlfi_notifications
     SET acknowledged = ?, updated_at = ?
     WHERE id = ?`,
    [acknowledged ? 1 : 0, toMysqlDate(), id]
  )

  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_notifications WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapNotificationRow(rows[0]) : null
}

export async function listIntegrationHealthStatesDb(input?: { pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    const items = loadIntegrationHealthStates()
    return pagination ? items.slice(pagination.offset, pagination.offset + pagination.limit) : items
  }
  const paginationSql = buildPaginationSql(pagination)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_integration_health_states ORDER BY updated_at DESC${paginationSql.suffix}`,
    paginationSql.params
  )
  return rows.map(mapIntegrationHealthRow)
}

export async function recordIntegrationRunDb(integration: IntegrationKey, status: IntegrationRunStatus, detail: string) {
  if (shouldUseFileStorage()) {
    const items = loadIntegrationHealthStates()
    const now = new Date().toISOString()
    const existing = items.find((item) => item.integration === integration)
    if (existing) {
      existing.lastStatus = status
      existing.lastDetail = detail
      existing.updatedAt = now
      if (status === 'success') {
        existing.lastSuccessAt = now
        existing.consecutiveFailures = 0
      } else {
        existing.lastFailureAt = now
        existing.consecutiveFailures += 1
      }
    } else {
      items.push({
        integration,
        lastStatus: status,
        lastSuccessAt: status === 'success' ? now : undefined,
        lastFailureAt: status === 'failure' ? now : undefined,
        lastDetail: detail,
        consecutiveFailures: status === 'failure' ? 1 : 0,
        updatedAt: now
      })
    }
    saveIntegrationHealthStates(items)
    return
  }

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_integration_health_states
      (integration, last_status, last_success_at, last_failure_at, last_detail, consecutive_failures, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      last_status = VALUES(last_status),
      last_success_at = CASE WHEN VALUES(last_status) = 'success' THEN VALUES(updated_at) ELSE last_success_at END,
      last_failure_at = CASE WHEN VALUES(last_status) = 'failure' THEN VALUES(updated_at) ELSE last_failure_at END,
      last_detail = VALUES(last_detail),
      consecutive_failures = CASE
        WHEN VALUES(last_status) = 'success' THEN 0
        ELSE consecutive_failures + 1
      END,
      updated_at = VALUES(updated_at)`,
    [
      integration,
      status,
      status === 'success' ? toMysqlDate() : null,
      status === 'failure' ? toMysqlDate() : null,
      detail,
      status === 'failure' ? 1 : 0,
      toMysqlDate()
    ]
  )
}

export async function appendPaymentDb(payment: PaymentRecord) {
  const normalized = normalizePayment(payment)

  if (shouldUseFileStorage()) {
    const payments = loadPayments()
    payments.push(normalized)
    savePayments(payments)
    return normalized
  }

  const paymentJson = pruneShadowFields(normalized as unknown as JsonLikeObject, [
    'id',
    'companyId',
    'projectId',
    'reportId',
    'txHash',
    'toAddress',
    'fromAddress',
    'amount',
    'rewardToken',
    'timestamp',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_payments
      (id, company_id, project_id, report_id, tx_hash, to_address, from_address, amount, token_symbol, paid_at, payment_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.id,
      normalized.companyId || null,
      normalized.projectId,
      normalized.reportId,
      normalized.txHash,
      normalized.toAddress,
      normalized.fromAddress || null,
      normalized.amount,
      normalized.rewardToken || null,
      toMysqlDate(normalized.timestamp),
      JSON.stringify(paymentJson),
      toMysqlDate(normalized.timestamp),
      toMysqlDate(normalized.timestamp)
    ]
  )
  return normalized
}

export async function upsertWalletIdentityBindingDb(binding: WalletIdentityBinding) {
  if (shouldUseFileStorage()) {
    const bindings = loadWalletIdentityBindings()
    const index = bindings.findIndex((item) => item.id === binding.id)
    if (index >= 0) bindings[index] = binding
    else bindings.push(binding)
    saveWalletIdentityBindings(bindings)
    return binding
  }

  const bindingJson = pruneShadowFields(binding as unknown as JsonLikeObject, [
    'id',
    'actorRole',
    'githubLogin',
    'walletAddress',
    'externalUserId',
    'authSource',
    'status',
    'verifiedAt',
    'createdAt',
    'updatedAt'
  ])

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_wallet_identity_bindings
      (id, actor_role, github_login, wallet_address, external_user_id, auth_source, status, verified_at, binding_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      github_login = VALUES(github_login),
      external_user_id = VALUES(external_user_id),
      auth_source = VALUES(auth_source),
      status = VALUES(status),
      verified_at = VALUES(verified_at),
      binding_json = VALUES(binding_json),
      updated_at = VALUES(updated_at)`,
    [
      binding.id,
      binding.actorRole,
      binding.githubLogin || null,
      binding.walletAddress,
      binding.externalUserId || null,
      binding.authSource,
      binding.status,
      toMysqlDate(binding.verifiedAt),
      JSON.stringify(bindingJson),
      toMysqlDate(binding.createdAt),
      toMysqlDate(binding.updatedAt)
    ]
  )
  return binding
}

export async function listWalletIdentityBindingsDb(actorRole?: WalletActorRole, input?: { pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  if (shouldUseFileStorage()) {
    const bindings = loadWalletIdentityBindings()
    const filtered = actorRole ? bindings.filter((binding) => binding.actorRole === actorRole) : bindings
    return pagination ? filtered.slice(pagination.offset, pagination.offset + pagination.limit) : filtered
  }
  const paginationSql = buildPaginationSql(pagination)
  const rows = actorRole
    ? await queryMysql<RowDataPacket[]>(
      `SELECT * FROM wlfi_wallet_identity_bindings WHERE actor_role = ? ORDER BY updated_at DESC${paginationSql.suffix}`,
      [actorRole, ...paginationSql.params]
    )
    : await queryMysql<RowDataPacket[]>(
      `SELECT * FROM wlfi_wallet_identity_bindings ORDER BY updated_at DESC${paginationSql.suffix}`,
      paginationSql.params
    )
  return rows.map(mapWalletBindingRow)
}

export async function findWalletIdentityBindingByGithubLoginDb(githubLogin: string | undefined, actorRole: WalletActorRole = 'bounty_claimer') {
  const normalized = githubLogin?.trim().replace(/^@/, '').toLowerCase()
  if (!normalized) return null
  if (shouldUseFileStorage()) {
    const bindings = loadWalletIdentityBindings()
    return bindings.find((binding) =>
      binding.actorRole === actorRole
      && binding.status === 'active'
      && binding.githubLogin?.trim().replace(/^@/, '').toLowerCase() === normalized
    ) || null
  }
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT *
     FROM wlfi_wallet_identity_bindings
     WHERE actor_role = ? AND github_login = ? AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [actorRole, normalized]
  )
  return rows[0] ? mapWalletBindingRow(rows[0]) : null
}

export async function findWalletIdentityBindingByWalletAddressDb(walletAddress: string | undefined, actorRole?: WalletActorRole) {
  const normalized = walletAddress?.trim().toLowerCase()
  if (!normalized) return null
  if (shouldUseFileStorage()) {
    const bindings = loadWalletIdentityBindings()
    return bindings.find((binding) =>
      binding.status === 'active'
      && (!actorRole || binding.actorRole === actorRole)
      && binding.walletAddress.trim().toLowerCase() === normalized
    ) || null
  }
  const sql = actorRole
    ? `SELECT *
       FROM wlfi_wallet_identity_bindings
       WHERE actor_role = ? AND LOWER(wallet_address) = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`
    : `SELECT *
       FROM wlfi_wallet_identity_bindings
       WHERE LOWER(wallet_address) = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`
  const params = actorRole ? [actorRole, normalized] : [normalized]
  const rows = await queryMysql<RowDataPacket[]>(sql, params)
  return rows[0] ? mapWalletBindingRow(rows[0]) : null
}

// ── PaymentRetryJob ──────────────────────────────────────────────────────────

function mapRetryJobRow(row: RowDataPacket): PaymentRetryJob {
  return {
    id: row.id,
    taskId: row.task_id,
    companyId: row.company_id ?? undefined,
    taskTitle: row.task_title,
    failureCode: row.failure_code,
    retryStrategy: row.retry_strategy,
    status: row.status,
    source: row.source,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : String(row.scheduled_at),
    lastAttemptAt: row.last_attempt_at ? (row.last_attempt_at instanceof Date ? row.last_attempt_at.toISOString() : String(row.last_attempt_at)) : undefined,
    completedAt: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)) : undefined,
    lockedAt: row.locked_at ? (row.locked_at instanceof Date ? row.locked_at.toISOString() : String(row.locked_at)) : undefined,
    lastError: row.last_error ?? undefined,
    nextAction: row.next_action ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

function toMysqlDateOrNull(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 23).replace('T', ' ')
}

export async function listPaymentRetryJobsDb(input?: {
  status?: PaymentRetryJob['status']
  limit?: number
}): Promise<PaymentRetryJob[]> {
  if (shouldUseFileStorage()) {
    const jobs = loadPaymentRetryJobs()
    if (input?.status) return jobs.filter((j) => j.status === input.status).slice(0, input.limit || 50)
    return jobs.slice(0, input?.limit || 50)
  }
  const whereClauses: string[] = []
  const params: unknown[] = []
  if (input?.status) { whereClauses.push('status = ?'); params.push(input.status) }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const limit = Math.min(input?.limit || 50, 200)
  params.push(limit)
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_payment_retry_jobs ${where} ORDER BY scheduled_at ASC LIMIT ?`,
    params
  )
  return rows.map(mapRetryJobRow)
}

export async function getPaymentRetryJobByIdDb(id: string): Promise<PaymentRetryJob | null> {
  if (shouldUseFileStorage()) {
    return loadPaymentRetryJobs().find((j) => j.id === id) ?? null
  }
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_payment_retry_jobs WHERE id = ? LIMIT 1',
    [id]
  )
  return rows[0] ? mapRetryJobRow(rows[0]) : null
}

export async function getActiveRetryJobForTaskDb(taskId: string): Promise<PaymentRetryJob | null> {
  if (shouldUseFileStorage()) {
    return loadPaymentRetryJobs().find(
      (j) => j.taskId === taskId && ['pending', 'processing'].includes(j.status)
    ) ?? null
  }
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_payment_retry_jobs
     WHERE task_id = ? AND status IN ('pending', 'processing')
     ORDER BY created_at DESC LIMIT 1`,
    [taskId]
  )
  return rows[0] ? mapRetryJobRow(rows[0]) : null
}

export async function upsertPaymentRetryJobDb(job: PaymentRetryJob): Promise<void> {
  if (shouldUseFileStorage()) {
    const jobs = loadPaymentRetryJobs()
    const idx = jobs.findIndex((j) => j.id === job.id)
    if (idx >= 0) jobs[idx] = job; else jobs.unshift(job)
    savePaymentRetryJobs(jobs)
    return
  }
  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_payment_retry_jobs
       (id, task_id, company_id, task_title, failure_code, retry_strategy, status, source,
        attempts, max_attempts, scheduled_at, last_attempt_at, completed_at, locked_at,
        last_error, next_action, metadata_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       attempts = VALUES(attempts),
       max_attempts = VALUES(max_attempts),
       scheduled_at = VALUES(scheduled_at),
       last_attempt_at = VALUES(last_attempt_at),
       completed_at = VALUES(completed_at),
       locked_at = VALUES(locked_at),
       last_error = VALUES(last_error),
       next_action = VALUES(next_action),
       metadata_json = VALUES(metadata_json),
       updated_at = VALUES(updated_at)`,
    [
      job.id, job.taskId, job.companyId ?? null, job.taskTitle,
      job.failureCode, job.retryStrategy, job.status, job.source,
      job.attempts, job.maxAttempts,
      toMysqlDateOrNull(job.scheduledAt),
      toMysqlDateOrNull(job.lastAttemptAt),
      toMysqlDateOrNull(job.completedAt),
      toMysqlDateOrNull(job.lockedAt),
      job.lastError ?? null,
      job.nextAction ?? null,
      job.metadata ? JSON.stringify(job.metadata) : null,
      toMysqlDateOrNull(job.createdAt),
      toMysqlDateOrNull(job.updatedAt),
    ]
  )
}

export async function savePaymentRetryJobsDb(jobs: PaymentRetryJob[]): Promise<void> {
  for (const job of jobs) {
    await upsertPaymentRetryJobDb(job)
  }
}
