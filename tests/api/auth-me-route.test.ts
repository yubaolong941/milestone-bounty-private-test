import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/auth/me/route'

const getSessionFromRequestMock = vi.fn()
const getCompanyContextMock = vi.fn()
const withSessionMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSessionFromRequest: (...args: unknown[]) => getSessionFromRequestMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args),
  withSession: (...args: unknown[]) => withSessionMock(...args)
}))

describe('api/auth/me route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    withSessionMock.mockImplementation((_session: unknown, response: Response) => response)
  })

  it('returns 401 when session is missing', async () => {
    getSessionFromRequestMock.mockReturnValueOnce(null)

    const response = await GET(new Request('http://localhost/api/auth/me'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ loggedIn: false })
  })

  it('returns resolved session and company context on success', async () => {
    getSessionFromRequestMock.mockReturnValueOnce({
      userId: 'u-1',
      role: 'staff',
      githubLogin: 'alice',
      activeCompanyId: undefined,
      activeCompanyRole: undefined
    })
    getCompanyContextMock.mockResolvedValueOnce({
      company: { id: 'company-1', name: 'Demo Co' },
      membership: { role: 'company_admin' }
    })

    const response = await GET(new Request('http://localhost/api/auth/me'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.loggedIn).toBe(true)
    expect(body.session.activeCompanyId).toBe('company-1')
    expect(body.session.activeCompanyRole).toBe('company_admin')
    expect(withSessionMock).toHaveBeenCalledTimes(1)
  })

  it('propagates upstream exception from company context resolution', async () => {
    getSessionFromRequestMock.mockReturnValueOnce({
      userId: 'u-1',
      role: 'staff'
    })
    getCompanyContextMock.mockRejectedValueOnce(new Error('context failed'))

    await expect(GET(new Request('http://localhost/api/auth/me'))).rejects.toThrow('context failed')
  })
})
