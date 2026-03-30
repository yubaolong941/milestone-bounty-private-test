import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowEvent } from '@/lib/types'

const state = vi.hoisted(() => ({
  events: [] as WorkflowEvent[]
}))

const dbMocks = vi.hoisted(() => ({
  hasMysqlConfig: vi.fn(() => false),
  queryMysql: vi.fn()
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'workflow-event-uuid-1')
}))

vi.mock('@/lib/db', () => ({
  hasMysqlConfig: dbMocks.hasMysqlConfig,
  queryMysql: dbMocks.queryMysql
}))

vi.mock('@/lib/storage', () => ({
  loadWorkflowEvents: vi.fn(() => state.events),
  saveWorkflowEvents: vi.fn((items: WorkflowEvent[]) => {
    state.events = items
  })
}))

import {
  completeWorkflowEvent,
  listWorkflowEvents,
  markWorkflowEventDeadLetter,
  markWorkflowEventReplayed,
  startWorkflowEvent
} from '@/lib/repositories/workflow-event-repository'

function buildEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    id: 'event-1',
    taskId: 'task-1',
    companyId: 'company-1',
    eventType: 'task.transition.accepted',
    actorType: 'system',
    actorId: 'system',
    idempotencyKey: 'idem-1',
    status: 'processing',
    payload: { step: 1 },
    replayCount: 0,
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides
  }
}

describe('workflow-event-repository', () => {
  beforeEach(() => {
    state.events = []
    vi.clearAllMocks()
    dbMocks.hasMysqlConfig.mockReturnValue(false)
  })

  it('lists file-backed events with filters, limit and offset', async () => {
    state.events = [
      buildEvent({ id: 'event-1', taskId: 'task-1', status: 'processed', updatedAt: '2026-03-29T03:00:00.000Z' }),
      buildEvent({ id: 'event-2', taskId: 'task-2', status: 'processing', updatedAt: '2026-03-29T02:00:00.000Z' }),
      buildEvent({ id: 'event-3', taskId: 'task-1', status: 'processed', updatedAt: '2026-03-29T01:00:00.000Z' })
    ]

    const items = await listWorkflowEvents({ taskId: 'task-1', status: 'processed', limit: 2, offset: 1 })

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('event-3')
  })

  it('dedupes startWorkflowEvent by idempotency key', async () => {
    state.events = [buildEvent()]

    const result = await startWorkflowEvent({
      taskId: 'task-1',
      companyId: 'company-1',
      eventType: 'task.transition.accepted',
      actorType: 'system',
      actorId: 'system',
      idempotencyKey: 'idem-1',
      payload: { step: 2 }
    })

    expect(result).toEqual({
      duplicate: true,
      event: state.events[0]
    })
  })

  it('creates, completes, dead-letters, and replays events', async () => {
    const started = await startWorkflowEvent({
      taskId: 'task-1',
      companyId: 'company-1',
      eventType: 'task.transition.accepted',
      actorType: 'system',
      actorId: 'system',
      idempotencyKey: 'idem-new',
      payload: { created: true }
    })

    expect(started).toMatchObject({
      duplicate: false,
      event: {
        id: 'workflow-event-uuid-1',
        status: 'processing',
        payload: { created: true }
      }
    })

    const completed = await completeWorkflowEvent('workflow-event-uuid-1', { ok: true })
    expect(completed).toMatchObject({
      status: 'processed',
      result: { ok: true },
      error: undefined
    })

    const dead = await markWorkflowEventDeadLetter('workflow-event-uuid-1', 'boom', { failed: true })
    expect(dead).toMatchObject({
      status: 'dead_letter',
      error: 'boom',
      result: { failed: true }
    })

    const replayed = await markWorkflowEventReplayed('workflow-event-uuid-1')
    expect(replayed).toMatchObject({
      replayCount: 1
    })
    expect(replayed?.lastReplayedAt).toBeTruthy()
  })
})
