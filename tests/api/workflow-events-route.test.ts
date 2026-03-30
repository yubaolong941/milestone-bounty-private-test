import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/workflow-events/route'

const requireInternalUserMock = vi.fn()
const listWorkflowEventsMock = vi.fn()
const getWorkflowEventByIdMock = vi.fn()
const recordWorkflowReplayMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args)
}))

vi.mock('@/lib/repositories/workflow-event-repository', () => ({
  listWorkflowEvents: (...args: unknown[]) => listWorkflowEventsMock(...args),
  getWorkflowEventById: (...args: unknown[]) => getWorkflowEventByIdMock(...args)
}))

vi.mock('@/lib/workflow/events', () => ({
  recordWorkflowReplay: (...args: unknown[]) => recordWorkflowReplayMock(...args)
}))

describe('api/workflow-events route', () => {
  const session = {
    userId: 'u-1',
    role: 'staff',
    githubLogin: 'alice'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    listWorkflowEventsMock.mockResolvedValue([])
    recordWorkflowReplayMock.mockResolvedValue({ id: 'evt-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET returns auth response when user is not internal', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/workflow-events'))
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('GET forwards filters and pagination to repository query', async () => {
    listWorkflowEventsMock.mockResolvedValueOnce([{ id: 'evt-1' }])
    const response = await GET(new Request('http://localhost/api/workflow-events?status=processed&taskId=t-1&eventType=e-1&page=2&pageSize=10'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listWorkflowEventsMock).toHaveBeenCalledWith({
      status: 'processed',
      taskId: 't-1',
      eventType: 'e-1',
      limit: 10,
      offset: 10
    })
    expect(body.success).toBe(true)
    expect(body.pagination).toEqual({ page: 2, pageSize: 10 })
  })

  it('POST returns 400 for unsupported action', async () => {
    const response = await POST(new Request('http://localhost/api/workflow-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'noop' })
    }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toBe('Unsupported action')
  })

  it('POST replay returns 404 when workflow event is missing', async () => {
    getWorkflowEventByIdMock.mockResolvedValueOnce(null)

    const response = await POST(new Request('http://localhost/api/workflow-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'replay', id: 'missing' })
    }))
    const body = await response.json()
    expect(response.status).toBe(404)
    expect(body.error).toContain('not found')
  })

  it('POST replay returns 400 when event does not support replay payload', async () => {
    getWorkflowEventByIdMock.mockResolvedValueOnce({
      id: 'evt-1',
      replayCount: 0,
      payload: {}
    })

    const response = await POST(new Request('http://localhost/api/workflow-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'replay', id: 'evt-1' })
    }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toContain('does not support replay')
  })

  it('POST replay triggers downstream endpoint and returns 200 on success', async () => {
    getWorkflowEventByIdMock.mockResolvedValueOnce({
      id: 'evt-1',
      replayCount: 1,
      payload: {
        replayRequest: {
          path: '/api/integrations/meegle/webhook',
          method: 'POST',
          body: '{"foo":"bar"}',
          headers: { 'x-meegle-secret': 's' }
        }
      }
    })
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      Response.json({ success: true, detail: 'ok' }, { status: 200 })
    )

    const response = await POST(new Request('http://localhost/api/workflow-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'bp_session=token' },
      body: JSON.stringify({ action: 'replay', id: 'evt-1' })
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(recordWorkflowReplayMock).toHaveBeenCalledWith('evt-1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(body.success).toBe(true)
    expect(body.replayAttempt).toBe('2')
  })
})
