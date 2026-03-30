import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayoutAttempt } from '@/lib/types'

const state = vi.hoisted(() => ({
  attempts: [] as PayoutAttempt[]
}))

const dbMocks = vi.hoisted(() => ({
  hasMysqlConfig: vi.fn(() => false),
  queryMysql: vi.fn()
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'attempt-uuid-1')
}))

vi.mock('@/lib/db', () => ({
  hasMysqlConfig: dbMocks.hasMysqlConfig,
  queryMysql: dbMocks.queryMysql
}))

vi.mock('@/lib/storage', () => ({
  loadPayoutAttempts: vi.fn(() => state.attempts),
  savePayoutAttempts: vi.fn((items: PayoutAttempt[]) => {
    state.attempts = items
  })
}))

import {
  completePayoutAttempt,
  failPayoutAttempt,
  getActivePayoutAttemptBySettlementCaseId,
  getPayoutAttemptByIdempotencyKey,
  startPayoutAttempt
} from '@/lib/repositories/payout-attempt-repository'

function buildAttempt(overrides: Partial<PayoutAttempt> = {}): PayoutAttempt {
  return {
    id: 'attempt-1',
    settlementCaseId: 'settlement-1',
    taskId: 'task-1',
    companyId: 'company-1',
    payoutContext: 'manual_execute',
    idempotencyKey: 'idempotency-1',
    status: 'processing',
    amount: 0.1,
    token: 'USD1',
    recipientWalletAddress: '0xrecipient',
    provider: 'mock',
    activeExecution: true,
    requestPayload: { sourceTaskStatus: 'accepted' },
    resultPayload: { merged: true },
    startedAt: '2026-03-29T00:00:00.000Z',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides
  }
}

describe('payout-attempt-repository', () => {
  beforeEach(() => {
    state.attempts = []
    vi.clearAllMocks()
    dbMocks.hasMysqlConfig.mockReturnValue(false)
  })

  it('returns attempt by idempotency key from file-backed storage', async () => {
    state.attempts = [buildAttempt()]

    await expect(getPayoutAttemptByIdempotencyKey('idempotency-1')).resolves.toMatchObject({
      id: 'attempt-1',
      idempotencyKey: 'idempotency-1'
    })
  })

  it('returns active attempt by settlement case id from file-backed storage', async () => {
    state.attempts = [buildAttempt(), buildAttempt({ id: 'attempt-2', settlementCaseId: 'settlement-2', activeExecution: false })]

    await expect(getActivePayoutAttemptBySettlementCaseId('settlement-1')).resolves.toMatchObject({
      id: 'attempt-1',
      settlementCaseId: 'settlement-1'
    })
  })

  it('returns duplicate when idempotency key already exists', async () => {
    state.attempts = [buildAttempt()]

    const result = await startPayoutAttempt({
      settlementCaseId: 'settlement-1',
      taskId: 'task-1',
      companyId: 'company-1',
      payoutContext: 'manual_execute',
      idempotencyKey: 'idempotency-1',
      amount: 0.1,
      token: 'USD1',
      recipientWalletAddress: '0xrecipient'
    })

    expect(result).toEqual({
      kind: 'duplicate',
      attempt: state.attempts[0]
    })
  })

  it('returns active_conflict when another active attempt exists for the same settlement case', async () => {
    state.attempts = [buildAttempt({ idempotencyKey: 'other-key' })]

    const result = await startPayoutAttempt({
      settlementCaseId: 'settlement-1',
      taskId: 'task-1',
      companyId: 'company-1',
      payoutContext: 'manual_execute',
      idempotencyKey: 'idempotency-new',
      amount: 0.1,
      token: 'USD1',
      recipientWalletAddress: '0xrecipient'
    })

    expect(result).toEqual({
      kind: 'active_conflict',
      attempt: state.attempts[0]
    })
  })

  it('starts and persists a new processing payout attempt when no conflict exists', async () => {
    const result = await startPayoutAttempt({
      settlementCaseId: 'settlement-1',
      taskId: 'task-1',
      companyId: 'company-1',
      payoutContext: 'manual_execute',
      idempotencyKey: 'idempotency-new',
      amount: 0.1,
      token: 'USD1',
      recipientWalletAddress: '0xrecipient',
      requestPayload: { sourceTaskStatus: 'accepted' }
    })

    expect(result.kind).toBe('started')
    expect(result.attempt).toMatchObject({
      id: 'attempt-uuid-1',
      settlementCaseId: 'settlement-1',
      status: 'processing',
      activeExecution: true,
      requestPayload: { sourceTaskStatus: 'accepted' }
    })
    expect(state.attempts).toHaveLength(1)
  })

  it('marks an existing attempt as succeeded and clears activeExecution', async () => {
    state.attempts = [buildAttempt({ id: 'attempt-complete' })]

    const updated = await completePayoutAttempt('attempt-complete', {
      provider: 'evm_private_key',
      txHash: '0xtxhash',
      resultPayload: { paid: true }
    })

    expect(updated).toMatchObject({
      id: 'attempt-complete',
      status: 'succeeded',
      provider: 'evm_private_key',
      txHash: '0xtxhash',
      activeExecution: false,
      resultPayload: { merged: true, paid: true }
    })
  })

  it('marks an existing attempt as failed and preserves merged result payload fields', async () => {
    state.attempts = [buildAttempt({ id: 'attempt-fail' })]

    const updated = await failPayoutAttempt('attempt-fail', 'wallet mismatch', { reason: 'payer differs' })

    expect(updated).toMatchObject({
      id: 'attempt-fail',
      status: 'failed',
      error: 'wallet mismatch',
      activeExecution: false,
      resultPayload: { merged: true, reason: 'payer differs' }
    })
  })
})
