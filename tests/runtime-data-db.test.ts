import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  IntegrationHealthState,
  NotificationEvent,
  PaymentRecord,
  Project,
  RepoConfig,
  TaskBounty,
  WalletIdentityBinding
} from '@/lib/types'

const state = vi.hoisted(() => ({
  taskBounties: [] as TaskBounty[],
  payments: [] as PaymentRecord[],
  integrationHealthStates: [] as IntegrationHealthState[],
  walletIdentityBindings: [] as WalletIdentityBinding[],
  projects: [] as Project[],
  repoConfigs: [] as RepoConfig[],
  notifications: [] as NotificationEvent[]
}))

const dbMocks = vi.hoisted(() => ({
  hasMysqlConfig: vi.fn(() => false),
  queryMysql: vi.fn()
}))

vi.mock('@/lib/db', () => ({
  hasMysqlConfig: dbMocks.hasMysqlConfig,
  queryMysql: dbMocks.queryMysql
}))

vi.mock('@/lib/storage', () => ({
  loadInternalMemberBindings: vi.fn(() => []),
  loadIntegrationHealthStates: vi.fn(() => state.integrationHealthStates),
  loadNotifications: vi.fn(() => state.notifications),
  loadProjects: vi.fn(() => state.projects),
  loadPayments: vi.fn(() => state.payments),
  loadRepoConfigs: vi.fn(() => state.repoConfigs),
  loadTaskBounties: vi.fn(() => state.taskBounties),
  loadWalletIdentityBindings: vi.fn(() => state.walletIdentityBindings),
  saveInternalMemberBindings: vi.fn(),
  saveIntegrationHealthStates: vi.fn((items: IntegrationHealthState[]) => {
    state.integrationHealthStates = items
  }),
  saveNotifications: vi.fn((items: NotificationEvent[]) => {
    state.notifications = items
  }),
  saveProjects: vi.fn((items: Project[]) => {
    state.projects = items
  }),
  savePayments: vi.fn((items: PaymentRecord[]) => {
    state.payments = items
  }),
  saveRepoConfigs: vi.fn((items: RepoConfig[]) => {
    state.repoConfigs = items
  }),
  saveTaskBounties: vi.fn((items: TaskBounty[]) => {
    state.taskBounties = items
  }),
  saveWalletIdentityBindings: vi.fn((items: WalletIdentityBinding[]) => {
    state.walletIdentityBindings = items
  })
}))

import {
  appendPaymentDb,
  findWalletIdentityBindingByGithubLoginDb,
  listPaymentsDb,
  recordIntegrationRunDb,
  upsertTaskBountyDb
} from '@/lib/runtime-data-db'

function buildTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'desc',
    source: 'external',
    rewardAmount: 1,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'dev',
    developerWallet: '0xwallet',
    status: 'accepted',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T01:00:00.000Z',
    ...overrides
  }
}

describe('runtime-data-db', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.taskBounties = []
    state.payments = []
    state.integrationHealthStates = []
    state.walletIdentityBindings = []
    dbMocks.hasMysqlConfig.mockReturnValue(false)
    delete process.env.RUNTIME_DATA_BACKEND
  })

  it('lists payments from file storage with company filtering and pagination', async () => {
    state.payments = [
      { id: 'p-1', companyId: 'company-1', projectId: 'proj', reportId: 'rep', txHash: '0x1', toAddress: '0xwallet', amount: 1, rewardToken: 'USD1', timestamp: '2026-03-29T00:00:00.000Z', projectName: '', reportTitle: '', toName: '', memo: '' },
      { id: 'p-2', companyId: 'company-1', projectId: 'proj', reportId: 'rep', txHash: '0x2', toAddress: '0xwallet', amount: 2, rewardToken: 'USD1', timestamp: '2026-03-29T01:00:00.000Z', projectName: '', reportTitle: '', toName: '', memo: '' },
      { id: 'p-3', companyId: 'company-2', projectId: 'proj', reportId: 'rep', txHash: '0x3', toAddress: '0xwallet', amount: 3, rewardToken: 'USD1', timestamp: '2026-03-29T02:00:00.000Z', projectName: '', reportTitle: '', toName: '', memo: '' }
    ]

    const items = await listPaymentsDb('company-1', { pagination: { page: 2, pageSize: 1 } })
    const normalized = Array.isArray(items) ? items : items.items

    expect(normalized).toEqual([state.payments[1]])
  })

  it('upserts task bounty through mysql and prunes shadow fields from json payload', async () => {
    process.env.RUNTIME_DATA_BACKEND = 'mysql'
    dbMocks.queryMysql.mockResolvedValue([])

    const task = buildTask({
      companyId: 'company-1',
      repo: 'acme/repo',
      claimedByGithubLogin: 'alice',
      developerWallet: '0xrecipient',
      githubIssueNumber: 42,
      aiReviewSummary: 'keep me in json payload'
    })

    await upsertTaskBountyDb(task)

    expect(dbMocks.queryMysql).toHaveBeenCalledTimes(1)
    const [, params] = dbMocks.queryMysql.mock.calls[0]
    expect(params[0]).toBe('task-1')
    expect(JSON.parse(params[12])).toEqual({
      description: 'desc',
      labels: [],
      developerName: 'dev',
      aiReviewSummary: 'keep me in json payload'
    })
  })

  it('records integration run failures then resets consecutive failures on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-29T03:00:00.000Z'))

    await recordIntegrationRunDb('github_issue_sync', 'failure', 'boom')
    expect(state.integrationHealthStates[0]).toMatchObject({
      integration: 'github_issue_sync',
      lastStatus: 'failure',
      consecutiveFailures: 1
    })

    await recordIntegrationRunDb('github_issue_sync', 'failure', 'boom again')
    expect(state.integrationHealthStates[0]?.consecutiveFailures).toBe(2)

    await recordIntegrationRunDb('github_issue_sync', 'success', 'recovered')
    expect(state.integrationHealthStates[0]).toMatchObject({
      lastStatus: 'success',
      lastDetail: 'recovered',
      consecutiveFailures: 0
    })

    vi.useRealTimers()
  })

  it('appends normalized payments and resolves wallet bindings case-insensitively in file mode', async () => {
    await appendPaymentDb({
      id: 'payment-1',
      companyId: 'company-1',
      projectId: 'project-1',
      milestoneId: 'legacy-report',
      milestoneName: 'Legacy report',
      txHash: '0xhash',
      toAddress: '0xwallet',
      amount: 5,
      rewardToken: 'USD1',
      timestamp: '2026-03-29T00:00:00.000Z'
    } as PaymentRecord)

    expect(state.payments[0]).toMatchObject({
      reportId: 'legacy-report',
      reportTitle: 'Legacy report'
    })

    state.walletIdentityBindings = [{
      id: 'binding-1',
      actorRole: 'bounty_claimer',
      githubLogin: '@Alice',
      walletAddress: '0xwallet',
      authSource: 'github_oauth_wallet_signature' as const,
      status: 'active',
      verifiedAt: '2026-03-29T00:00:00.000Z',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z'
    }]

    await expect(findWalletIdentityBindingByGithubLoginDb('alice')).resolves.toMatchObject({
      id: 'binding-1'
    })
  })
})
