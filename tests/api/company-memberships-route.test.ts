import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/company-memberships/route'

const requireInternalUserMock = vi.fn()
const getActorRoleLabelMock = vi.fn()
const hasCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const getCompanyByIdMock = vi.fn()
const getMembershipMock = vi.fn()
const getMembershipForIdentityMock = vi.fn()
const getMembershipByIdMock = vi.fn()
const insertAuditLogMock = vi.fn()
const insertMembershipMock = vi.fn()
const listMembershipsMock = vi.fn()
const updateMembershipMock = vi.fn()

vi.mock('uuid', () => ({
  v4: () => 'membership-uuid'
}))

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  getActorRoleLabel: (...args: unknown[]) => getActorRoleLabelMock(...args),
  hasCompanyCapability: (...args: unknown[]) => hasCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args)
}))

vi.mock('@/lib/access-control-db', () => ({
  getCompanyById: (...args: unknown[]) => getCompanyByIdMock(...args),
  getMembership: (...args: unknown[]) => getMembershipMock(...args),
  getMembershipForIdentity: (...args: unknown[]) => getMembershipForIdentityMock(...args),
  getMembershipById: (...args: unknown[]) => getMembershipByIdMock(...args),
  insertAuditLog: (...args: unknown[]) => insertAuditLogMock(...args),
  insertMembership: (...args: unknown[]) => insertMembershipMock(...args),
  listMemberships: (...args: unknown[]) => listMembershipsMock(...args),
  updateMembership: (...args: unknown[]) => updateMembershipMock(...args)
}))

describe('api/company-memberships route', () => {
  const session = {
    userId: 'user-1',
    role: 'staff',
    githubLogin: 'alice',
    activeCompanyId: 'company-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    getActorRoleLabelMock.mockReturnValue('company_admin')
    hasCompanyCapabilityMock.mockReturnValue(true)
    isPlatformAdminMock.mockReturnValue(false)
    getCompanyByIdMock.mockResolvedValue({ id: 'company-1', name: 'Demo Co' })
    getMembershipForIdentityMock.mockResolvedValue({ id: 'm-1', role: 'company_admin' })
    getMembershipMock.mockResolvedValue(null)
    listMembershipsMock.mockResolvedValue([])
    insertMembershipMock.mockImplementation(async (item: unknown) => item)
    updateMembershipMock.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ id: 'm-1', ...patch }))
  })

  it('GET returns auth response when user is not internal', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/company-memberships'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 400 when companyId is missing', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: true,
      session: { ...session, activeCompanyId: undefined }
    })

    const response = await GET(new Request('http://localhost/api/company-memberships'))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toBe('Missing companyId')
  })

  it('GET returns 403 when membership lacks member.manage capability', async () => {
    hasCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await GET(new Request('http://localhost/api/company-memberships?companyId=company-1'))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized')
  })

  it('POST create returns 400 on validation failure (missing userId)', async () => {
    const response = await POST(new Request('http://localhost/api/company-memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', companyId: 'company-1' })
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Validation failed')
  })

  it('POST create returns 404 when company does not exist', async () => {
    getCompanyByIdMock.mockResolvedValueOnce(null)

    const response = await POST(new Request('http://localhost/api/company-memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', companyId: 'company-404', userId: 'u-2' })
    }))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Company not found')
  })

  it('POST create returns 403 when operator lacks member.manage capability', async () => {
    hasCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await POST(new Request('http://localhost/api/company-memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', companyId: 'company-1', userId: 'u-2' })
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized')
  })

  it('POST create succeeds and writes membership + audit log', async () => {
    const response = await POST(new Request('http://localhost/api/company-memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        companyId: 'company-1',
        userId: 'u-2',
        githubLogin: 'bob',
        role: 'company_reviewer'
      })
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(insertMembershipMock).toHaveBeenCalledTimes(1)
    expect(insertAuditLogMock).toHaveBeenCalledTimes(1)
    expect(body.success).toBe(true)
    expect(body.membership.id).toBe('membership-uuid')
  })

  it('POST updateRole returns 404 when target membership does not exist', async () => {
    getMembershipByIdMock.mockResolvedValueOnce(null)

    const response = await POST(new Request('http://localhost/api/company-memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'updateRole', companyId: 'company-1', id: 'missing', role: 'company_owner' })
    }))
    const body = await response.json()
    expect(response.status).toBe(404)
    expect(body.error).toBe('Member not found')
  })
})
