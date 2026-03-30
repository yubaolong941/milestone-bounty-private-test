import { v4 as uuidv4 } from 'uuid'
import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { AuditLog, Company, CompanyMembership, CompanyRole, CompanyWalletConfig, RecipientProfile } from '@/lib/types'
import { normalizePagination, PaginationInput } from '@/lib/pagination'

async function countMysql(table: string, where?: string, params?: unknown[]): Promise<number> {
  const sql = where ? `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${where}` : `SELECT COUNT(*) AS cnt FROM ${table}`
  const rows = await queryMysql<RowDataPacket[]>(sql, params || [])
  return Number(rows[0]?.cnt ?? 0)
}

function toIso(value: unknown) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value)).toISOString()
}

function mapCompany(row: RowDataPacket): Company {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    status: row.status as Company['status'],
    githubOrgLogin: row.github_org_login ? String(row.github_org_login) : undefined,
    githubOrgId: row.github_org_id ? String(row.github_org_id) : undefined,
    projectManagementTool: row.project_management_tool ? row.project_management_tool as Company['projectManagementTool'] : undefined,
    projectManagementToolLabel: row.project_management_tool_label ? String(row.project_management_tool_label) : undefined,
    meegleWorkspaceId: row.meegle_workspace_id ? String(row.meegle_workspace_id) : undefined,
    meegleProjectKey: row.meegle_project_key ? String(row.meegle_project_key) : undefined,
    meegleViewUrl: row.meegle_view_url ? String(row.meegle_view_url) : undefined,
    meegleMcpToken: row.meegle_mcp_token ? String(row.meegle_mcp_token) : undefined,
    documentationTool: row.documentation_tool ? row.documentation_tool as Company['documentationTool'] : undefined,
    documentationToolLabel: row.documentation_tool_label ? String(row.documentation_tool_label) : undefined,
    larkWebhookUrl: row.lark_webhook_url ? String(row.lark_webhook_url) : undefined,
    larkWebhookSecret: row.lark_webhook_secret ? String(row.lark_webhook_secret) : undefined,
    larkDefaultReceiveId: row.lark_default_receive_id ? String(row.lark_default_receive_id) : undefined,
    description: row.description ? String(row.description) : '',
    websiteUrl: row.website_url ? String(row.website_url) : undefined,
    contactEmail: row.contact_email ? String(row.contact_email) : undefined,
    defaultRepoConfigId: row.default_repo_config_id ? String(row.default_repo_config_id) : undefined,
    activeWalletId: row.active_wallet_id ? String(row.active_wallet_id) : undefined,
    createdByUserId: String(row.created_by_user_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function mapMembership(row: RowDataPacket): CompanyMembership {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    githubLogin: row.github_login ? String(row.github_login) : undefined,
    githubUserId: row.github_user_id ? String(row.github_user_id) : undefined,
    walletAddress: row.wallet_address ? String(row.wallet_address) : undefined,
    role: row.role as CompanyRole,
    status: row.status as CompanyMembership['status'],
    invitedByUserId: row.invited_by_user_id ? String(row.invited_by_user_id) : undefined,
    invitedAt: row.invited_at ? toIso(row.invited_at) : undefined,
    acceptedAt: row.accepted_at ? toIso(row.accepted_at) : undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function mapWallet(row: RowDataPacket): CompanyWalletConfig {
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : undefined,
    companyName: String(row.company_name),
    walletLabel: row.wallet_label ? String(row.wallet_label) : undefined,
    walletAddress: String(row.wallet_address),
    network: String(row.network),
    tokenSymbol: String(row.token_symbol),
    tokenAddress: row.token_address ? String(row.token_address) : undefined,
    active: Boolean(row.active),
    verificationMethod: row.verification_method as CompanyWalletConfig['verificationMethod'],
    verifiedSignatureAddress: row.verified_signature_address ? String(row.verified_signature_address) : undefined,
    verifiedByUserId: String(row.verified_by_user_id),
    verifiedByGithubLogin: row.verified_by_github_login ? String(row.verified_by_github_login) : undefined,
    verifiedAt: toIso(row.verified_at),
    lastUsedAt: row.last_used_at ? toIso(row.last_used_at) : undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function mapRecipientProfile(row: RowDataPacket): RecipientProfile {
  return {
    id: String(row.id),
    type: row.type as RecipientProfile['type'],
    displayName: String(row.display_name),
    githubLogin: row.github_login ? String(row.github_login) : undefined,
    githubUserId: row.github_user_id ? String(row.github_user_id) : undefined,
    walletAddress: row.wallet_address ? String(row.wallet_address) : undefined,
    externalUserId: String(row.external_user_id),
    identitySource: row.identity_source ? row.identity_source as RecipientProfile['identitySource'] : undefined,
    ownerUserId: String(row.owner_user_id),
    status: row.status as RecipientProfile['status'],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function mapAuditLog(row: RowDataPacket): AuditLog {
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : undefined,
    actorUserId: String(row.actor_user_id),
    actorRole: row.actor_role ? String(row.actor_role) : undefined,
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    summary: String(row.summary),
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
    createdAt: toIso(row.created_at)
  }
}

export async function listCompaniesForUser(userId: string, isAdmin: boolean, input?: { pagination?: PaginationInput }): Promise<Company[] | { items: Company[]; total: number }> {
  const pagination = normalizePagination(input?.pagination)
  const suffix = pagination ? ' LIMIT ? OFFSET ?' : ''
  const paginationParams = pagination ? [pagination.limit, pagination.offset] : []
  const rows = isAdmin
    ? await queryMysql<RowDataPacket[]>(`SELECT * FROM wlfi_companies ORDER BY created_at DESC${suffix}`, paginationParams)
    : await queryMysql<RowDataPacket[]>(
      `SELECT c.*
       FROM wlfi_companies c
       INNER JOIN wlfi_company_memberships m ON m.company_id = c.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY c.created_at DESC${suffix}`,
      [userId, ...paginationParams]
    )
  const items = rows.map(mapCompany)
  if (!pagination) return items
  const whereClause = isAdmin ? undefined : `id IN (SELECT company_id FROM wlfi_company_memberships WHERE user_id = ? AND status = 'active')`
  const whereParams = isAdmin ? [] : [userId]
  const total = await countMysql('wlfi_companies', whereClause, whereParams)
  return { items, total }
}

export async function getCompanyById(id: string) {
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_companies WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapCompany(rows[0]) : null
}

export async function listCompanies() {
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_companies ORDER BY updated_at DESC')
  return rows.map(mapCompany)
}

export async function getCompanyBySlug(slug: string) {
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_companies WHERE slug = ? LIMIT 1', [slug])
  return rows[0] ? mapCompany(rows[0]) : null
}

export async function insertCompany(input: Omit<Company, 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ')
  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_companies
      (id, slug, name, status, github_org_login, github_org_id, project_management_tool, project_management_tool_label, meegle_workspace_id, meegle_project_key, meegle_view_url, meegle_mcp_token, documentation_tool, documentation_tool_label, lark_webhook_url, lark_webhook_secret, lark_default_receive_id, description, website_url, contact_email, default_repo_config_id, active_wallet_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.slug,
      input.name,
      input.status,
      input.githubOrgLogin || null,
      input.githubOrgId || null,
      input.projectManagementTool || null,
      input.projectManagementToolLabel || null,
      input.meegleWorkspaceId || null,
      input.meegleProjectKey || null,
      input.meegleViewUrl || null,
      input.meegleMcpToken || null,
      input.documentationTool || null,
      input.documentationToolLabel || null,
      input.larkWebhookUrl || null,
      input.larkWebhookSecret || null,
      input.larkDefaultReceiveId || null,
      input.description || null,
      input.websiteUrl || null,
      input.contactEmail || null,
      input.defaultRepoConfigId || null,
      input.activeWalletId || null,
      input.createdByUserId,
      now,
      now
    ]
  )
  return getCompanyById(input.id)
}

export async function updateCompanyFields(id: string, fields: Partial<Company>) {
  const assignments: string[] = []
  const params: unknown[] = []
  if (fields.name !== undefined) { assignments.push('name = ?'); params.push(fields.name) }
  if (fields.status !== undefined) { assignments.push('status = ?'); params.push(fields.status) }
  if (fields.githubOrgLogin !== undefined) { assignments.push('github_org_login = ?'); params.push(fields.githubOrgLogin || null) }
  if (fields.githubOrgId !== undefined) { assignments.push('github_org_id = ?'); params.push(fields.githubOrgId || null) }
  if (fields.projectManagementTool !== undefined) { assignments.push('project_management_tool = ?'); params.push(fields.projectManagementTool || null) }
  if (fields.projectManagementToolLabel !== undefined) { assignments.push('project_management_tool_label = ?'); params.push(fields.projectManagementToolLabel || null) }
  if (fields.meegleWorkspaceId !== undefined) { assignments.push('meegle_workspace_id = ?'); params.push(fields.meegleWorkspaceId || null) }
  if (fields.meegleProjectKey !== undefined) { assignments.push('meegle_project_key = ?'); params.push(fields.meegleProjectKey || null) }
  if (fields.meegleViewUrl !== undefined) { assignments.push('meegle_view_url = ?'); params.push(fields.meegleViewUrl || null) }
  if (fields.meegleMcpToken !== undefined) { assignments.push('meegle_mcp_token = ?'); params.push(fields.meegleMcpToken || null) }
  if (fields.documentationTool !== undefined) { assignments.push('documentation_tool = ?'); params.push(fields.documentationTool || null) }
  if (fields.documentationToolLabel !== undefined) { assignments.push('documentation_tool_label = ?'); params.push(fields.documentationToolLabel || null) }
  if (fields.larkWebhookUrl !== undefined) { assignments.push('lark_webhook_url = ?'); params.push(fields.larkWebhookUrl || null) }
  if (fields.larkWebhookSecret !== undefined) { assignments.push('lark_webhook_secret = ?'); params.push(fields.larkWebhookSecret || null) }
  if (fields.larkDefaultReceiveId !== undefined) { assignments.push('lark_default_receive_id = ?'); params.push(fields.larkDefaultReceiveId || null) }
  if (fields.description !== undefined) { assignments.push('description = ?'); params.push(fields.description || null) }
  if (fields.websiteUrl !== undefined) { assignments.push('website_url = ?'); params.push(fields.websiteUrl || null) }
  if (fields.contactEmail !== undefined) { assignments.push('contact_email = ?'); params.push(fields.contactEmail || null) }
  if (fields.defaultRepoConfigId !== undefined) { assignments.push('default_repo_config_id = ?'); params.push(fields.defaultRepoConfigId || null) }
  if (fields.activeWalletId !== undefined) { assignments.push('active_wallet_id = ?'); params.push(fields.activeWalletId || null) }
  assignments.push('updated_at = ?')
  params.push(new Date().toISOString().slice(0, 23).replace('T', ' '))
  params.push(id)
  await queryMysql<ResultSetHeader>(`UPDATE wlfi_companies SET ${assignments.join(', ')} WHERE id = ?`, params)
  return getCompanyById(id)
}

export async function listMemberships(companyId: string, input?: { pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  const suffix = pagination ? ' LIMIT ? OFFSET ?' : ''
  const params: unknown[] = [companyId]
  if (pagination) {
    params.push(pagination.limit, pagination.offset)
  }
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_company_memberships WHERE company_id = ? ORDER BY created_at DESC${suffix}`,
    params
  )
  return rows.map(mapMembership)
}

export async function getMembership(companyId: string, userId: string) {
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_company_memberships WHERE company_id = ? AND user_id = ? LIMIT 1',
    [companyId, userId]
  )
  return rows[0] ? mapMembership(rows[0]) : null
}

export async function getMembershipForIdentity(
  companyId: string,
  identity: { userId?: string; githubLogin?: string; githubUserId?: string; walletAddress?: string }
) {
  const clauses: string[] = []
  const params: unknown[] = [companyId]

  if (identity.userId) {
    clauses.push('user_id = ?')
    params.push(identity.userId)
  }
  if (identity.githubLogin) {
    clauses.push('LOWER(github_login) = ?')
    params.push(identity.githubLogin.trim().toLowerCase())
  }
  if (identity.githubUserId) {
    clauses.push('github_user_id = ?')
    params.push(identity.githubUserId.trim())
  }
  if (identity.walletAddress) {
    clauses.push('LOWER(wallet_address) = ?')
    params.push(identity.walletAddress.trim().toLowerCase())
  }

  if (clauses.length === 0) return null

  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT *
     FROM wlfi_company_memberships
     WHERE company_id = ?
       AND status = 'active'
       AND (${clauses.join(' OR ')})
     ORDER BY updated_at DESC
     LIMIT 1`,
    params
  )
  return rows[0] ? mapMembership(rows[0]) : null
}

export async function getMembershipById(id: string) {
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_company_memberships WHERE id = ? LIMIT 1',
    [id]
  )
  return rows[0] ? mapMembership(rows[0]) : null
}

export async function listActiveMembershipsForIdentity(identity: { userId?: string; githubLogin?: string; githubUserId?: string; walletAddress?: string }) {
  const clauses: string[] = []
  const params: unknown[] = []

  if (identity.userId) {
    clauses.push('user_id = ?')
    params.push(identity.userId)
  }
  if (identity.githubLogin) {
    clauses.push('LOWER(github_login) = ?')
    params.push(identity.githubLogin.trim().toLowerCase())
  }
  if (identity.githubUserId) {
    clauses.push('github_user_id = ?')
    params.push(identity.githubUserId.trim())
  }
  if (identity.walletAddress) {
    clauses.push('LOWER(wallet_address) = ?')
    params.push(identity.walletAddress.trim().toLowerCase())
  }

  if (clauses.length === 0) return []

  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT *
     FROM wlfi_company_memberships
     WHERE status = 'active'
       AND (${clauses.join(' OR ')})
     ORDER BY updated_at DESC`,
    params
  )
  return rows.map(mapMembership)
}

export async function insertMembership(input: Omit<CompanyMembership, 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ')
  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_company_memberships
      (id, company_id, user_id, github_login, github_user_id, wallet_address, role, status, invited_by_user_id, invited_at, accepted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.companyId,
      input.userId,
      input.githubLogin || null,
      input.githubUserId || null,
      input.walletAddress || null,
      input.role,
      input.status,
      input.invitedByUserId || null,
      input.invitedAt ? input.invitedAt.slice(0, 23).replace('T', ' ') : null,
      input.acceptedAt ? input.acceptedAt.slice(0, 23).replace('T', ' ') : null,
      now,
      now
    ]
  )
  return getMembershipById(input.id)
}

export async function updateMembership(id: string, fields: Partial<CompanyMembership>) {
  const assignments: string[] = []
  const params: unknown[] = []
  if (fields.githubLogin !== undefined) { assignments.push('github_login = ?'); params.push(fields.githubLogin || null) }
  if (fields.githubUserId !== undefined) { assignments.push('github_user_id = ?'); params.push(fields.githubUserId || null) }
  if (fields.walletAddress !== undefined) { assignments.push('wallet_address = ?'); params.push(fields.walletAddress || null) }
  if (fields.role !== undefined) { assignments.push('role = ?'); params.push(fields.role) }
  if (fields.status !== undefined) { assignments.push('status = ?'); params.push(fields.status) }
  if (fields.acceptedAt !== undefined) { assignments.push('accepted_at = ?'); params.push(fields.acceptedAt ? fields.acceptedAt.slice(0, 23).replace('T', ' ') : null) }
  assignments.push('updated_at = ?')
  params.push(new Date().toISOString().slice(0, 23).replace('T', ' '))
  params.push(id)
  await queryMysql<ResultSetHeader>(`UPDATE wlfi_company_memberships SET ${assignments.join(', ')} WHERE id = ?`, params)
  return getMembershipById(id)
}

export async function listCompanyWallets(companyId?: string, input?: { pagination?: PaginationInput }) {
  const pagination = normalizePagination(input?.pagination)
  const suffix = pagination ? ' LIMIT ? OFFSET ?' : ''
  const paginationParams = pagination ? [pagination.limit, pagination.offset] : []
  const rows = companyId
    ? await queryMysql<RowDataPacket[]>(
      `SELECT * FROM wlfi_company_wallets WHERE company_id = ? ORDER BY created_at DESC${suffix}`,
      [companyId, ...paginationParams]
    )
    : await queryMysql<RowDataPacket[]>(`SELECT * FROM wlfi_company_wallets ORDER BY created_at DESC${suffix}`, paginationParams)
  return rows.map(mapWallet)
}

export async function getCompanyWalletById(id: string) {
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_company_wallets WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapWallet(rows[0]) : null
}

export async function findCompanyWallet(companyId: string, companyName: string) {
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_company_wallets WHERE company_id = ? AND company_name = ? LIMIT 1',
    [companyId, companyName]
  )
  return rows[0] ? mapWallet(rows[0]) : null
}

export async function insertCompanyWallet(input: Omit<CompanyWalletConfig, 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ')
  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_company_wallets
      (id, company_id, company_name, wallet_label, wallet_address, network, token_symbol, token_address, active, verification_method, verified_signature_address, verified_by_user_id, verified_by_github_login, verified_at, last_used_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.companyId || null,
      input.companyName,
      input.walletLabel || null,
      input.walletAddress,
      input.network,
      input.tokenSymbol,
      input.tokenAddress || null,
      input.active ? 1 : 0,
      input.verificationMethod,
      input.verifiedSignatureAddress || null,
      input.verifiedByUserId,
      input.verifiedByGithubLogin || null,
      input.verifiedAt.slice(0, 23).replace('T', ' '),
      input.lastUsedAt ? input.lastUsedAt.slice(0, 23).replace('T', ' ') : null,
      now,
      now
    ]
  )
  return getCompanyWalletById(input.id)
}

export async function updateCompanyWallet(id: string, fields: Partial<CompanyWalletConfig>) {
  const assignments: string[] = []
  const params: unknown[] = []
  if (fields.companyId !== undefined) { assignments.push('company_id = ?'); params.push(fields.companyId || null) }
  if (fields.companyName !== undefined) { assignments.push('company_name = ?'); params.push(fields.companyName) }
  if (fields.walletLabel !== undefined) { assignments.push('wallet_label = ?'); params.push(fields.walletLabel || null) }
  if (fields.walletAddress !== undefined) { assignments.push('wallet_address = ?'); params.push(fields.walletAddress) }
  if (fields.network !== undefined) { assignments.push('network = ?'); params.push(fields.network) }
  if (fields.tokenSymbol !== undefined) { assignments.push('token_symbol = ?'); params.push(fields.tokenSymbol) }
  if (fields.tokenAddress !== undefined) { assignments.push('token_address = ?'); params.push(fields.tokenAddress || null) }
  if (fields.active !== undefined) { assignments.push('active = ?'); params.push(fields.active ? 1 : 0) }
  if (fields.verificationMethod !== undefined) { assignments.push('verification_method = ?'); params.push(fields.verificationMethod) }
  if (fields.verifiedSignatureAddress !== undefined) { assignments.push('verified_signature_address = ?'); params.push(fields.verifiedSignatureAddress || null) }
  if (fields.verifiedByUserId !== undefined) { assignments.push('verified_by_user_id = ?'); params.push(fields.verifiedByUserId) }
  if (fields.verifiedByGithubLogin !== undefined) { assignments.push('verified_by_github_login = ?'); params.push(fields.verifiedByGithubLogin || null) }
  if (fields.verifiedAt !== undefined) { assignments.push('verified_at = ?'); params.push(fields.verifiedAt.slice(0, 23).replace('T', ' ')) }
  if (fields.lastUsedAt !== undefined) { assignments.push('last_used_at = ?'); params.push(fields.lastUsedAt ? fields.lastUsedAt.slice(0, 23).replace('T', ' ') : null) }
  assignments.push('updated_at = ?')
  params.push(new Date().toISOString().slice(0, 23).replace('T', ' '))
  params.push(id)
  await queryMysql<ResultSetHeader>(`UPDATE wlfi_company_wallets SET ${assignments.join(', ')} WHERE id = ?`, params)
  return getCompanyWalletById(id)
}

export async function deactivateOtherCompanyWallets(companyId: string, activeId: string) {
  await queryMysql<ResultSetHeader>(
    'UPDATE wlfi_company_wallets SET active = 0, updated_at = ? WHERE company_id = ? AND id <> ?',
    [new Date().toISOString().slice(0, 23).replace('T', ' '), companyId, activeId]
  )
}

export async function insertAuditLog(input: Omit<AuditLog, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
  const id = input.id || uuidv4()
  const createdAt = (input.createdAt || new Date().toISOString()).slice(0, 23).replace('T', ' ')
  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_audit_logs
      (id, company_id, actor_user_id, actor_role, action, target_type, target_id, summary, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.companyId || null,
      input.actorUserId,
      input.actorRole || null,
      input.action,
      input.targetType,
      input.targetId,
      input.summary,
      input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt
    ]
  )
  return id
}

export async function listAuditLogs(companyId?: string, input?: { pagination?: PaginationInput }): Promise<AuditLog[] | { items: AuditLog[]; total: number }> {
  const pagination = normalizePagination(input?.pagination)
  const rows = companyId
    ? await queryMysql<RowDataPacket[]>(
      `SELECT * FROM wlfi_audit_logs WHERE company_id = ? ORDER BY created_at DESC${pagination ? ' LIMIT ? OFFSET ?' : ' LIMIT 200'}`,
      pagination ? [companyId, pagination.limit, pagination.offset] : [companyId]
    )
    : await queryMysql<RowDataPacket[]>(
      `SELECT * FROM wlfi_audit_logs ORDER BY created_at DESC${pagination ? ' LIMIT ? OFFSET ?' : ' LIMIT 200'}`,
      pagination ? [pagination.limit, pagination.offset] : []
    )
  const items = rows.map(mapAuditLog)
  if (!pagination) return items
  const whereClause = companyId ? 'company_id = ?' : undefined
  const whereParams = companyId ? [companyId] : []
  const total = await countMysql('wlfi_audit_logs', whereClause, whereParams)
  return { items, total }
}

export async function getRecipientProfileByExternalUserId(externalUserId: string) {
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_recipient_profiles WHERE external_user_id = ? LIMIT 1',
    [externalUserId]
  )
  return rows[0] ? mapRecipientProfile(rows[0]) : null
}

export async function getRecipientProfileByWallet(walletAddress: string) {
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_recipient_profiles WHERE wallet_address = ? LIMIT 1',
    [walletAddress]
  )
  return rows[0] ? mapRecipientProfile(rows[0]) : null
}

export async function upsertRecipientProfile(input: RecipientProfile) {
  const existing = await getRecipientProfileByExternalUserId(input.externalUserId)
  if (!existing) {
    await queryMysql<ResultSetHeader>(
      `INSERT INTO wlfi_recipient_profiles
        (id, type, display_name, github_login, github_user_id, wallet_address, external_user_id, identity_source, owner_user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.type,
        input.displayName,
        input.githubLogin || null,
        input.githubUserId || null,
        input.walletAddress || null,
        input.externalUserId,
        input.identitySource || null,
        input.ownerUserId,
        input.status,
        input.createdAt.slice(0, 23).replace('T', ' '),
        input.updatedAt.slice(0, 23).replace('T', ' ')
      ]
    )
    return getRecipientProfileByExternalUserId(input.externalUserId)
  }

  await queryMysql<ResultSetHeader>(
    `UPDATE wlfi_recipient_profiles
     SET display_name = ?, github_login = ?, github_user_id = ?, wallet_address = ?, identity_source = ?, owner_user_id = ?, status = ?, updated_at = ?
     WHERE external_user_id = ?`,
    [
      input.displayName,
      input.githubLogin || null,
      input.githubUserId || null,
      input.walletAddress || null,
      input.identitySource || null,
      input.ownerUserId,
      input.status,
      input.updatedAt.slice(0, 23).replace('T', ' '),
      input.externalUserId
    ]
  )
  return getRecipientProfileByExternalUserId(input.externalUserId)
}
