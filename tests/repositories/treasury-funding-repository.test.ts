import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreasuryFunding } from '@/lib/types'

const state = vi.hoisted(() => ({
  fundings: [] as TreasuryFunding[]
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
  loadTreasuryFundings: vi.fn(() => state.fundings),
  saveTreasuryFundings: vi.fn((items: TreasuryFunding[]) => {
    state.fundings = items
  })
}))

import {
  allocateTreasuryFundingToTask,
  listTreasuryFundings,
  recordTreasuryFunding,
  toTreasuryFundingRecord,
  upsertTreasuryFunding
} from '@/lib/repositories/treasury-funding-repository'

function buildFunding(overrides: Partial<TreasuryFunding> = {}): TreasuryFunding {
  return {
    id: 'funding-1',
    companyId: 'company-1',
    companyName: 'Acme',
    txHash: '0x' + 'a'.repeat(64),
    amount: 10,
    allocatedAmount: 0,
    remainingAmount: 10,
    tokenSymbol: 'USD1',
    network: 'bsc',
    status: 'received',
    source: 'wallet_payment',
    linkedTaskIds: [],
    linkedTaskTitles: [],
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides
  }
}

describe('treasury-funding-repository', () => {
  beforeEach(() => {
    state.fundings = []
    vi.clearAllMocks()
    dbMocks.hasMysqlConfig.mockReturnValue(false)
  })

  it('normalizes partial allocations and filters by company in file mode', async () => {
    state.fundings = [
      buildFunding({ id: 'f-1', companyId: 'company-1', allocatedAmount: 4, remainingAmount: 6, status: 'received' }),
      buildFunding({ id: 'f-2', companyId: 'company-2', allocatedAmount: 10, remainingAmount: 0, status: 'received' })
    ]

    const items = await listTreasuryFundings('company-1')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'f-1',
      status: 'partially_allocated'
    })
  })

  it('merges duplicate funding records by txHash and metadata', async () => {
    state.fundings = [buildFunding({
      metadata: { original: true },
      recordedByUserId: 'u-1'
    })]

    const funding = await recordTreasuryFunding({
      id: 'new-id',
      companyId: 'company-1',
      txHash: '0x' + 'a'.repeat(64),
      amount: 12,
      tokenSymbol: 'USD1',
      source: 'wallet_payment',
      recordedByUserId: 'u-2',
      metadata: { api: true }
    })

    expect(funding).toMatchObject({
      id: 'funding-1',
      amount: 12,
      remainingAmount: 10,
      metadata: { original: true, api: true },
      recordedByUserId: 'u-2'
    })
  })

  it('allocates funding to tasks idempotently and exhausts when fully consumed', async () => {
    state.fundings = [buildFunding({ amount: 10, allocatedAmount: 0, remainingAmount: 10 })]

    const first = await allocateTreasuryFundingToTask({
      txHash: '0x' + 'a'.repeat(64),
      taskId: 'task-1',
      taskTitle: 'Task One',
      amount: 6
    })

    expect(first).toMatchObject({
      allocatedAmount: 6,
      remainingAmount: 4,
      status: 'partially_allocated',
      linkedTaskIds: ['task-1']
    })

    const duplicate = await allocateTreasuryFundingToTask({
      txHash: '0x' + 'a'.repeat(64),
      taskId: 'task-1',
      taskTitle: 'Task One',
      amount: 6
    })

    expect(duplicate).toMatchObject({
      allocatedAmount: 6,
      remainingAmount: 4,
      linkedTaskIds: ['task-1']
    })

    const exhausted = await allocateTreasuryFundingToTask({
      txHash: '0x' + 'a'.repeat(64),
      taskId: 'task-2',
      taskTitle: 'Task Two',
      amount: 4
    })

    expect(exhausted).toMatchObject({
      allocatedAmount: 10,
      remainingAmount: 0,
      status: 'exhausted',
      linkedTaskIds: ['task-1', 'task-2']
    })
  })

  it('converts normalized funding to legacy record shape', async () => {
    const funding = await upsertTreasuryFunding(buildFunding({
      allocatedAmount: 3,
      remainingAmount: 7,
      linkedTaskIds: ['task-1'],
      linkedTaskTitles: ['Task One']
    }))

    expect(toTreasuryFundingRecord(funding)).toEqual({
      id: 'funding-1',
      companyId: 'company-1',
      companyName: 'Acme',
      txHash: '0x' + 'a'.repeat(64),
      amount: 10,
      tokenSymbol: 'USD1',
      network: 'bsc',
      fromAddress: undefined,
      toAddress: undefined,
      taskId: 'task-1',
      taskTitle: 'Task One',
      status: 'applied',
      source: 'wallet_payment',
      createdAt: '2026-03-29T00:00:00.000Z',
      recordedByUserId: undefined
    })
  })
})
