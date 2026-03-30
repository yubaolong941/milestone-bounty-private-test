import fs from 'fs'
import path from 'path'
import {
  Project,
  PaymentRecord,
  TaskBounty,
  RepoConfig,
  InternalMemberBinding,
  Company,
  CompanyMembership,
  CompanyWalletConfig,
  WalletIdentityBinding,
  BountyFundingLock,
  AuditLog,
  NotificationEvent,
  PaymentRetryJob,
  RequirementBinding,
  SettlementCase,
  TreasuryFunding,
  IntegrationHealthState,
  IntegrationKey,
  IntegrationRunStatus,
  WorkflowEvent,
  PayoutAttempt
} from './types'

const DATA_DIR = (
  process.env.WLFI_DATA_DIR?.trim()
  || (process.env.NODE_ENV === 'production' ? '/tmp/wlfi-data' : path.join(process.cwd(), 'data'))
)
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')
const REPO_CONFIGS_FILE = path.join(DATA_DIR, 'repo-configs.json')
const INTERNAL_MEMBER_BINDINGS_FILE = path.join(DATA_DIR, 'internal-member-bindings.json')
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json')
const COMPANY_MEMBERSHIPS_FILE = path.join(DATA_DIR, 'company-memberships.json')
const COMPANY_WALLETS_FILE = path.join(DATA_DIR, 'company-wallets.json')
const WALLET_IDENTITY_BINDINGS_FILE = path.join(DATA_DIR, 'wallet-identity-bindings.json')
const BOUNTY_FUNDING_LOCKS_FILE = path.join(DATA_DIR, 'bounty-funding-locks.json')
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit-logs.json')
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json')
const PAYMENT_RETRY_JOBS_FILE = path.join(DATA_DIR, 'payment-retry-jobs.json')
const INTEGRATION_HEALTH_FILE = path.join(DATA_DIR, 'integration-health.json')
const SETTLEMENT_CASES_FILE = path.join(DATA_DIR, 'settlement-cases.json')
const REQUIREMENT_BINDINGS_FILE = path.join(DATA_DIR, 'requirement-bindings.json')
const WORKFLOW_EVENTS_FILE = path.join(DATA_DIR, 'workflow-events.json')
const TREASURY_FUNDINGS_FILE = path.join(DATA_DIR, 'treasury-fundings.json')
const PAYOUT_ATTEMPTS_FILE = path.join(DATA_DIR, 'payout-attempts.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, filePath)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withFileLock<T>(filePath: string, fn: () => T): Promise<T> {
  const lockPath = `${filePath}.lock`
  const maxRetries = 5
  const retryDelayMs = 50

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      fs.writeFileSync(lockPath, '', { flag: 'wx' })
    } catch {
      if (attempt === maxRetries) {
        throw new Error(`Could not acquire lock for ${filePath} after ${maxRetries} retries`)
      }
      await sleep(retryDelayMs)
      continue
    }

    try {
      return fn()
    } finally {
      try { fs.unlinkSync(lockPath) } catch { /* ignore cleanup errors */ }
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error(`Could not acquire lock for ${filePath}`)
}

export function loadProjects(): Project[] {
  ensureDataDir()
  if (!fs.existsSync(PROJECTS_FILE)) return []
  const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8')) as Array<Project & { milestones?: Project['reports'] }>
  return raw.map((p) => ({
    ...p,
    reports: p.reports ?? p.milestones ?? [],
    milestones: undefined
  }))
}

export function saveProjects(projects: Project[]) {
  ensureDataDir()
  writeJsonAtomic(PROJECTS_FILE, projects)
}

export function loadPayments(): PaymentRecord[] {
  ensureDataDir()
  if (!fs.existsSync(PAYMENTS_FILE)) return []
  const raw = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8')) as Array<PaymentRecord>
  return raw.map((p) => ({
    ...p,
    reportId: p.reportId ?? p.milestoneId ?? '',
    reportTitle: p.reportTitle ?? p.milestoneName ?? 'Unnamed Vulnerability Report'
  }))
}

export function savePayments(payments: PaymentRecord[]) {
  ensureDataDir()
  writeJsonAtomic(PAYMENTS_FILE, payments)
}

export function loadTaskBounties(): TaskBounty[] {
  ensureDataDir()
  if (!fs.existsSync(TASKS_FILE)) return []
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')) as TaskBounty[]
}

export function saveTaskBounties(tasks: TaskBounty[]) {
  ensureDataDir()
  writeJsonAtomic(TASKS_FILE, tasks)
}

export function loadRepoConfigs(): RepoConfig[] {
  ensureDataDir()
  if (!fs.existsSync(REPO_CONFIGS_FILE)) return []
  return JSON.parse(fs.readFileSync(REPO_CONFIGS_FILE, 'utf-8')) as RepoConfig[]
}

export function saveRepoConfigs(configs: RepoConfig[]) {
  ensureDataDir()
  writeJsonAtomic(REPO_CONFIGS_FILE, configs)
}

export function loadInternalMemberBindings(): InternalMemberBinding[] {
  ensureDataDir()
  if (!fs.existsSync(INTERNAL_MEMBER_BINDINGS_FILE)) return []
  return JSON.parse(fs.readFileSync(INTERNAL_MEMBER_BINDINGS_FILE, 'utf-8')) as InternalMemberBinding[]
}

export function saveInternalMemberBindings(items: InternalMemberBinding[]) {
  ensureDataDir()
  writeJsonAtomic(INTERNAL_MEMBER_BINDINGS_FILE, items)
}

export function loadCompanies(): Company[] {
  ensureDataDir()
  if (!fs.existsSync(COMPANIES_FILE)) return []
  return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf-8')) as Company[]
}

export function saveCompanies(items: Company[]) {
  ensureDataDir()
  writeJsonAtomic(COMPANIES_FILE, items)
}

export function loadCompanyMemberships(): CompanyMembership[] {
  ensureDataDir()
  if (!fs.existsSync(COMPANY_MEMBERSHIPS_FILE)) return []
  return JSON.parse(fs.readFileSync(COMPANY_MEMBERSHIPS_FILE, 'utf-8')) as CompanyMembership[]
}

export function saveCompanyMemberships(items: CompanyMembership[]) {
  ensureDataDir()
  writeJsonAtomic(COMPANY_MEMBERSHIPS_FILE, items)
}

export function loadCompanyWallets(): CompanyWalletConfig[] {
  ensureDataDir()
  if (!fs.existsSync(COMPANY_WALLETS_FILE)) return []
  return JSON.parse(fs.readFileSync(COMPANY_WALLETS_FILE, 'utf-8')) as CompanyWalletConfig[]
}

export function saveCompanyWallets(items: CompanyWalletConfig[]) {
  ensureDataDir()
  writeJsonAtomic(COMPANY_WALLETS_FILE, items)
}

export function loadWalletIdentityBindings(): WalletIdentityBinding[] {
  ensureDataDir()
  if (!fs.existsSync(WALLET_IDENTITY_BINDINGS_FILE)) return []
  return JSON.parse(fs.readFileSync(WALLET_IDENTITY_BINDINGS_FILE, 'utf-8')) as WalletIdentityBinding[]
}

export function saveWalletIdentityBindings(items: WalletIdentityBinding[]) {
  ensureDataDir()
  writeJsonAtomic(WALLET_IDENTITY_BINDINGS_FILE, items)
}

export function loadBountyFundingLocks(): BountyFundingLock[] {
  ensureDataDir()
  if (!fs.existsSync(BOUNTY_FUNDING_LOCKS_FILE)) return []
  return JSON.parse(fs.readFileSync(BOUNTY_FUNDING_LOCKS_FILE, 'utf-8')) as BountyFundingLock[]
}

export function saveBountyFundingLocks(items: BountyFundingLock[]) {
  ensureDataDir()
  writeJsonAtomic(BOUNTY_FUNDING_LOCKS_FILE, items)
}

export function loadAuditLogs(): AuditLog[] {
  ensureDataDir()
  if (!fs.existsSync(AUDIT_LOGS_FILE)) return []
  return JSON.parse(fs.readFileSync(AUDIT_LOGS_FILE, 'utf-8')) as AuditLog[]
}

export function saveAuditLogs(items: AuditLog[]) {
  ensureDataDir()
  writeJsonAtomic(AUDIT_LOGS_FILE, items)
}

export function loadNotifications(): NotificationEvent[] {
  ensureDataDir()
  if (!fs.existsSync(NOTIFICATIONS_FILE)) return []
  return JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf-8')) as NotificationEvent[]
}

export function saveNotifications(items: NotificationEvent[]) {
  ensureDataDir()
  writeJsonAtomic(NOTIFICATIONS_FILE, items)
}

export function loadPaymentRetryJobs(): PaymentRetryJob[] {
  ensureDataDir()
  if (!fs.existsSync(PAYMENT_RETRY_JOBS_FILE)) return []
  return JSON.parse(fs.readFileSync(PAYMENT_RETRY_JOBS_FILE, 'utf-8')) as PaymentRetryJob[]
}

export function savePaymentRetryJobs(items: PaymentRetryJob[]) {
  ensureDataDir()
  writeJsonAtomic(PAYMENT_RETRY_JOBS_FILE, items)
}

export function loadSettlementCases(): SettlementCase[] {
  ensureDataDir()
  if (!fs.existsSync(SETTLEMENT_CASES_FILE)) return []
  return JSON.parse(fs.readFileSync(SETTLEMENT_CASES_FILE, 'utf-8')) as SettlementCase[]
}

export function saveSettlementCases(items: SettlementCase[]) {
  ensureDataDir()
  writeJsonAtomic(SETTLEMENT_CASES_FILE, items)
}

export function loadTreasuryFundings(): TreasuryFunding[] {
  ensureDataDir()
  if (!fs.existsSync(TREASURY_FUNDINGS_FILE)) return []
  return JSON.parse(fs.readFileSync(TREASURY_FUNDINGS_FILE, 'utf-8')) as TreasuryFunding[]
}

export function saveTreasuryFundings(items: TreasuryFunding[]) {
  ensureDataDir()
  writeJsonAtomic(TREASURY_FUNDINGS_FILE, items)
}

export function loadRequirementBindings(): RequirementBinding[] {
  ensureDataDir()
  if (!fs.existsSync(REQUIREMENT_BINDINGS_FILE)) return []
  return JSON.parse(fs.readFileSync(REQUIREMENT_BINDINGS_FILE, 'utf-8')) as RequirementBinding[]
}

export function saveRequirementBindings(items: RequirementBinding[]) {
  ensureDataDir()
  writeJsonAtomic(REQUIREMENT_BINDINGS_FILE, items)
}

export function loadWorkflowEvents(): WorkflowEvent[] {
  ensureDataDir()
  if (!fs.existsSync(WORKFLOW_EVENTS_FILE)) return []
  return JSON.parse(fs.readFileSync(WORKFLOW_EVENTS_FILE, 'utf-8')) as WorkflowEvent[]
}

export function saveWorkflowEvents(items: WorkflowEvent[]) {
  ensureDataDir()
  writeJsonAtomic(WORKFLOW_EVENTS_FILE, items)
}

export function loadPayoutAttempts(): PayoutAttempt[] {
  ensureDataDir()
  if (!fs.existsSync(PAYOUT_ATTEMPTS_FILE)) return []
  return JSON.parse(fs.readFileSync(PAYOUT_ATTEMPTS_FILE, 'utf-8')) as PayoutAttempt[]
}

export function savePayoutAttempts(items: PayoutAttempt[]) {
  ensureDataDir()
  writeJsonAtomic(PAYOUT_ATTEMPTS_FILE, items)
}

export function loadIntegrationHealthStates(): IntegrationHealthState[] {
  ensureDataDir()
  if (!fs.existsSync(INTEGRATION_HEALTH_FILE)) return []
  return JSON.parse(fs.readFileSync(INTEGRATION_HEALTH_FILE, 'utf-8')) as IntegrationHealthState[]
}

export function saveIntegrationHealthStates(items: IntegrationHealthState[]) {
  ensureDataDir()
  writeJsonAtomic(INTEGRATION_HEALTH_FILE, items)
}

export async function recordIntegrationRun(integration: IntegrationKey, status: IntegrationRunStatus, detail: string): Promise<void> {
  await withFileLock(INTEGRATION_HEALTH_FILE, () => {
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
  })
}

export function getProjectById(id: string): Project | undefined {
  return loadProjects().find(p => p.id === id)
}

export async function updateProject(updated: Project): Promise<void> {
  await withFileLock(PROJECTS_FILE, () => {
    const projects = loadProjects()
    const idx = projects.findIndex(p => p.id === updated.id)
    if (idx !== -1) projects[idx] = updated
    else projects.push(updated)
    saveProjects(projects)
  })
}
