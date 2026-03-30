import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireInternalUserMock = vi.fn()
const verifySimpleWebhookSecretMock = vi.fn()
const listPaymentRetryJobsDbMock = vi.fn()
const processDuePaymentRetryJobsMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args)
}))

vi.mock('@/lib/integrations', () => ({
  verifySimpleWebhookSecret: (...args: unknown[]) => verifySimpleWebhookSecretMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listPaymentRetryJobsDb: (...args: unknown[]) => listPaymentRetryJobsDbMock(...args)
}))

vi.mock('@/lib/payment-retry-queue', () => ({
  processDuePaymentRetryJobs: (...args: unknown[]) => processDuePaymentRetryJobsMock(...args)
}))

import { GET, POST } from '@/app/api/internal/payout-retries/route'

describe('api/internal/payout-retries route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PAYOUT_RETRY_CRON_SECRET = 'secret'
    requireInternalUserMock.mockReturnValue({
      ok: true,
      session: { userId: 'u-1' }
    })
    verifySimpleWebhookSecretMock.mockReturnValue(false)
    listPaymentRetryJobsDbMock.mockResolvedValue([
      { id: 'job-1', status: 'pending', scheduledAt: '2026-03-29T01:00:00.000Z' },
      { id: 'job-2', status: 'processing', scheduledAt: '2026-03-29T02:00:00.000Z' }
    ])
    processDuePaymentRetryJobsMock.mockResolvedValue({ success: true, processed: 5 })
  })

  it('GET rejects requests when neither session nor scheduler secret is valid', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/internal/payout-retries'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET allows scheduler access and returns sorted jobs with queue depth', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })
    verifySimpleWebhookSecretMock.mockReturnValueOnce(true)

    const response = await GET(new Request('http://localhost/api/internal/payout-retries', {
      headers: { 'x-payout-retry-secret': 'secret' }
    }))
    const body = await response.json()

    expect(body).toEqual({
      success: true,
      queueDepth: 1,
      jobs: [
        { id: 'job-1', status: 'pending', scheduledAt: '2026-03-29T01:00:00.000Z' },
        { id: 'job-2', status: 'processing', scheduledAt: '2026-03-29T02:00:00.000Z' }
      ]
    })
  })

  it('POST clamps limit and forwards it to payment retry processing', async () => {
    const response = await POST(new Request('http://localhost/api/internal/payout-retries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 999 })
    }))
    const body = await response.json()

    expect(processDuePaymentRetryJobsMock).toHaveBeenCalledWith({ limit: 50 })
    expect(body).toEqual({ success: true, processed: 5 })
  })
})
