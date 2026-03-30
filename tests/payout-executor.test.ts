import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskBounty } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  syncSettlementCaseFromTask: vi.fn(),
  startPayoutAttempt: vi.fn(),
  failPayoutAttempt: vi.fn(),
  completePayoutAttempt: vi.fn(),
  evaluateAutoPayout: vi.fn(),
  hashWorkflowPayload: vi.fn(() => 'hashed-payload')
}))

vi.mock('@/lib/repositories/settlement-case-repository', () => ({
  syncSettlementCaseFromTask: mocks.syncSettlementCaseFromTask
}))

vi.mock('@/lib/repositories/payout-attempt-repository', () => ({
  startPayoutAttempt: mocks.startPayoutAttempt,
  failPayoutAttempt: mocks.failPayoutAttempt,
  completePayoutAttempt: mocks.completePayoutAttempt
}))

vi.mock('@/lib/bounty-payout', () => ({
  evaluateAutoPayout: mocks.evaluateAutoPayout
}))

vi.mock('@/lib/workflow/events', () => ({
  hashWorkflowPayload: mocks.hashWorkflowPayload
}))

import { tryAutoPayout } from '@/lib/payout-executor'

function buildTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'Test bounty',
    description: 'test',
    source: 'external',
    rewardAmount: 0.1,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'dev',
    developerWallet: '0xrecipient',
    companyId: 'company-1',
    status: 'accepted',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides
  }
}

describe('tryAutoPayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.syncSettlementCaseFromTask.mockResolvedValue({
      id: 'settlement-1',
      payoutState: 'pending',
      payoutTxHash: undefined,
      paidAt: undefined,
      allocatedAmount: 0.1,
      amount: 0.1,
      token: 'USD1',
      recipientWalletAddress: '0xrecipient'
    })
  })

  it('returns duplicate success immediately when task is already paid with txHash', async () => {
    const task = buildTask({
      status: 'paid',
      txHash: '0xpaidtx',
      payoutWalletBindingId: 'binding-1',
      rewardLockId: 'lock-1',
      lastAutoPayoutChecks: { merged: true }
    })

    const result = await tryAutoPayout(task, { riskPassed: true })

    expect(result).toEqual({
      success: true,
      txHash: '0xpaidtx',
      duplicate: true,
      shouldRecordLedger: false,
      walletBindingId: 'binding-1',
      fundingLockId: 'lock-1',
      checks: { merged: true }
    })
    expect(mocks.startPayoutAttempt).not.toHaveBeenCalled()
  })

  it('returns duplicate success when idempotency hits a succeeded payout attempt', async () => {
    const task = buildTask()
    mocks.startPayoutAttempt.mockResolvedValue({
      kind: 'duplicate',
      attempt: {
        id: 'attempt-1',
        status: 'succeeded',
        txHash: '0xsucceeded',
        resultPayload: { merged: true }
      }
    })

    const result = await tryAutoPayout(task, { riskPassed: true, idempotencyKey: 'fixed' })

    expect(result).toEqual({
      success: true,
      txHash: '0xsucceeded',
      duplicate: true,
      shouldRecordLedger: false,
      walletBindingId: undefined,
      fundingLockId: undefined,
      checks: { merged: true }
    })
    expect(task.status).toBe('paid')
    expect(task.txHash).toBe('0xsucceeded')
  })

  it('returns in-progress error when duplicate idempotency key is still processing', async () => {
    const task = buildTask()
    mocks.startPayoutAttempt.mockResolvedValue({
      kind: 'duplicate',
      attempt: {
        id: 'attempt-processing',
        status: 'processing',
        requestPayload: { sourceTaskStatus: 'accepted' },
        resultPayload: { sourceTaskStatus: 'accepted' }
      }
    })

    const result = await tryAutoPayout(task, { riskPassed: true, idempotencyKey: 'fixed' })

    expect(result).toEqual({
      success: false,
      error: 'A payout is already in progress for this task. Please try again later.',
      checks: { sourceTaskStatus: 'accepted' }
    })
  })

  it('blocks duplicate broadcast when another active execution context exists', async () => {
    const task = buildTask()
    mocks.startPayoutAttempt.mockResolvedValue({
      kind: 'active_conflict',
      attempt: {
        id: 'attempt-active',
        status: 'processing',
        startedAt: '2026-03-29T01:02:03.000Z'
      }
    })

    const result = await tryAutoPayout(task, { riskPassed: true })

    expect(result).toEqual({
      success: false,
      error: 'An active payout execution context already exists for this settlement case. Duplicate broadcast has been blocked.',
      checks: {
        activeAttemptId: 'attempt-active',
        activeAttemptStatus: 'processing',
        activeAttemptStartedAt: '2026-03-29T01:02:03.000Z'
      }
    })
  })

  it('fails the payout attempt when evaluateAutoPayout returns failure', async () => {
    const task = buildTask()
    mocks.startPayoutAttempt.mockResolvedValue({
      kind: 'started',
      attempt: { id: 'attempt-new' }
    })
    mocks.evaluateAutoPayout.mockResolvedValue({
      success: false,
      error: 'wallet mismatch',
      checks: { reason: 'expected payer differs' }
    })

    const result = await tryAutoPayout(task, { riskPassed: true, source: 'manual_execute' })

    expect(result).toEqual({
      success: false,
      error: 'wallet mismatch',
      checks: { reason: 'expected payer differs' }
    })
    expect(mocks.failPayoutAttempt).toHaveBeenCalledWith('attempt-new', 'wallet mismatch', { reason: 'expected payer differs' })
    expect(mocks.completePayoutAttempt).not.toHaveBeenCalled()
  })

  it('completes the payout attempt and returns ledger-ready success on payout success', async () => {
    const task = buildTask()
    mocks.startPayoutAttempt.mockResolvedValue({
      kind: 'started',
      attempt: { id: 'attempt-success' }
    })
    mocks.evaluateAutoPayout.mockResolvedValue({
      success: true,
      txHash: '0xsuccess',
      walletBindingId: 'binding-2',
      fundingLockId: 'lock-2',
      transferProvider: 'evm_private_key',
      checks: { merged: true }
    })

    const result = await tryAutoPayout(task, {
      riskPassed: true,
      source: 'manual_retry',
      idempotencyKey: 'manual-retry-1'
    })

    expect(mocks.completePayoutAttempt).toHaveBeenCalledWith('attempt-success', {
      provider: 'evm_private_key',
      txHash: '0xsuccess',
      resultPayload: { merged: true }
    })
    expect(result).toEqual({
      success: true,
      txHash: '0xsuccess',
      walletBindingId: 'binding-2',
      fundingLockId: 'lock-2',
      transferProvider: 'evm_private_key',
      checks: { merged: true },
      duplicate: false,
      shouldRecordLedger: true
    })
  })
})
