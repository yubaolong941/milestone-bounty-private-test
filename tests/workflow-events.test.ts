import { describe, expect, it, vi } from 'vitest'
import type { WorkflowEvent } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  startWorkflowEvent: vi.fn(),
  completeWorkflowEvent: vi.fn(),
  markWorkflowEventDeadLetter: vi.fn(),
  markWorkflowEventReplayed: vi.fn()
}))

vi.mock('@/lib/repositories/workflow-event-repository', () => ({
  startWorkflowEvent: (...args: unknown[]) => mocks.startWorkflowEvent(...args),
  completeWorkflowEvent: (...args: unknown[]) => mocks.completeWorkflowEvent(...args),
  markWorkflowEventDeadLetter: (...args: unknown[]) => mocks.markWorkflowEventDeadLetter(...args),
  markWorkflowEventReplayed: (...args: unknown[]) => mocks.markWorkflowEventReplayed(...args)
}))

import {
  buildWebhookIdempotencyKey,
  executeWorkflowEvent,
  hashWorkflowPayload,
  recordWorkflowReplay
} from '@/lib/workflow/events'

function makeEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    id: 'evt-1',
    eventType: 'github.webhook.issue',
    actorType: 'webhook',
    idempotencyKey: 'github:delivery-1',
    status: 'processing',
    payload: {},
    replayCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('hashWorkflowPayload', () => {
  it('returns a stable 24-char hash and ignores empty parts', () => {
    const a = hashWorkflowPayload(['github', undefined, 'issue-1', 'payload'])
    const b = hashWorkflowPayload(['github', 'issue-1', 'payload'])
    const c = hashWorkflowPayload(['github', 'issue-2', 'payload'])

    expect(a).toHaveLength(24)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('buildWebhookIdempotencyKey', () => {
  it('uses deliveryId when provided', () => {
    const key = buildWebhookIdempotencyKey({
      provider: 'github',
      deliveryId: 'd-100',
      fallbackParts: ['a', 'b']
    })
    expect(key).toBe('github:d-100')
  })

  it('falls back to hashed payload and appends replay suffix', () => {
    const key = buildWebhookIdempotencyKey({
      provider: 'meegle',
      fallbackParts: ['issue-1', 'title', 'body'],
      replayAttempt: '2'
    })
    expect(key.startsWith('meegle:')).toBe(true)
    expect(key).toContain(':replay:2')
  })
})

describe('executeWorkflowEvent', () => {
  it('returns duplicate=true and skips handler when idempotency already exists', async () => {
    const duplicateEvent = makeEvent({ status: 'processed', result: { ok: true } })
    mocks.startWorkflowEvent.mockResolvedValueOnce({
      duplicate: true,
      event: duplicateEvent
    })
    const handler = vi.fn()

    const result = await executeWorkflowEvent({
      eventType: 'meegle.webhook.issue',
      actorType: 'webhook',
      idempotencyKey: 'meegle:delivery-1',
      handler: handler as unknown as () => Promise<Record<string, unknown>>
    })

    expect(result.duplicate).toBe(true)
    expect(result.event).toEqual(duplicateEvent)
    expect(result.result).toEqual({ ok: true })
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.completeWorkflowEvent).not.toHaveBeenCalled()
  })

  it('processes handler and completes workflow event on success', async () => {
    const startedEvent = makeEvent({ id: 'evt-2', status: 'processing' })
    const completedEvent = makeEvent({ id: 'evt-2', status: 'processed', result: { status: 'done' } })
    mocks.startWorkflowEvent.mockResolvedValueOnce({
      duplicate: false,
      event: startedEvent
    })
    mocks.completeWorkflowEvent.mockResolvedValueOnce(completedEvent)

    const handler = vi.fn(async () => ({ status: 'done' }))
    const result = await executeWorkflowEvent({
      eventType: 'github.webhook.pr',
      actorType: 'webhook',
      idempotencyKey: 'github:delivery-2',
      payload: { action: 'closed' },
      handler
    })

    expect(result.duplicate).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(mocks.completeWorkflowEvent).toHaveBeenCalledWith('evt-2', { status: 'done' })
    expect(result.event).toEqual(completedEvent)
    expect(result.result).toEqual({ status: 'done' })
  })

  it('marks dead letter and rethrows with workflowEvent context on handler error', async () => {
    const startedEvent = makeEvent({ id: 'evt-3', status: 'processing' })
    const deadEvent = makeEvent({ id: 'evt-3', status: 'dead_letter', error: 'boom' })
    mocks.startWorkflowEvent.mockResolvedValueOnce({
      duplicate: false,
      event: startedEvent
    })
    mocks.markWorkflowEventDeadLetter.mockResolvedValueOnce(deadEvent)

    const handler = vi.fn(async () => {
      throw new Error('boom')
    })

    let thrown: unknown
    try {
      await executeWorkflowEvent({
        eventType: 'github.webhook.issue',
        actorType: 'webhook',
        idempotencyKey: 'github:delivery-3',
        handler
      })
    } catch (error) {
      thrown = error
    }

    expect(handler).toHaveBeenCalledTimes(1)
    expect(mocks.markWorkflowEventDeadLetter).toHaveBeenCalledWith('evt-3', 'boom')
    expect(thrown).toBeInstanceOf(Error)
    const error = thrown as Error & { workflowEvent?: WorkflowEvent | null }
    expect(error.message).toBe('boom')
    expect(error.workflowEvent).toEqual(deadEvent)
  })
})

describe('recordWorkflowReplay', () => {
  it('delegates to markWorkflowEventReplayed', async () => {
    const replayedEvent = makeEvent({ id: 'evt-9', replayCount: 1 })
    mocks.markWorkflowEventReplayed.mockResolvedValueOnce(replayedEvent)

    const result = await recordWorkflowReplay('evt-9')
    expect(mocks.markWorkflowEventReplayed).toHaveBeenCalledWith('evt-9')
    expect(result).toEqual(replayedEvent)
  })
})
