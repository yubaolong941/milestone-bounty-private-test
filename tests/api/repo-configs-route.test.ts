import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/repo-configs/route'

const requireInternalUserMock = vi.fn()
const requireAnyCompanyCapabilityMock = vi.fn()
const getCompanyContextMock = vi.fn()
const resolveGitHubRequestHeadersMock = vi.fn()
const hasAnyCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const deleteRepoConfigDbMock = vi.fn()
const getRepoConfigByIdDbMock = vi.fn()
const listRepoConfigsDbMock = vi.fn()
const recordIntegrationRunDbMock = vi.fn()
const upsertRepoConfigDbMock = vi.fn()

vi.mock('uuid', () => ({
  v4: () => 'repo-config-uuid'
}))

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  requireAnyCompanyCapability: (...args: unknown[]) => requireAnyCompanyCapabilityMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args)
}))

vi.mock('@/lib/integrations', () => ({
  resolveGitHubRequestHeaders: (...args: unknown[]) => resolveGitHubRequestHeadersMock(...args)
}))

vi.mock('@/lib/permissions', () => ({
  hasAnyCompanyCapability: (...args: unknown[]) => hasAnyCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  deleteRepoConfigDb: (...args: unknown[]) => deleteRepoConfigDbMock(...args),
  getRepoConfigByIdDb: (...args: unknown[]) => getRepoConfigByIdDbMock(...args),
  listRepoConfigsDb: (...args: unknown[]) => listRepoConfigsDbMock(...args),
  recordIntegrationRunDb: (...args: unknown[]) => recordIntegrationRunDbMock(...args),
  upsertRepoConfigDb: (...args: unknown[]) => upsertRepoConfigDbMock(...args)
}))

describe('api/repo-configs route', () => {
  const session = {
    userId: 'u-1',
    githubLogin: 'alice',
    role: 'finance',
    activeCompanyId: 'company-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    requireAnyCompanyCapabilityMock.mockResolvedValue({ ok: true, session })
    getCompanyContextMock.mockResolvedValue({
      company: { id: 'company-1' },
      membership: { role: 'owner' }
    })
    isPlatformAdminMock.mockReturnValue(false)
    hasAnyCompanyCapabilityMock.mockReturnValue(true)
    listRepoConfigsDbMock.mockResolvedValue([])
    resolveGitHubRequestHeadersMock.mockResolvedValue({
      Authorization: 'Bearer mocked-token',
      Accept: 'application/vnd.github+json'
    })
  })

  it('GET returns auth response for unauthenticated request', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/repo-configs'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when membership lacks repo read capability', async () => {
    hasAnyCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await GET(new Request('http://localhost/api/repo-configs'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized')
  })

  it('POST create validates owner/repo', async () => {
    const response = await POST(
      new Request('http://localhost/api/repo-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', owner: '', repo: '' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(upsertRepoConfigDbMock).not.toHaveBeenCalled()
  })

  it('POST create persists config with default branch and generated id', async () => {
    const response = await POST(
      new Request('http://localhost/api/repo-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', owner: 'octocat', repo: 'hello-world' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(upsertRepoConfigDbMock).toHaveBeenCalledTimes(1)
    expect(upsertRepoConfigDbMock.mock.calls[0][0]).toMatchObject({
      id: 'repo-config-uuid',
      companyId: 'company-1',
      owner: 'octocat',
      repo: 'hello-world',
      defaultBranch: 'main',
      enabled: true
    })
    expect(body).toMatchObject({
      id: 'repo-config-uuid',
      owner: 'octocat',
      repo: 'hello-world',
      defaultBranch: 'main'
    })
  })

  it('POST update blocks non-admin edits to another company config', async () => {
    getRepoConfigByIdDbMock.mockResolvedValueOnce({
      id: 'cfg-1',
      companyId: 'company-2',
      owner: 'octo',
      repo: 'a',
      defaultBranch: 'main',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    const response = await POST(
      new Request('http://localhost/api/repo-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: 'cfg-1', owner: 'new-owner' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Not authorized to modify another company')
    expect(upsertRepoConfigDbMock).not.toHaveBeenCalled()
  })

  it('POST test returns 400 when auth headers cannot be resolved and records failure', async () => {
    getRepoConfigByIdDbMock.mockResolvedValueOnce({
      id: 'cfg-1',
      companyId: 'company-1',
      owner: 'octo',
      repo: 'hello',
      defaultBranch: 'main',
      tokenRef: 'missing-ref',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    resolveGitHubRequestHeadersMock.mockResolvedValueOnce(null)

    const response = await POST(
      new Request('http://localhost/api/repo-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'test', id: 'cfg-1' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('No GitHub Token configured')
    expect(recordIntegrationRunDbMock).toHaveBeenCalledWith(
      'github_issue_sync',
      'failure',
      expect.stringContaining('No GitHub Token configured')
    )
  })

  it('POST delete removes config and returns success', async () => {
    getRepoConfigByIdDbMock.mockResolvedValueOnce({
      id: 'cfg-1',
      companyId: 'company-1',
      owner: 'octo',
      repo: 'hello',
      defaultBranch: 'main',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    const response = await POST(
      new Request('http://localhost/api/repo-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: 'cfg-1' })
      })
    )
    const body = await response.json()

    expect(deleteRepoConfigDbMock).toHaveBeenCalledWith('cfg-1')
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
  })
})
