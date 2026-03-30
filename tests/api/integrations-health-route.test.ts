import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/integrations/health/route'

const requireInternalUserMock = vi.fn()
const inferHealthCheckMock = vi.fn()
const listIntegrationHealthStatesDbMock = vi.fn()
const inspectPlatformPayoutWalletMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args)
}))

vi.mock('@/lib/ai', () => ({
  inferHealthCheck: (...args: unknown[]) => inferHealthCheckMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listIntegrationHealthStatesDb: (...args: unknown[]) => listIntegrationHealthStatesDbMock(...args)
}))

vi.mock('@/lib/settlement', () => ({
  inspectPlatformPayoutWallet: (...args: unknown[]) => inspectPlatformPayoutWalletMock(...args)
}))

describe('api/integrations/health route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'))
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({
      ok: true,
      session: { userId: 'u-1', githubLogin: 'alice', role: 'admin' }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('GET returns auth response when request is unauthenticated', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/integrations/health'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET summarizes integration health states', async () => {
    inferHealthCheckMock.mockResolvedValueOnce({ success: true })
    inspectPlatformPayoutWalletMock.mockResolvedValueOnce({ ready: true })
    listIntegrationHealthStatesDbMock.mockResolvedValueOnce([
      { id: '1', integration: 'github', updatedAt: '2026-03-29T11:50:00.000Z', lastStatus: 'success' },
      { id: '2', integration: 'meegle', updatedAt: '2026-03-29T11:00:00.000Z', lastStatus: 'success' },
      { id: '3', integration: 'lark', updatedAt: '2026-03-29T11:59:00.000Z', lastStatus: 'failure' },
      { id: '4', integration: 'ai', updatedAt: undefined, lastStatus: 'success' }
    ])

    const response = await GET(new Request('http://localhost/api/integrations/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.ai).toEqual({ success: true })
    expect(body.treasuryPayout).toEqual({ ready: true })
    expect(body.integrations.map((item: { integration: string; health: string }) => [item.integration, item.health])).toEqual([
      ['github', 'ok'],
      ['meegle', 'stale'],
      ['lark', 'degraded'],
      ['ai', 'unknown']
    ])
  })

  it('POST retryMeegle proxies request and keeps cookie header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ success: true, source: 'meegle' }, { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/integrations/health', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'sid=abc'
        },
        body: JSON.stringify({ action: 'retryMeegle' })
      })
    )
    const body = await response.json()

    expect(fetchMock).toHaveBeenCalledWith('http://localhost/api/integrations/meegle/webhook', {
      method: 'POST',
      headers: { cookie: 'sid=abc' }
    })
    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      retried: 'meegle_sync',
      result: { success: true, source: 'meegle' }
    })
  })

  it('POST retryGitHub returns 400 when downstream retry fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ success: false, message: 'boom' }, { status: 500 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/integrations/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'retryGitHub' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      success: false,
      retried: 'github_issue_sync',
      results: {
        issues: {
          success: false,
          message: 'boom'
        }
      }
    })
  })

  it('POST retryAll reports partial failure when any retry fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/api/integrations/meegle/webhook')) {
        return Response.json({ success: true, from: 'meegle' }, { status: 200 })
      }
      return Response.json({ success: false, from: 'github' }, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/integrations/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      success: false,
      retried: 'all',
      results: {
        meegle: {
          success: true,
          from: 'meegle'
        },
        github: {
          issues: {
            success: false,
            from: 'github'
          }
        }
      }
    })
  })
})
