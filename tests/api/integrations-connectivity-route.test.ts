import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/integrations/connectivity/route'

const requireInternalUserMock = vi.fn()
const getCompanyContextMock = vi.fn()
const deriveCompanyIntegrationConnectivityMock = vi.fn()
const listIntegrationHealthStatesDbMock = vi.fn()
const listRepoConfigsDbMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args)
}))

vi.mock('@/lib/integration-connectivity', () => ({
  deriveCompanyIntegrationConnectivity: (...args: unknown[]) => deriveCompanyIntegrationConnectivityMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listIntegrationHealthStatesDb: (...args: unknown[]) => listIntegrationHealthStatesDbMock(...args),
  listRepoConfigsDb: (...args: unknown[]) => listRepoConfigsDbMock(...args)
}))

describe('api/integrations/connectivity route', () => {
  const session = {
    userId: 'u-1',
    role: 'staff',
    githubLogin: 'alice',
    activeCompanyId: 'company-1'
  }

  const company = { id: 'company-1', name: 'Demo Co' }

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    getCompanyContextMock.mockResolvedValue({ company })
    listRepoConfigsDbMock.mockResolvedValue([])
    listIntegrationHealthStatesDbMock.mockResolvedValue([])
    deriveCompanyIntegrationConnectivityMock.mockReturnValue({
      github: { ready: false },
      meegle: { ready: false },
      lark: { ready: false },
      overallReady: false
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET returns auth response when user is not internal', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/integrations/connectivity'))
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('GET returns 404 when company context cannot be resolved', async () => {
    getCompanyContextMock.mockResolvedValueOnce(null)
    const response = await GET(new Request('http://localhost/api/integrations/connectivity'))
    const body = await response.json()
    expect(response.status).toBe(404)
    expect(body.error).toContain('No valid company context')
  })

  it('GET returns connectivity payload on success', async () => {
    deriveCompanyIntegrationConnectivityMock.mockReturnValueOnce({
      github: { ready: true },
      meegle: { ready: false },
      lark: { ready: true },
      overallReady: true
    })

    const response = await GET(new Request('http://localhost/api/integrations/connectivity'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.companyId).toBe('company-1')
    expect(body.connectivity.overallReady).toBe(true)
  })

  it('POST checkAll returns 200 when any integration trigger reports success', async () => {
    deriveCompanyIntegrationConnectivityMock.mockReturnValue({
      github: { ready: false },
      meegle: { ready: false },
      lark: { ready: false },
      overallReady: false
    })
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: false }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ success: true }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ success: false }, { status: 200 }))

    const response = await POST(new Request('http://localhost/api/integrations/connectivity', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'bp_session=token' },
      body: JSON.stringify({ action: 'checkAll' })
    }))
    const body = await response.json()

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.results.meegle.success).toBe(true)
  })

  it('POST returns 400 when check results all fail and overallReady is false', async () => {
    deriveCompanyIntegrationConnectivityMock.mockReturnValue({
      github: { ready: false },
      meegle: { ready: false },
      lark: { ready: false },
      overallReady: false
    })
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: false }, { status: 500 }))

    const response = await POST(new Request('http://localhost/api/integrations/connectivity', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'bp_session=token' },
      body: JSON.stringify({ action: 'checkGitHub' })
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
  })
})
