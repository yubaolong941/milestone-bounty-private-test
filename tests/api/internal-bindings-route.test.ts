import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/internal-bindings/route'

const requireAnyCompanyCapabilityMock = vi.fn()
const getCompanyContextMock = vi.fn()
const hasAnyCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const deleteInternalMemberBindingDbMock = vi.fn()
const getInternalMemberBindingByIdDbMock = vi.fn()
const getRepoConfigByIdDbMock = vi.fn()
const listInternalMemberBindingsDbMock = vi.fn()
const upsertInternalMemberBindingDbMock = vi.fn()

vi.mock('uuid', () => ({
  v4: () => 'binding-uuid'
}))

vi.mock('@/lib/auth', () => ({
  requireAnyCompanyCapability: (...args: unknown[]) => requireAnyCompanyCapabilityMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args)
}))

vi.mock('@/lib/permissions', () => ({
  hasAnyCompanyCapability: (...args: unknown[]) => hasAnyCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  deleteInternalMemberBindingDb: (...args: unknown[]) => deleteInternalMemberBindingDbMock(...args),
  getInternalMemberBindingByIdDb: (...args: unknown[]) => getInternalMemberBindingByIdDbMock(...args),
  getRepoConfigByIdDb: (...args: unknown[]) => getRepoConfigByIdDbMock(...args),
  listInternalMemberBindingsDb: (...args: unknown[]) => listInternalMemberBindingsDbMock(...args),
  upsertInternalMemberBindingDb: (...args: unknown[]) => upsertInternalMemberBindingDbMock(...args)
}))

describe('api/internal-bindings route', () => {
  const session = {
    userId: 'u-1',
    role: 'staff',
    githubLogin: 'alice',
    activeCompanyId: 'company-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    requireAnyCompanyCapabilityMock.mockResolvedValue({ ok: true, session })
    getCompanyContextMock.mockResolvedValue({
      company: { id: 'company-1' },
      membership: { role: 'company_admin' }
    })
    hasAnyCompanyCapabilityMock.mockReturnValue(true)
    isPlatformAdminMock.mockReturnValue(false)
    listInternalMemberBindingsDbMock.mockResolvedValue([])
    getRepoConfigByIdDbMock.mockResolvedValue({ id: 'repo-1' })
  })

  it('GET returns auth error from capability guard', async () => {
    requireAnyCompanyCapabilityMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 })
    })

    const response = await GET(new Request('http://localhost/api/internal-bindings'))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error).toBe('Forbidden')
  })

  it('GET returns 403 when company membership lacks visibility capability', async () => {
    hasAnyCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await GET(new Request('http://localhost/api/internal-bindings'))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized')
  })

  it('POST create returns 400 when required fields are missing', async () => {
    const response = await POST(new Request('http://localhost/api/internal-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', meegleAssignee: '', githubLogin: '' })
    }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toContain('Missing meegleAssignee/githubLogin')
  })

  it('POST create returns 400 when company context is missing for non-admin', async () => {
    getCompanyContextMock.mockResolvedValueOnce(null)

    const response = await POST(new Request('http://localhost/api/internal-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', meegleAssignee: 'm1', githubLogin: 'alice' })
    }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toContain('Please select a company context')
  })

  it('POST create returns 400 when repoConfigId does not exist', async () => {
    getRepoConfigByIdDbMock.mockResolvedValueOnce(null)

    const response = await POST(new Request('http://localhost/api/internal-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', meegleAssignee: 'm1', githubLogin: 'alice', repoConfigId: 'missing' })
    }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toContain('repoConfigId does not exist')
  })

  it('POST update returns 403 when trying to modify another company binding', async () => {
    getInternalMemberBindingByIdDbMock.mockResolvedValueOnce({
      id: 'binding-1',
      companyId: 'company-2'
    })

    const response = await POST(new Request('http://localhost/api/internal-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: 'binding-1', githubLogin: 'bob' })
    }))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized to modify another company')
  })

  it('POST delete returns 403 when trying to delete another company binding', async () => {
    getInternalMemberBindingByIdDbMock.mockResolvedValueOnce({
      id: 'binding-2',
      companyId: 'company-2'
    })

    const response = await POST(new Request('http://localhost/api/internal-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: 'binding-2' })
    }))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized to delete another company')
  })
})
