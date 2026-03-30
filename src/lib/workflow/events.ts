import crypto from 'crypto'
import {
  completeWorkflowEvent,
  markWorkflowEventDeadLetter,
  markWorkflowEventReplayed,
  startWorkflowEvent
} from '@/lib/repositories/workflow-event-repository'
import { WorkflowEvent } from '@/lib/types'

export function hashWorkflowPayload(parts: Array<string | undefined>) {
  return crypto.createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24)
}

export function buildWebhookIdempotencyKey(input: {
  provider: 'github' | 'meegle'
  deliveryId?: string
  replayAttempt?: string | null
  fallbackParts: Array<string | undefined>
}) {
  const base = `${input.provider}:${input.deliveryId || hashWorkflowPayload(input.fallbackParts)}`
  return input.replayAttempt ? `${base}:replay:${input.replayAttempt}` : base
}

export async function executeWorkflowEvent<T extends Record<string, unknown>>(input: {
  eventType: string
  actorType: WorkflowEvent['actorType']
  actorId?: string
  taskId?: string
  companyId?: string
  idempotencyKey: string
  payload?: Record<string, unknown>
  handler: () => Promise<T>
}) {
  const started = await startWorkflowEvent({
    taskId: input.taskId,
    companyId: input.companyId,
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload
  })

  if (started.duplicate) {
    return {
      duplicate: true as const,
      event: started.event,
      result: started.event.result as T | undefined
    }
  }

  try {
    const result = await input.handler()
    const event = await completeWorkflowEvent(started.event.id, result)
    return {
      duplicate: false as const,
      event,
      result
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const event = await markWorkflowEventDeadLetter(started.event.id, detail)
    throw Object.assign(new Error(detail), { workflowEvent: event })
  }
}

export async function recordWorkflowReplay(id: string) {
  return markWorkflowEventReplayed(id)
}
