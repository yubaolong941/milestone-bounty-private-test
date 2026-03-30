import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/notifications/route'

const requireInternalUserMock = vi.fn()
const listNotificationsDbMock = vi.fn()
const updateNotificationAckDbMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listNotificationsDb: (...args: unknown[]) => listNotificationsDbMock(...args),
  updateNotificationAckDb: (...args: unknown[]) => updateNotificationAckDbMock(...args)
}))

describe('api/notifications route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({
      ok: true,
      session: { userId: 'u-1', activeCompanyId: 'company-1' }
    })
  })

  it('GET returns auth response when unauthenticated', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/notifications'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET forwards acknowledged=false filter', async () => {
    listNotificationsDbMock.mockResolvedValueOnce([{ id: 'n-1', acknowledged: false }])

    const response = await GET(new Request('http://localhost/api/notifications?acknowledged=false'))
    const body = await response.json()

    expect(listNotificationsDbMock).toHaveBeenCalledWith({
      companyId: 'company-1',
      acknowledged: false
    })
    expect(response.status).toBe(200)
    expect(body).toEqual([{ id: 'n-1', acknowledged: false }])
  })

  it('POST validates missing notification id', async () => {
    const response = await POST(
      new Request('http://localhost/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ack' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Missing notification id' })
  })

  it('POST returns 404 when target notification does not exist', async () => {
    updateNotificationAckDbMock.mockResolvedValueOnce(undefined)

    const response = await POST(
      new Request('http://localhost/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'n-missing', action: 'ack' })
      })
    )
    const body = await response.json()

    expect(updateNotificationAckDbMock).toHaveBeenCalledWith('n-missing', true)
    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Notification not found' })
  })

  it('POST updates ack status and returns updated item', async () => {
    updateNotificationAckDbMock.mockResolvedValueOnce({ id: 'n-1', acknowledged: false })

    const response = await POST(
      new Request('http://localhost/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'n-1', action: 'unack' })
      })
    )
    const body = await response.json()

    expect(updateNotificationAckDbMock).toHaveBeenCalledWith('n-1', false)
    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      item: { id: 'n-1', acknowledged: false }
    })
  })
})
