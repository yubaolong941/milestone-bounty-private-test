import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettlementCase, TaskBounty } from '@/lib/types'

const state = vi.hoisted(() => ({
  settlements: [] as SettlementCase[]
}))

const dbMocks = vi.hoisted(() => ({
  hasMysqlConfig: vi.fn(() => false),
  queryMysql: vi.fn()
}))

const treasuryMocks = vi.hoisted(() => ({
  getTreasuryFundingByTxHash: vi.fn()
}))

vi.mock('@/lib/db', () => ({
  hasMysqlConfig: dbMocks.hasMysqlConfig,
  queryMysql: dbMocks.queryMysql
}))

vi.mock('@/lib/storage', () => ({
  loadSettlementCases: vi.fn(() => state.settlements),
  saveSettlementCases: vi.fn((items: SettlementCase[]) => {
    state.settlements = items
  })
}))

vi.mock('@/lib/repositories/treasury-funding-repository', () => ({
  getTreasuryFundingByTxHash: treasuryMocks.getTreasuryFundingByTxHash
}))

import {
  deriveSettlementCaseFromTask,
  markSettlementFundingLocked,
  markSettlementPayoutFailed,
  markSettlementRecipientWalletFrozen,
  markSettlementRetryQueued,
  syncSettlementCaseFromTask
} from '@/lib/repositories/settlement-case-repository'

function buildTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'Settlement task',
    description: 'desc',
    companyId: 'company-1',
    companyName: 'Acme',
    source: 'external',
    rewardAmount: 0.5,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'dev',
    developerWallet: '0xrecipient',
    status: 'awaiting_finance_review',
    claimedByGithubLogin: 'alice',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T01:00:00.000Z',
    ...overrides
  }
}

function buildSettlement(overrides: Partial<SettlementCase> = {}): SettlementCase {
  return {
    id: 'settlement-task-1',
    taskId: 'task-1',
    companyId: 'company-1',
    companyName: 'Acme',
    amount: 0.5,
    allocatedAmount: 0.5,
    token: 'USD1',
    fundingState: 'not_required',
    payoutState: 'ready',
    sourceTaskStatus: 'awaiting_finance_review',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T01:00:00.000Z',
    ...overrides
  }
}

describe('settlement-case-repository', () => {
  beforeEach(() => {
    state.settlements = []
    vi.clearAllMocks()
    dbMocks.hasMysqlConfig.mockReturnValue(false)
    treasuryMocks.getTreasuryFundingByTxHash.mockResolvedValue(null)
  })

  it('derives settlement state from task funding and payout fields', () => {
    const settlement = deriveSettlementCaseFromTask(buildTask({
      rewardLockStatus: 'locked',
      rewardLockId: 'lock-1',
      treasuryFundingTxHash: '0xtreasury',
      txHash: '0xpayout',
      paidAt: '2026-03-29T02:00:00.000Z'
    }))

    expect(settlement).toMatchObject({
      id: 'settlement-task-1',
      fundingState: 'locked',
      payoutState: 'paid',
      payoutTxHash: '0xpayout',
      treasuryFundingTxHash: '0xtreasury'
    })
  })

  it('syncs a new settlement and preserves frozen recipient wallet from existing record', async () => {
    state.settlements = [buildSettlement({
      recipientWalletAddress: '0xfrozen',
      recipientWalletFrozenAt: '2026-03-28T00:00:00.000Z',
      recipientWalletSource: 'identity_binding'
    })]

    const settlement = await syncSettlementCaseFromTask(buildTask({
      developerWallet: '0xnew-wallet',
      claimedByGithubLogin: 'bob'
    }))

    expect(settlement).toMatchObject({
      recipientWalletAddress: '0xfrozen',
      recipientWalletFrozenAt: '2026-03-28T00:00:00.000Z',
      recipientWalletSource: 'identity_binding',
      recipientGithubLogin: 'bob'
    })
  })

  it('links treasury funding metadata when funding tx exists', async () => {
    treasuryMocks.getTreasuryFundingByTxHash.mockResolvedValue({
      id: 'funding-1',
      txHash: '0xtreasury',
      linkedTaskIds: ['task-1'],
      verifiedAt: '2026-03-29T00:30:00.000Z'
    })

    const settlement = await syncSettlementCaseFromTask(buildTask({
      treasuryFundingTxHash: '0xtreasury',
      treasuryFundingVerifiedAt: '2026-03-29T00:15:00.000Z'
    }))

    expect(settlement).toMatchObject({
      treasuryFundingId: 'funding-1',
      treasuryFundingTxHash: '0xtreasury',
      allocatedAmount: 0.5,
      fundingReservedAt: '2026-03-29T00:30:00.000Z'
    })
  })

  it('freezes recipient wallet with explicit source and throws when address is missing', async () => {
    await expect(markSettlementRecipientWalletFrozen(buildTask({ developerWallet: '' }))).rejects.toThrow(
      'Missing recipient wallet address required for escrow lock'
    )

    const settlement = await markSettlementRecipientWalletFrozen(buildTask(), {
      recipientWalletAddress: '0xfinal',
      recipientWalletSource: 'manual_override'
    })

    expect(settlement).toMatchObject({
      recipientWalletAddress: '0xfinal',
      recipientWalletSource: 'manual_override'
    })
  })

  it('marks funding locked and sets payout ready for finance-ready tasks', async () => {
    const settlement = await markSettlementFundingLocked(buildTask({
      rewardLockStatus: 'locked',
      rewardLockedAmount: 1.25,
      treasuryFundingTxHash: '0xtreasury'
    }))

    expect(settlement).toMatchObject({
      fundingState: 'locked',
      payoutState: 'ready',
      allocatedAmount: 1.25,
      treasuryFundingTxHash: '0xtreasury'
    })
  })

  it('marks payout failure and retry queued using task failure state', async () => {
    await markSettlementPayoutFailed(buildTask({
      lastAutoPayoutFailureCode: 'CI_NOT_PASSED',
      lastAutoPayoutRetryStrategy: 'auto_retry',
      lastAutoPayoutError: 'ci failed',
      lastPaymentAttemptAt: '2026-03-29T03:00:00.000Z',
      status: 'payment_failed'
    }))
    const failed = state.settlements[0]

    expect(failed).toMatchObject({
      payoutState: 'failed',
      failureCode: 'CI_NOT_PASSED',
      retryStrategy: 'auto_retry',
      lastError: 'ci failed',
      lastAttemptAt: '2026-03-29T03:00:00.000Z'
    })

    await markSettlementRetryQueued(buildTask({
      id: 'task-2',
      lastAutoPayoutRetryStrategy: 'auto_retry',
      lastAutoPayoutError: 'queued again',
      lastPaymentAttemptAt: '2026-03-29T04:00:00.000Z'
    }))

    expect(state.settlements.find((item) => item.taskId === 'task-2')).toMatchObject({
      payoutState: 'failed',
      retryStrategy: 'auto_retry',
      lastError: 'queued again'
    })
  })
})
