import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCompanyContext,
  getSessionFromRequest,
  requireAnyCompanyCapability,
  requireCompanyCapability,
  requireCompanyRoles,
  requireInternalUser,
  requireRoles
} from '@/lib/auth'
import { encodeSession } from '@/lib/session-node'
import type { Company, CompanyMembership } from '@/lib/types'
import type { SessionUser } from '@/lib/session'

const mocks = vi.hoisted(() => ({
  getCompanyById: vi.fn(),
  getMembershipForIdentity: vi.fn(),
  listActiveMembershipsForIdentity: vi.fn(),
  listCompanies: vi.fn()
}))

vi.mock('@/lib/access-control-db', () => ({
  getCompanyById: (...args: unknown[]) => mocks.getCompanyById(...args),
  getMembershipForIdentity: (...args: unknown[]) => mocks.getMembershipForIdentity(...args),
  listActiveMembershipsForIdentity: (...args: unknown[]) => mocks.listActiveMembershipsForIdentity(...args),
  listCompanies: (...args: unknown[]) => mocks.listCompanies(...args)
}))

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: 'user-1',
    role: 'staff',
    githubLogin: 'alice',
    ...overrides
  }
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    slug: 'demo',
    name: 'Demo Co',
    status: 'active',
    createdByUserId: 'user-admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeMembership(overrides: Partial<CompanyMembership> = {}): CompanyMembership {
  return {
    id: 'membership-1',
    companyId: 'company-1',
    userId: 'user-1',
    role: 'company_admin',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeReq(session?: SessionUser) {
  const headers: Record<string, string> = {}
  if (session) {
    headers.cookie = `bp_session=${encodeSession(session)}`
  }
  return new Request('http://localhost/api/test', { headers })
}

async function responseErrorMessage(result: { ok: false; response: Response }) {
  const data = await result.response.json() as { error?: string }
  return data.error
}

describe('auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCompanyById.mockResolvedValue(null)
    mocks.getMembershipForIdentity.mockResolvedValue(null)
    mocks.listActiveMembershipsForIdentity.mockResolvedValue([])
    mocks.listCompanies.mockResolvedValue([])
  })

  it('getSessionFromRequest returns null when cookie is missing', () => {
    const session = getSessionFromRequest(makeReq())
    expect(session).toBeNull()
  })

  it('requireRoles returns 401 when not logged in', async () => {
    const result = requireRoles(makeReq(), ['staff'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect(await responseErrorMessage(result)).toBe('Not logged in')
    }
  })

  it('requireRoles returns 403 when role is not allowed', async () => {
    const result = requireRoles(makeReq(makeSession({ role: 'external_contributor' })), ['staff'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect(await responseErrorMessage(result)).toBe('Access denied')
    }
  })

  it('requireRoles returns ok for allowed role', () => {
    const session = makeSession({ role: 'reviewer' })
    const result = requireRoles(makeReq(session), ['reviewer', 'staff'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.role).toBe('reviewer')
    }
  })

  it('requireInternalUser rejects external contributor and allows staff', async () => {
    const denied = requireInternalUser(makeReq(makeSession({ role: 'external_contributor' })))
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.response.status).toBe(403)
      expect(await responseErrorMessage(denied)).toContain('internal members only')
    }

    const allowed = requireInternalUser(makeReq(makeSession({ role: 'staff' })))
    expect(allowed.ok).toBe(true)
  })

  it('getCompanyContext uses active company membership when available', async () => {
    const company = makeCompany({ id: 'company-1' })
    const membership = makeMembership({ companyId: 'company-1', role: 'company_finance' })
    mocks.getCompanyById.mockResolvedValue(company)
    mocks.getMembershipForIdentity.mockResolvedValue(membership)

    const context = await getCompanyContext(makeSession({ activeCompanyId: 'company-1' }))
    expect(context?.company.id).toBe('company-1')
    expect(context?.membership?.role).toBe('company_finance')
    expect(context?.effectiveRole).toBe('company_finance')
  })

  it('getCompanyContext falls back to preferred active membership when companyId is missing', async () => {
    const preferredMembership = makeMembership({ companyId: 'company-2', role: 'company_reviewer' })
    const preferredCompany = makeCompany({ id: 'company-2', slug: 'fallback' })
    mocks.listActiveMembershipsForIdentity.mockResolvedValue([preferredMembership])
    mocks.getCompanyById.mockResolvedValue(preferredCompany)

    const context = await getCompanyContext(makeSession({ activeCompanyId: undefined }))
    expect(context?.company.id).toBe('company-2')
    expect(context?.membership?.role).toBe('company_reviewer')
  })

  it('getCompanyContext falls back for non-admin when company has no membership', async () => {
    const activeCompany = makeCompany({ id: 'company-1' })
    const fallbackMembership = makeMembership({ companyId: 'company-3', role: 'company_owner' })
    const fallbackCompany = makeCompany({ id: 'company-3', slug: 'fallback' })
    mocks.getCompanyById.mockImplementation(async (companyId: string) => {
      if (companyId === 'company-1') return activeCompany
      if (companyId === 'company-3') return fallbackCompany
      return null
    })
    mocks.getMembershipForIdentity.mockResolvedValue(null)
    mocks.listActiveMembershipsForIdentity.mockResolvedValue([fallbackMembership])

    const context = await getCompanyContext(makeSession({ role: 'staff', activeCompanyId: 'company-1' }))
    expect(context?.company.id).toBe('company-3')
    expect(context?.membership?.role).toBe('company_owner')
  })

  it('getCompanyContext allows platform admin without membership', async () => {
    const company = makeCompany({ id: 'company-admin' })
    mocks.getCompanyById.mockResolvedValue(company)
    mocks.getMembershipForIdentity.mockResolvedValue(null)

    const context = await getCompanyContext(makeSession({
      role: 'admin',
      activeCompanyId: 'company-admin',
      activeCompanyRole: 'company_admin'
    }))
    expect(context?.company.id).toBe('company-admin')
    expect(context?.membership).toBeNull()
    expect(context?.effectiveRole).toBe('company_admin')
  })

  it('requireCompanyRoles rejects non-admin when membership role is insufficient', async () => {
    const company = makeCompany({ id: 'company-1' })
    const membership = makeMembership({ role: 'company_viewer' })
    mocks.getCompanyById.mockResolvedValue(company)
    mocks.getMembershipForIdentity.mockResolvedValue(membership)

    const result = await requireCompanyRoles(makeReq(makeSession({ activeCompanyId: 'company-1' })), ['company_owner'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect(await responseErrorMessage(result)).toBe('Insufficient company permissions')
    }
  })

  it('requireCompanyCapability returns ok for membership capability', async () => {
    const company = makeCompany({ id: 'company-1' })
    const membership = makeMembership({ role: 'company_admin' })
    mocks.getCompanyById.mockResolvedValue(company)
    mocks.getMembershipForIdentity.mockResolvedValue(membership)

    const result = await requireCompanyCapability(
      makeReq(makeSession({ activeCompanyId: 'company-1' })),
      'task.review'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.companyId).toBe('company-1')
      expect(result.membership?.role).toBe('company_admin')
    }
  })

  it('requireAnyCompanyCapability returns 403 when none of requested capabilities are present', async () => {
    const company = makeCompany({ id: 'company-1' })
    const membership = makeMembership({ role: 'company_viewer' })
    mocks.getCompanyById.mockResolvedValue(company)
    mocks.getMembershipForIdentity.mockResolvedValue(membership)

    const result = await requireAnyCompanyCapability(
      makeReq(makeSession({ activeCompanyId: 'company-1' })),
      ['task.create', 'wallet.manage']
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect(await responseErrorMessage(result)).toContain('Missing permissions')
    }
  })
})
