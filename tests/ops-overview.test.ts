import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditLog, IntegrationHealthState, NotificationEvent, PaymentRecord, TaskBounty } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  listTaskBountiesDb: vi.fn<() => Promise<TaskBounty[]>>(),
  listPaymentsDb: vi.fn<() => Promise<PaymentRecord[]>>(),
  listNotificationsDb: vi.fn<() => Promise<NotificationEvent[]>>(),
  listIntegrationHealthStatesDb: vi.fn<() => Promise<IntegrationHealthState[]>>(),
  listAuditLogs: vi.fn<() => Promise<AuditLog[]>>()
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listTaskBountiesDb: mocks.listTaskBountiesDb,
  listPaymentsDb: mocks.listPaymentsDb,
  listNotificationsDb: mocks.listNotificationsDb,
  listIntegrationHealthStatesDb: mocks.listIntegrationHealthStatesDb
}))

vi.mock('@/lib/access-control-db', () => ({
  listAuditLogs: mocks.listAuditLogs
}))

import { getOpsOverview, listOpsScenarios, renderOpsMarkdown } from '@/lib/ops-overview'

function makeTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'desc',
    source: 'external',
    rewardAmount: 100,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'alice',
    developerWallet: '0x' + '1'.repeat(40),
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1',
    projectId: 'p1',
    projectName: 'Project',
    reportId: 'r1',
    reportTitle: 'Report',
    amount: 100,
    toAddress: '0x' + '2'.repeat(40),
    toName: 'alice',
    txHash: '0x' + '3'.repeat(64),
    memo: 'memo',
    timestamp: new Date().toISOString(),
    ...overrides
  }
}

function makeNotification(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: 'n1',
    severity: 'warning',
    channel: 'inbox',
    category: 'manual_review',
    title: 'Need review',
    message: 'review pending',
    acknowledged: false,
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

function makeIntegration(overrides: Partial<IntegrationHealthState> = {}): IntegrationHealthState {
  return {
    integration: 'github_issue_sync',
    lastStatus: 'success',
    lastDetail: 'ok',
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

function makeAudit(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'a1',
    actorUserId: 'u1',
    action: 'task.update',
    targetType: 'task',
    targetId: 'task-1',
    summary: 'updated',
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

describe('ops-overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTaskBountiesDb.mockResolvedValue([])
    mocks.listPaymentsDb.mockResolvedValue([])
    mocks.listNotificationsDb.mockResolvedValue([])
    mocks.listIntegrationHealthStatesDb.mockResolvedValue([])
    mocks.listAuditLogs.mockResolvedValue([])
  })

  it('returns all configured scenarios for selector UI', () => {
    const scenarios = listOpsScenarios()
    expect(scenarios.map((item) => item.id)).toEqual(['live', 'stable_exec', 'payment_recovery', 'client_weekly'])
  })

  it('returns demo overview when scenarioId is non-live', async () => {
    const snapshot = await getOpsOverview({ scenarioId: 'payment_recovery' })
    expect(snapshot.mode).toBe('demo')
    expect(snapshot.scenarioId).toBe('payment_recovery')
    expect(snapshot.health).toBe('critical')
    expect(snapshot.kpis.length).toBeGreaterThan(0)
  })

  it('builds live overview and marks health critical when payment failures or critical alerts exist', async () => {
    mocks.listTaskBountiesDb.mockResolvedValue([
      makeTask({ id: 't-paid', status: 'paid' }),
      makeTask({ id: 't-failed', status: 'payment_failed', lastAutoPayoutRetryStrategy: 'manual_retry' }),
      makeTask({ id: 't-review', status: 'awaiting_manual_review', manualReviewRequired: true })
    ])
    mocks.listPaymentsDb.mockResolvedValue([makePayment()])
    mocks.listNotificationsDb.mockResolvedValue([
      makeNotification({ severity: 'critical', category: 'payment_failure', title: 'Payout failed' })
    ])
    mocks.listIntegrationHealthStatesDb.mockResolvedValue([
      makeIntegration({ integration: 'github_issue_sync' }),
      makeIntegration({ integration: 'meegle_sync', lastStatus: 'failure', lastDetail: 'timeout' })
    ])
    mocks.listAuditLogs.mockResolvedValue([makeAudit()])

    const snapshot = await getOpsOverview({ scenarioId: 'live' })
    expect(snapshot.mode).toBe('live')
    expect(snapshot.health).toBe('critical')
    expect(snapshot.kpis.length).toBe(6)
    expect(snapshot.blockers.length).toBeGreaterThan(0)
    expect(snapshot.retryPolicy).toContain('manual_retry')
  })

  it('filters by company scope and renders markdown report with blockers and metrics', async () => {
    mocks.listTaskBountiesDb.mockResolvedValue([
      makeTask({ id: 't-c1', companyId: 'c1', status: 'awaiting_finance_review' }),
      makeTask({ id: 't-c2', companyId: 'c2', status: 'open' }),
      makeTask({ id: 't-global', status: 'accepted' })
    ])
    mocks.listPaymentsDb.mockResolvedValue([
      makePayment({ id: 'p-c1', companyId: 'c1' }),
      makePayment({ id: 'p-c2', companyId: 'c2' })
    ])
    mocks.listNotificationsDb.mockResolvedValue([makeNotification({ companyId: 'c1', title: 'Finance queue pending' })])
    mocks.listIntegrationHealthStatesDb.mockResolvedValue([makeIntegration({ integration: 'github_issue_sync' })])
    mocks.listAuditLogs.mockResolvedValue([makeAudit({ companyId: 'c1' })])

    const snapshot = await getOpsOverview({ companyId: 'c1' })
    expect(snapshot.companyScope).toBe('c1')
    expect(snapshot.audit.exportUrl).toContain('companyId=c1')

    const markdown = renderOpsMarkdown(snapshot, 'daily')
    expect(markdown).toContain('# Daily Ops Report')
    expect(markdown).toContain('## Key Metrics')
    expect(markdown).toContain('## Current Blockers')
  })
})
