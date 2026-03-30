import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireInternalUserMock = vi.fn()
const getCompanyContextMock = vi.fn()
const hasCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const getActorRoleLabelMock = vi.fn()
const insertAuditLogMock = vi.fn()
const listAuditLogsMock = vi.fn()
const paginateArrayMock = vi.fn()
const parsePaginationParamsMock = vi.fn()
const listTreasuryFundingsMock = vi.fn()
const recordTreasuryFundingMock = vi.fn()
const toTreasuryFundingRecordMock = vi.fn()
const upsertTreasuryFundingMock = vi.fn()

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'uuid-fixed')
}))

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args),
  hasCompanyCapability: (...args: unknown[]) => hasCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args),
  getActorRoleLabel: (...args: unknown[]) => getActorRoleLabelMock(...args)
}))

vi.mock('@/lib/access-control-db', () => ({
  insertAuditLog: (...args: unknown[]) => insertAuditLogMock(...args),
  listAuditLogs: (...args: unknown[]) => listAuditLogsMock(...args)
}))

vi.mock('@/lib/pagination', () => ({
  paginateArray: (...args: unknown[]) => paginateArrayMock(...args),
  parsePaginationParams: (...args: unknown[]) => parsePaginationParamsMock(...args)
}))

vi.mock('@/lib/repositories/treasury-funding-repository', () => ({
  listTreasuryFundings: (...args: unknown[]) => listTreasuryFundingsMock(...args),
  recordTreasuryFunding: (...args: unknown[]) => recordTreasuryFundingMock(...args),
  toTreasuryFundingRecord: (...args: unknown[]) => toTreasuryFundingRecordMock(...args),
  upsertTreasuryFunding: (...args: unknown[]) => upsertTreasuryFundingMock(...args)
}))

import { GET, POST } from '@/app/api/platform/treasury-fundings/route'

describe('api/platform/treasury-fundings route', () => {
  const session = { userId: 'u-1', role: 'staff', activeCompanyId: 'company-1' }

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    getCompanyContextMock.mockResolvedValue({ company: { id: 'company-1' }, membership: { role: 'company_finance' } })
    hasCompanyCapabilityMock.mockReturnValue(true)
    isPlatformAdminMock.mockReturnValue(false)
    getActorRoleLabelMock.mockReturnValue('company_finance')
    parsePaginationParamsMock.mockReturnValue(null)
    paginateArrayMock.mockImplementation((items: unknown[]) => ({ items, pagination: { total: items.length } }))
    listTreasuryFundingsMock.mockResolvedValue([])
    listAuditLogsMock.mockResolvedValue([])
    toTreasuryFundingRecordMock.mockImplementation((item: unknown) => item)
    upsertTreasuryFundingMock.mockResolvedValue(undefined)
    insertAuditLogMock.mockResolvedValue('audit-1')
    recordTreasuryFundingMock.mockResolvedValue('funding-1')
  })

  it('GET returns 400 when non-admin request has no companyId or company context', async () => {
    getCompanyContextMock.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost/api/platform/treasury-fundings'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Missing companyId' })
  })

  it('GET backfills legacy audit records for platform admin without company scope', async () => {
    isPlatformAdminMock.mockReturnValueOnce(true)
    listAuditLogsMock.mockResolvedValueOnce([
      {
        id: 'audit-1',
        companyId: 'company-1',
        actorUserId: 'u-1',
        action: 'treasury_funding.recorded',
        metadata: {
          companyName: 'Acme',
          txHash: '0x' + 'a'.repeat(64),
          amount: 5,
          tokenSymbol: 'USD1',
          source: 'wallet_payment'
        },
        createdAt: '2026-03-29T00:00:00.000Z'
      }
    ])
    listTreasuryFundingsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'funding-1', txHash: '0x' + 'a'.repeat(64) }])

    const response = await GET(new Request('http://localhost/api/platform/treasury-fundings'))
    const body = await response.json()

    expect(upsertTreasuryFundingMock).toHaveBeenCalledTimes(1)
    expect(body).toEqual([{ id: 'funding-1', txHash: '0x' + 'a'.repeat(64) }])
  })

  it('GET returns 403 when membership lacks audit capability', async () => {
    hasCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await GET(new Request('http://localhost/api/platform/treasury-fundings?companyId=company-1'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized')
  })

  it('POST rejects missing companyId and invalid txHash', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: true,
      session: { ...session, activeCompanyId: undefined }
    })

    const missingCompany = await POST(new Request('http://localhost/api/platform/treasury-fundings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash: '0x' + 'a'.repeat(64) })
    }))
    expect(missingCompany.status).toBe(400)

    const invalidHash = await POST(new Request('http://localhost/api/platform/treasury-fundings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: 'company-1', txHash: 'bad-hash' })
    }))
    expect(invalidHash.status).toBe(400)
  })

  it('POST records audit and funding entries for authorized requests', async () => {
    const response = await POST(new Request('http://localhost/api/platform/treasury-fundings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: 'company-1',
        companyName: 'Acme',
        txHash: '0x' + 'a'.repeat(64),
        amount: 5,
        tokenSymbol: 'USD1',
        network: 'bsc',
        fromAddress: '0x' + '1'.repeat(40),
        toAddress: '0x' + '2'.repeat(40)
      })
    }))
    const body = await response.json()

    expect(insertAuditLogMock).toHaveBeenCalledTimes(1)
    expect(recordTreasuryFundingMock).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      txHash: '0x' + 'a'.repeat(64),
      amount: 5,
      source: 'wallet_payment'
    }))
    expect(body).toEqual({ success: true })
  })
})
