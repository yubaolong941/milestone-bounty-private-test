import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireInternalUserMock = vi.fn()
const getCompanyContextMock = vi.fn()
const hasAnyCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const listPaymentsDbMock = vi.fn()
const parsePaginationParamsMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args)
}))

vi.mock('@/lib/permissions', () => ({
  hasAnyCompanyCapability: (...args: unknown[]) => hasAnyCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listPaymentsDb: (...args: unknown[]) => listPaymentsDbMock(...args)
}))

vi.mock('@/lib/pagination', () => ({
  parsePaginationParams: (...args: unknown[]) => parsePaginationParamsMock(...args)
}))

import { GET } from '@/app/api/payments/route'

describe('api/payments route', () => {
  const session = { userId: 'u-1', role: 'staff', activeCompanyId: 'company-1' }
  const payments = [{
    id: 'pay-1',
    projectName: 'Acme',
    reportTitle: 'Fix',
    amount: 1,
    toName: 'Bob',
    toAddress: '0xrecipient',
    txHash: '0xtx',
    timestamp: '2026-03-29T00:00:00.000Z',
    repo: 'acme/repo',
    issueNumber: 1,
    claimerGithubLogin: 'bob',
    rewardToken: 'USD1'
  }]

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    getCompanyContextMock.mockResolvedValue({ company: { id: 'company-1' }, membership: { role: 'company_finance' } })
    hasAnyCompanyCapabilityMock.mockReturnValue(true)
    isPlatformAdminMock.mockReturnValue(false)
    listPaymentsDbMock.mockResolvedValue(payments)
    parsePaginationParamsMock.mockReturnValue(null)
  })

  it('returns auth response when unauthorized', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })
    const response = await GET(new Request('http://localhost/api/payments'))
    expect(response.status).toBe(401)
  })

  it('returns 403 when no active company context exists for non-admin users', async () => {
    getCompanyContextMock.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost/api/payments'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'No active company context selected' })
  })

  it('returns csv for platform admins without company scope', async () => {
    isPlatformAdminMock.mockReturnValueOnce(true)
    requireInternalUserMock.mockReturnValueOnce({
      ok: true,
      session: { ...session, activeCompanyId: undefined }
    })
    getCompanyContextMock.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost/api/payments?format=csv'))
    const text = await response.text()

    expect(listPaymentsDbMock).toHaveBeenCalledWith(undefined, { pagination: undefined })
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(text).toContain('id,projectName')
    expect(text).toContain('pay-1')
  })

  it('returns paginated json for authorized company members', async () => {
    parsePaginationParamsMock.mockReturnValueOnce({ page: 2, pageSize: 5, offset: 5, limit: 5 })

    const response = await GET(new Request('http://localhost/api/payments?page=2&pageSize=5'))
    const body = await response.json()

    expect(listPaymentsDbMock).toHaveBeenCalledWith('company-1', {
      pagination: { page: 2, pageSize: 5, offset: 5, limit: 5 }
    })
    expect(body.items).toEqual(payments)
    expect(body.pagination).toMatchObject({ page: 2, pageSize: 5 })
  })

  it('returns 403 when membership lacks payment visibility capability', async () => {
    hasAnyCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await GET(new Request('http://localhost/api/payments'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Unauthorized to view')
  })
})
