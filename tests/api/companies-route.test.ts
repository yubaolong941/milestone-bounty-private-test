import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/companies/route'

const requireInternalUserMock = vi.fn()
const withSessionMock = vi.fn()
const getActorRoleLabelMock = vi.fn()
const hasCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()

const getCompanyByIdMock = vi.fn()
const getCompanyBySlugMock = vi.fn()
const getMembershipMock = vi.fn()
const insertAuditLogMock = vi.fn()
const insertCompanyMock = vi.fn()
const insertMembershipMock = vi.fn()
const listCompanyWalletsMock = vi.fn()
const listCompaniesForUserMock = vi.fn()
const listMembershipsMock = vi.fn()
const updateCompanyFieldsMock = vi.fn()

const deriveCompanyOnboardingStateMock = vi.fn()
const listIntegrationHealthStatesDbMock = vi.fn()
const listRepoConfigsDbMock = vi.fn()
const listTaskBountiesDbMock = vi.fn()

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`
}))

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  withSession: (...args: unknown[]) => withSessionMock(...args),
  getActorRoleLabel: (...args: unknown[]) => getActorRoleLabelMock(...args),
  hasCompanyCapability: (...args: unknown[]) => hasCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args)
}))

vi.mock('@/lib/access-control-db', () => ({
  getCompanyById: (...args: unknown[]) => getCompanyByIdMock(...args),
  getCompanyBySlug: (...args: unknown[]) => getCompanyBySlugMock(...args),
  getMembership: (...args: unknown[]) => getMembershipMock(...args),
  insertAuditLog: (...args: unknown[]) => insertAuditLogMock(...args),
  insertCompany: (...args: unknown[]) => insertCompanyMock(...args),
  insertMembership: (...args: unknown[]) => insertMembershipMock(...args),
  listCompanyWallets: (...args: unknown[]) => listCompanyWalletsMock(...args),
  listCompaniesForUser: (...args: unknown[]) => listCompaniesForUserMock(...args),
  listMemberships: (...args: unknown[]) => listMembershipsMock(...args),
  updateCompanyFields: (...args: unknown[]) => updateCompanyFieldsMock(...args)
}))

vi.mock('@/lib/onboarding', () => ({
  deriveCompanyOnboardingState: (...args: unknown[]) => deriveCompanyOnboardingStateMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listIntegrationHealthStatesDb: (...args: unknown[]) => listIntegrationHealthStatesDbMock(...args),
  listRepoConfigsDb: (...args: unknown[]) => listRepoConfigsDbMock(...args),
  listTaskBountiesDb: (...args: unknown[]) => listTaskBountiesDbMock(...args)
}))

describe('api/companies route', () => {
  const session = {
    userId: 'user-1',
    githubLogin: 'alice',
    walletAddress: '0x' + 'a'.repeat(40),
    activeCompanyId: 'company-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0

    requireInternalUserMock.mockReturnValue({ ok: true, session })
    withSessionMock.mockImplementation((_nextSession: unknown, response: Response) => response)
    getActorRoleLabelMock.mockReturnValue('company_owner')
    hasCompanyCapabilityMock.mockReturnValue(true)
    isPlatformAdminMock.mockReturnValue(false)

    listCompaniesForUserMock.mockResolvedValue([])
    listMembershipsMock.mockResolvedValue([])
    listCompanyWalletsMock.mockResolvedValue([])
    listRepoConfigsDbMock.mockResolvedValue([])
    listTaskBountiesDbMock.mockResolvedValue([])
    listIntegrationHealthStatesDbMock.mockResolvedValue([])
    deriveCompanyOnboardingStateMock.mockReturnValue({ phase: 'ready' })
  })

  it('GET returns auth response when unauthenticated', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/companies'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET returns enriched companies with onboarding summary', async () => {
    listCompaniesForUserMock.mockResolvedValueOnce([
      { id: 'company-1', name: 'Alpha' },
      { id: 'company-2', name: 'Beta' }
    ])
    listRepoConfigsDbMock.mockResolvedValueOnce([{ id: 'r1', companyId: 'company-1' }])
    listTaskBountiesDbMock.mockResolvedValueOnce([{ id: 't2', companyId: 'company-2' }])

    const response = await GET(new Request('http://localhost/api/companies'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0]).toMatchObject({ id: 'company-1', onboarding: { phase: 'ready' } })
    expect(body[1]).toMatchObject({ id: 'company-2', onboarding: { phase: 'ready' } })
    expect(deriveCompanyOnboardingStateMock).toHaveBeenCalledTimes(2)
  })

  it('POST create validates required company name', async () => {
    const response = await POST(
      new Request('http://localhost/api/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: '   ' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Missing company name' })
    expect(insertCompanyMock).not.toHaveBeenCalled()
  })

  it('POST create retries slug on collision and persists company + membership', async () => {
    getCompanyBySlugMock
      .mockResolvedValueOnce({ id: 'existing', slug: 'acme' })
      .mockResolvedValueOnce(undefined)

    const response = await POST(
      new Request('http://localhost/api/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: 'Acme' })
      })
    )
    const body = await response.json()

    expect(insertCompanyMock).toHaveBeenCalledTimes(1)
    expect(insertMembershipMock).toHaveBeenCalledTimes(1)
    expect(insertCompanyMock.mock.calls[0][0]).toMatchObject({
      id: 'uuid-1',
      slug: 'acme-1',
      name: 'Acme',
      createdByUserId: 'user-1'
    })
    expect(body).toMatchObject({
      success: true,
      company: { id: 'uuid-1', slug: 'acme-1' },
      membership: { id: 'uuid-2', role: 'company_owner' }
    })
    expect(withSessionMock).toHaveBeenCalledTimes(1)
  })

  it('POST update returns 403 when user lacks company.manage capability', async () => {
    getCompanyByIdMock.mockResolvedValueOnce({ id: 'company-1', name: 'Acme' })
    getMembershipMock.mockResolvedValueOnce({ companyId: 'company-1', role: 'company_member' })
    hasCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await POST(
      new Request('http://localhost/api/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: 'company-1', name: 'New Name' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Not authorized to modify this company' })
    expect(updateCompanyFieldsMock).not.toHaveBeenCalled()
  })

  it('POST switchActiveCompany rejects non-member users', async () => {
    getCompanyByIdMock.mockResolvedValueOnce({ id: 'company-2', name: 'Beta' })
    getMembershipMock.mockResolvedValueOnce(undefined)

    const response = await POST(
      new Request('http://localhost/api/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'switchActiveCompany', id: 'company-2' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'You are not a member of this company' })
  })
})
