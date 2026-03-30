import { v4 as uuidv4 } from 'uuid'
import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { loadWorkflowEvents, saveWorkflowEvents } from '@/lib/storage'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import { WorkflowEvent, WorkflowEventActorType } from '@/lib/types'

function toMysqlDate(value?: string) {
  return (value || new Date().toISOString()).slice(0, 23).replace('T', ' ')
}

function toIso(value: unknown) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value)).toISOString()
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function mapWorkflowEventRow(row: RowDataPacket): WorkflowEvent {
  return {
    id: String(row.id),
    taskId: row.task_id ? String(row.task_id) : undefined,
    companyId: row.company_id ? String(row.company_id) : undefined,
    eventType: String(row.event_type),
    actorType: row.actor_type as WorkflowEvent['actorType'],
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    idempotencyKey: String(row.idempotency_key),
    status: row.status as WorkflowEvent['status'],
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    result: row.result ? parseJson<Record<string, unknown>>(row.result, {}) : undefined,
    error: row.error ? String(row.error) : undefined,
    replayCount: Number(row.replay_count || 0),
    lastReplayedAt: row.last_replayed_at ? toIso(row.last_replayed_at) : undefined,
    processedAt: row.processed_at ? toIso(row.processed_at) : undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

export async function listWorkflowEvents(input?: {
  status?: WorkflowEvent['status']
  taskId?: string
  eventType?: string
  companyId?: string
  limit?: number
  offset?: number
}) {
  if (shouldUseFileStorage()) {
    const items = loadWorkflowEvents()
      .filter((item) => !input?.status || item.status === input.status)
      .filter((item) => !input?.taskId || item.taskId === input.taskId)
      .filter((item) => !input?.eventType || item.eventType === input.eventType)
      .filter((item) => !input?.companyId || item.companyId === input.companyId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const limited = typeof input?.limit === 'number' ? items.slice(0, Math.max(1, input.limit)) : items
    return typeof input?.offset === 'number' && input.offset > 0 ? limited.slice(input.offset) : limited
  }

  const clauses: string[] = []
  const params: unknown[] = []
  if (input?.status) { clauses.push('status = ?'); params.push(input.status) }
  if (input?.taskId) { clauses.push('task_id = ?'); params.push(input.taskId) }
  if (input?.eventType) { clauses.push('event_type = ?'); params.push(input.eventType) }
  if (input?.companyId) { clauses.push('company_id = ?'); params.push(input.companyId) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const limit = typeof input?.limit === 'number' ? `LIMIT ${Math.max(1, input.limit)}` : ''
  const offset = typeof input?.offset === 'number' && input.offset > 0 ? `OFFSET ${Math.max(0, input.offset)}` : ''
  const rows = await queryMysql<RowDataPacket[]>(
    `SELECT * FROM wlfi_workflow_events ${where} ORDER BY updated_at DESC ${limit} ${offset}`.trim(),
    params
  )
  return rows.map(mapWorkflowEventRow)
}

export function listWorkflowEventsSync(input?: {
  status?: WorkflowEvent['status']
  taskId?: string
  eventType?: string
  companyId?: string
  limit?: number
  offset?: number
}) {
  const items = loadWorkflowEvents()
    .filter((item) => !input?.status || item.status === input.status)
    .filter((item) => !input?.taskId || item.taskId === input.taskId)
    .filter((item) => !input?.eventType || item.eventType === input.eventType)
    .filter((item) => !input?.companyId || item.companyId === input.companyId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const limited = typeof input?.limit === 'number' ? items.slice(0, Math.max(1, input.limit)) : items
  return typeof input?.offset === 'number' && input.offset > 0 ? limited.slice(input.offset) : limited
}

export async function getWorkflowEventById(id: string) {
  if (shouldUseFileStorage()) return loadWorkflowEvents().find((item) => item.id === id) || null
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_workflow_events WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapWorkflowEventRow(rows[0]) : null
}

export async function getWorkflowEventByIdempotencyKey(idempotencyKey: string) {
  if (shouldUseFileStorage()) return loadWorkflowEvents().find((item) => item.idempotencyKey === idempotencyKey) || null
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_workflow_events WHERE idempotency_key = ? LIMIT 1', [idempotencyKey])
  return rows[0] ? mapWorkflowEventRow(rows[0]) : null
}

export async function upsertWorkflowEvent(item: WorkflowEvent) {
  if (shouldUseFileStorage()) {
    const items = loadWorkflowEvents()
    const index = items.findIndex((existing) => existing.id === item.id)
    if (index >= 0) items[index] = item
    else items.push(item)
    saveWorkflowEvents(items)
  } else {
    await queryMysql<ResultSetHeader>(
      `INSERT INTO wlfi_workflow_events
        (id, task_id, company_id, event_type, actor_type, actor_id, idempotency_key, status, payload, result, error, replay_count, last_replayed_at, processed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        task_id = VALUES(task_id),
        company_id = VALUES(company_id),
        event_type = VALUES(event_type),
        actor_type = VALUES(actor_type),
        actor_id = VALUES(actor_id),
        idempotency_key = VALUES(idempotency_key),
        status = VALUES(status),
        payload = VALUES(payload),
        result = VALUES(result),
        error = VALUES(error),
        replay_count = VALUES(replay_count),
        last_replayed_at = VALUES(last_replayed_at),
        processed_at = VALUES(processed_at),
        updated_at = VALUES(updated_at)`,
      [
        item.id,
        item.taskId || null,
        item.companyId || null,
        item.eventType,
        item.actorType,
        item.actorId || null,
        item.idempotencyKey,
        item.status,
        JSON.stringify(item.payload || {}),
        item.result ? JSON.stringify(item.result) : null,
        item.error || null,
        item.replayCount,
        item.lastReplayedAt ? toMysqlDate(item.lastReplayedAt) : null,
        item.processedAt ? toMysqlDate(item.processedAt) : null,
        toMysqlDate(item.createdAt),
        toMysqlDate(item.updatedAt)
      ]
    )
  }
  return item
}

export async function startWorkflowEvent(input: {
  id?: string
  taskId?: string
  companyId?: string
  eventType: string
  actorType: WorkflowEventActorType
  actorId?: string
  idempotencyKey: string
  payload?: Record<string, unknown>
  createdAt?: string
}) {
  const existing = await getWorkflowEventByIdempotencyKey(input.idempotencyKey)
  if (existing) return { duplicate: true as const, event: existing }

  const now = input.createdAt || new Date().toISOString()
  const event: WorkflowEvent = {
    id: input.id || uuidv4(),
    taskId: input.taskId,
    companyId: input.companyId,
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    status: 'processing',
    payload: input.payload || {},
    replayCount: 0,
    createdAt: now,
    updatedAt: now
  }
  return { duplicate: false as const, event: await upsertWorkflowEvent(event) }
}

export async function completeWorkflowEvent(id: string, result?: Record<string, unknown>) {
  const existing = await getWorkflowEventById(id)
  if (!existing) return null
  const now = new Date().toISOString()
  return upsertWorkflowEvent({
    ...existing,
    status: 'processed',
    result,
    error: undefined,
    processedAt: now,
    updatedAt: now
  })
}

export async function markWorkflowEventDeadLetter(id: string, error: string, result?: Record<string, unknown>) {
  const existing = await getWorkflowEventById(id)
  if (!existing) return null
  const now = new Date().toISOString()
  return upsertWorkflowEvent({
    ...existing,
    status: 'dead_letter',
    error,
    result,
    updatedAt: now
  })
}

export async function markWorkflowEventReplayed(id: string) {
  const existing = await getWorkflowEventById(id)
  if (!existing) return null
  return upsertWorkflowEvent({
    ...existing,
    replayCount: existing.replayCount + 1,
    lastReplayedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
}
