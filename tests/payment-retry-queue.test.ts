import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentRetryJob, TaskBounty } from '@/lib/types'

const state = vi.hoisted(() => ({
  jobs: [] as PaymentRetryJob[],
  tasks: {} as Record<string, TaskBounty | undefined>
}))

const mocks = vi.hoisted(() => ({
  appendAgentLedgerRecord: vi.fn(),
  notifyTaskIssue: vi.fn(),
  recordAuditEvent: vi.fn(),
  transitionTaskStatus: vi.fn(),
  tryAutoPayout: vi.fn(),
  markSettlementPaid: vi.fn(),
  markSettlementPayoutFailed: vi.fn(),
  markSettlementRetryQueued: vi.fn(),
  syncSettlementCaseFromTask: vi.fn(),
  getTaskBountyByIdDb: vi.fn(async (taskId: string) => state.tasks[taskId] ?? null),
  saveTaskBountiesDb: vi.fn(),
  getActiveRetryJobForTaskDb: vi.fn(async (taskId: string) =>
    state.jobs.find((j) => j.taskId === taskId && ['pending', 'processing'].includes(j.status)) ?? null
  ),
  upsertPaymentRetryJobDb: vi.fn(async (job: PaymentRetryJob) => {
    const idx = state.jobs.findIndex((j) => j.id === job.id)
    if (idx >= 0) state.jobs[idx] = job; else state.jobs.unshift(job)
  }),
  listPaymentRetryJobsDb: vi.fn(async (input?: { status?: string; limit?: number }) => {
    let jobs = [...state.jobs]
    if (input?.status) jobs = jobs.filter((j) => j.status === input.status)
    return jobs.slice(0, input?.limit || 50)
  }),
  savePaymentRetryJobsDb: vi.fn()
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'retry-job-uuid-1')
}))

vi.mock('@/lib/bounty-payout', () => ({
  appendAgentLedgerRecord: mocks.appendAgentLedgerRecord
}))

vi.mock('@/lib/operations', () => ({
  notifyTaskIssue: mocks.notifyTaskIssue,
  recordAuditEvent: mocks.recordAuditEvent,
  transitionTaskStatus: mocks.transitionTaskStatus
}))

vi.mock('@/lib/payout-executor', () => ({
  tryAutoPayout: mocks.tryAutoPayout
}))

vi.mock('@/lib/storage', () => ({
  loadPaymentRetryJobs: vi.fn(() => state.jobs),
  savePaymentRetryJobs: vi.fn((jobs: PaymentRetryJob[]) => {
    state.jobs = jobs
  })
}))

vi.mock('@/lib/repositories/settlement-case-repository', () => ({
  markSettlementPaid: mocks.markSettlementPaid,
  markSettlementPayoutFailed: mocks.markSettlementPayoutFailed,
  markSettlementRetryQueued: mocks.markSettlementRetryQueued,
  syncSettlementCaseFromTask: mocks.syncSettlementCaseFromTask
}))

vi.mock('@/lib/runtime-data-db', () => ({
  getTaskBountyByIdDb: mocks.getTaskBountyByIdDb,
  saveTaskBountiesDb: mocks.saveTaskBountiesDb,
  getActiveRetryJobForTaskDb: mocks.getActiveRetryJobForTaskDb,
  upsertPaymentRetryJobDb: mocks.upsertPaymentRetryJobDb,
  listPaymentRetryJobsDb: mocks.listPaymentRetryJobsDb,
  savePaymentRetryJobsDb: mocks.savePaymentRetryJobsDb
}))

import { enqueueAutoRetryForTask, processDuePaymentRetryJobs } from '@/lib/payment-retry-queue'

function buildTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'Retry payout task',
    description: 'test',
    companyId: 'company-1',
    source: 'external',
    rewardAmount: 0.1,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'dev',
    developerWallet: '0xrecipient',
    status: 'accepted',
    paymentFailureCount: 0,
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides
  }
}

function buildJob(overrides: Partial<PaymentRetryJob> = {}): PaymentRetryJob {
  return {
    id: 'job-1',
    taskId: 'task-1',
    companyId: 'company-1',
    taskTitle: 'Retry payout task',
    failureCode: 'CI_NOT_PASSED',
    retryStrategy: 'auto_retry',
    status: 'pending',
    source: 'scheduler',
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: '2026-03-29T00:00:00.000Z',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides
  }
}

describe('payment-retry-queue', () => {
  beforeEach(() => {
    state.jobs = []
    state.tasks = {}
    vi.clearAllMocks()
    mocks.getTaskBountyByIdDb.mockImplementation(async (taskId: string) => state.tasks[taskId] ?? null)
  })

  it('enqueues a new auto-retry job and updates task retry pointers', async () => {
    const task = buildTask()

    const result = await enqueueAutoRetryForTask({
      task,
      classification: {
        code: 'CI_NOT_PASSED',
        retryStrategy: 'auto_retry',
        nextAction: 'retry_automatically'
      },
      source: 'auto_payout',
      error: 'ci pending',
      metadata: { run: 1 }
    })

    expect(result).toMatchObject({
      queued: true,
      deduped: false
    })
    expect(result.job).toMatchObject({
      id: 'retry-job-uuid-1',
      taskId: 'task-1',
      failureCode: 'CI_NOT_PASSED',
      retryStrategy: 'auto_retry',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      lastError: 'ci pending',
      metadata: { run: 1 }
    })
    expect(state.jobs).toHaveLength(1)
    expect(task.autoRetryJobId).toBe('retry-job-uuid-1')
    expect(task.nextAutoRetryAt).toBe(state.jobs[0]?.scheduledAt)
  })

  it('dedupes an active retry job and refreshes its schedule and metadata', async () => {
    const task = buildTask()
    state.jobs = [
      buildJob({
        id: 'job-active',
        source: 'auto_payout',
        lastError: 'old error',
        metadata: { old: true }
      })
    ]

    const result = await enqueueAutoRetryForTask({
      task,
      classification: {
        code: 'MERGE_NOT_COMPLETE',
        retryStrategy: 'auto_retry',
        nextAction: 'retry_automatically'
      },
      source: 'github_webhook',
      error: 'pr not merged yet',
      metadata: { refreshed: true }
    })

    expect(result).toMatchObject({
      queued: true,
      deduped: true
    })
    expect(state.jobs[0]).toMatchObject({
      id: 'job-active',
      failureCode: 'MERGE_NOT_COMPLETE',
      retryStrategy: 'auto_retry',
      nextAction: 'retry_automatically',
      lastError: 'pr not merged yet',
      metadata: { old: true, refreshed: true }
    })
    expect(task.autoRetryJobId).toBe('job-active')
    expect(task.nextAutoRetryAt).toBe(state.jobs[0]?.scheduledAt)
  })

  it('cancels a due job when the task is already paid', async () => {
    const task = buildTask({ status: 'paid', autoRetryJobId: 'job-1', nextAutoRetryAt: '2026-03-29T00:00:00.000Z' })
    state.tasks[task.id] = task
    state.jobs = [buildJob()]

    const result = await processDuePaymentRetryJobs({
      now: new Date('2026-03-29T00:10:00.000Z')
    })

    expect(result).toMatchObject({
      success: true,
      processed: 1,
      queueDepth: 0
    })
    expect(result.results[0]).toMatchObject({
      jobId: 'job-1',
      taskId: 'task-1',
      success: false,
      detail: 'task_paid'
    })
    expect(state.jobs[0]).toMatchObject({
      status: 'cancelled',
      lastError: 'Task status=paid. Auto-retry cancelled.'
    })
    expect(task.autoRetryJobId).toBeUndefined()
    expect(task.nextAutoRetryAt).toBeUndefined()
    expect(mocks.syncSettlementCaseFromTask).toHaveBeenCalledWith(task)
  })

  it('requeues a failed retry when classification remains auto-retry eligible', async () => {
    const task = buildTask({ autoRetryJobId: 'job-1' })
    state.tasks[task.id] = task
    state.jobs = [buildJob()]
    mocks.tryAutoPayout.mockResolvedValue({
      success: false,
      error: 'ci still pending',
      checks: { ciPassed: false }
    })

    const result = await processDuePaymentRetryJobs({
      now: new Date('2026-03-29T00:10:00.000Z')
    })

    expect(result.results[0]).toMatchObject({
      jobId: 'job-1',
      taskId: 'task-1',
      success: false,
      detail: 'ci still pending',
      failureCode: 'CI_NOT_PASSED'
    })
    expect(state.jobs[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      failureCode: 'CI_NOT_PASSED',
      retryStrategy: 'auto_retry',
      nextAction: 'retry_automatically',
      lastError: 'ci still pending'
    })
    expect(task.paymentFailureCount).toBe(1)
    expect(task.autoRetryJobId).toBe('job-1')
    expect(task.nextAutoRetryAt).toBe(state.jobs[0]?.scheduledAt)
    expect(task.lastAutoPayoutFailureCode).toBe('CI_NOT_PASSED')
    expect(mocks.markSettlementRetryQueued).toHaveBeenCalledWith(task)
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payment.retry.failed',
      targetId: 'task-1'
    }))
  })

  it('dead-letters a failed retry that is not eligible for auto-retry and escalates manual review', async () => {
    const task = buildTask({ autoRetryJobId: 'job-1' })
    state.tasks[task.id] = task
    state.jobs = [buildJob()]
    mocks.tryAutoPayout.mockResolvedValue({
      success: false,
      error: 'Current payout wallet does not match expected',
      checks: { payer: 'mismatch' }
    })

    const result = await processDuePaymentRetryJobs({
      now: new Date('2026-03-29T00:10:00.000Z')
    })

    expect(result.results[0]).toMatchObject({
      jobId: 'job-1',
      taskId: 'task-1',
      success: false,
      detail: 'Current payout wallet does not match expected',
      failureCode: 'PAYER_WALLET_MISMATCH',
      nextAutoRetryAt: null
    })
    expect(state.jobs[0]).toMatchObject({
      status: 'dead_letter',
      attempts: 1,
      lastError: 'Current payout wallet does not match expected'
    })
    expect(task.autoRetryJobId).toBeUndefined()
    expect(task.nextAutoRetryAt).toBeUndefined()
    expect(task.lastAutoPayoutFailureCode).toBe('PAYER_WALLET_MISMATCH')
    expect(mocks.transitionTaskStatus).toHaveBeenCalledWith(task, 'payment_failed', {
      manualReviewRequired: true,
      reason: 'Current payout wallet does not match expected'
    })
    expect(mocks.notifyTaskIssue).toHaveBeenCalledOnce()
    expect(mocks.markSettlementPayoutFailed).toHaveBeenCalledWith(task, {
      failureCode: 'PAYER_WALLET_MISMATCH',
      retryStrategy: 'manual_retry',
      lastError: 'Current payout wallet does not match expected'
    })
  })

  it('completes a successful retry and records settlement and ledger side effects', async () => {
    const task = buildTask({ autoRetryJobId: 'job-1' })
    state.tasks[task.id] = task
    state.jobs = [buildJob()]
    mocks.tryAutoPayout.mockResolvedValue({
      success: true,
      txHash: '0xtxhash',
      walletBindingId: 'binding-1',
      fundingLockId: 'lock-1',
      checks: { merged: true }
    })
    mocks.appendAgentLedgerRecord.mockResolvedValue({ id: 'ledger-1' })

    const result = await processDuePaymentRetryJobs({
      now: new Date('2026-03-29T00:10:00.000Z')
    })

    expect(result.results[0]).toMatchObject({
      jobId: 'job-1',
      taskId: 'task-1',
      success: true,
      txHash: '0xtxhash',
      attempts: 1
    })
    expect(state.jobs[0]).toMatchObject({
      status: 'completed',
      attempts: 1
    })
    expect(task.autoRetryJobId).toBeUndefined()
    expect(task.nextAutoRetryAt).toBeUndefined()
    expect(mocks.markSettlementPaid).toHaveBeenCalledWith(task)
    expect(mocks.appendAgentLedgerRecord).toHaveBeenCalledWith({
      task,
      payout: {
        success: true,
        txHash: '0xtxhash',
        walletBindingId: 'binding-1',
        fundingLockId: 'lock-1',
        checks: { merged: true }
      }
    })
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payment.retry.succeeded',
      metadata: expect.objectContaining({
        txHash: '0xtxhash',
        ledgerId: 'ledger-1'
      })
    }))
  })
})
