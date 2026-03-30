import { v4 as uuidv4 } from 'uuid'
import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { loadPayoutAttempts, savePayoutAttempts } from '@/lib/storage'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import { PayoutAttempt, PayoutAttemptContext } from '@/lib/types'

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

function mapPayoutAttemptRow(row: RowDataPacket): PayoutAttempt {
  const item = parseJson<PayoutAttempt>(row.attempt_json, {} as PayoutAttempt)
  return {
    ...item,
    id: String(row.id),
    settlementCaseId: String(row.settlement_case_id || item.settlementCaseId),
    taskId: String(row.task_id || item.taskId),
    companyId: row.company_id ? String(row.company_id) : item.companyId,
    payoutContext: (row.payout_context || item.payoutContext) as PayoutAttemptContext,
    idempotencyKey: String(row.idempotency_key || item.idempotencyKey),
    status: row.status as PayoutAttempt['status'],
    amount: Number(row.amount ?? item.amount ?? 0),
    token: String(row.token || item.token || 'USD1'),
    recipientWalletAddress: row.recipient_wallet_address ? String(row.recipient_wallet_address) : item.recipientWalletAddress,
    provider: row.provider ? row.provider as PayoutAttempt['provider'] : item.provider,
    txHash: row.tx_hash ? String(row.tx_hash) : item.txHash,
    error: row.error ? String(row.error) : item.error,
    activeExecution: row.active_execution === 1,
    requestPayload: parseJson<Record<string, unknown>>(row.request_payload, item.requestPayload || {}),
    resultPayload: row.result_payload ? parseJson<Record<string, unknown>>(row.result_payload, item.resultPayload || {}) : item.resultPayload,
    startedAt: toIso(row.started_at || item.startedAt),
    finishedAt: row.finished_at ? toIso(row.finished_at) : item.finishedAt,
    createdAt: toIso(row.created_at || item.createdAt),
    updatedAt: toIso(row.updated_at || item.updatedAt)
  }
}

async function upsertPayoutAttempt(item: PayoutAttempt) {
  if (shouldUseFileStorage()) {
    const items = loadPayoutAttempts()
    const index = items.findIndex((existing) => existing.id === item.id)
    if (index >= 0) items[index] = item
    else items.push(item)
    savePayoutAttempts(items)
    return item
  }

  await queryMysql<ResultSetHeader>(
      `INSERT INTO wlfi_payout_attempts
        (id, settlement_case_id, task_id, company_id, payout_context, idempotency_key, status, active_execution, amount, token, recipient_wallet_address, provider, tx_hash, error, request_payload, result_payload, attempt_json, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        payout_context = VALUES(payout_context),
        status = VALUES(status),
        active_execution = VALUES(active_execution),
        amount = VALUES(amount),
        token = VALUES(token),
        recipient_wallet_address = VALUES(recipient_wallet_address),
        provider = VALUES(provider),
        tx_hash = VALUES(tx_hash),
        error = VALUES(error),
        request_payload = VALUES(request_payload),
        result_payload = VALUES(result_payload),
        attempt_json = VALUES(attempt_json),
        started_at = VALUES(started_at),
        finished_at = VALUES(finished_at),
        updated_at = VALUES(updated_at)`,
      [
        item.id,
        item.settlementCaseId,
        item.taskId,
        item.companyId || null,
        item.payoutContext,
        item.idempotencyKey,
        item.status,
        item.activeExecution ? 1 : null,
        item.amount,
        item.token,
        item.recipientWalletAddress || null,
        item.provider || null,
        item.txHash || null,
        item.error || null,
        JSON.stringify(item.requestPayload || {}),
        item.resultPayload ? JSON.stringify(item.resultPayload) : null,
        JSON.stringify(item),
        toMysqlDate(item.startedAt),
        item.finishedAt ? toMysqlDate(item.finishedAt) : null,
        toMysqlDate(item.createdAt),
        toMysqlDate(item.updatedAt)
      ]
    )
  return item
}

export async function getPayoutAttemptByIdempotencyKey(idempotencyKey: string) {
  if (shouldUseFileStorage()) {
    return loadPayoutAttempts().find((item) => item.idempotencyKey === idempotencyKey) || null
  }
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_payout_attempts WHERE idempotency_key = ? LIMIT 1', [idempotencyKey])
  return rows[0] ? mapPayoutAttemptRow(rows[0]) : null
}

export async function getActivePayoutAttemptBySettlementCaseId(settlementCaseId: string) {
  if (shouldUseFileStorage()) {
    return loadPayoutAttempts().find((item) => item.settlementCaseId === settlementCaseId && item.activeExecution) || null
  }
  const rows = await queryMysql<RowDataPacket[]>(
    'SELECT * FROM wlfi_payout_attempts WHERE settlement_case_id = ? AND active_execution = 1 LIMIT 1',
    [settlementCaseId]
  )
  return rows[0] ? mapPayoutAttemptRow(rows[0]) : null
}

export async function startPayoutAttempt(input: {
  settlementCaseId: string
  taskId: string
  companyId?: string
  payoutContext: PayoutAttemptContext
  idempotencyKey: string
  amount: number
  token: string
  recipientWalletAddress?: string
  requestPayload?: Record<string, unknown>
}) {
  const existingByIdempotency = await getPayoutAttemptByIdempotencyKey(input.idempotencyKey)
  if (existingByIdempotency) return { kind: 'duplicate' as const, attempt: existingByIdempotency }

  const active = await getActivePayoutAttemptBySettlementCaseId(input.settlementCaseId)
  if (active) return { kind: 'active_conflict' as const, attempt: active }

  const now = new Date().toISOString()
  const next: PayoutAttempt = {
    id: uuidv4(),
    settlementCaseId: input.settlementCaseId,
    taskId: input.taskId,
    companyId: input.companyId,
    payoutContext: input.payoutContext,
    idempotencyKey: input.idempotencyKey,
    status: 'processing',
    amount: input.amount,
    token: input.token,
    recipientWalletAddress: input.recipientWalletAddress,
    activeExecution: true,
    requestPayload: input.requestPayload || {},
    startedAt: now,
    createdAt: now,
    updatedAt: now
  }

  try {
    return { kind: 'started' as const, attempt: await upsertPayoutAttempt(next) }
  } catch (error) {
    const duplicate = await getPayoutAttemptByIdempotencyKey(input.idempotencyKey)
    if (duplicate) return { kind: 'duplicate' as const, attempt: duplicate }
    const conflict = await getActivePayoutAttemptBySettlementCaseId(input.settlementCaseId)
    if (conflict) return { kind: 'active_conflict' as const, attempt: conflict }
    throw error
  }
}

export async function completePayoutAttempt(id: string, result: {
  provider?: PayoutAttempt['provider']
  txHash?: string
  resultPayload?: Record<string, unknown>
}) {
  const existing = shouldUseFileStorage()
    ? loadPayoutAttempts().find((item) => item.id === id) || null
    : await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_payout_attempts WHERE id = ? LIMIT 1', [id]).then((rows) => rows[0] ? mapPayoutAttemptRow(rows[0]) : null)
  if (!existing) return null

  const now = new Date().toISOString()
  return upsertPayoutAttempt({
    ...existing,
    status: 'succeeded',
    provider: result.provider ?? existing.provider,
    txHash: result.txHash ?? existing.txHash,
    resultPayload: {
      ...(existing.resultPayload || {}),
      ...(result.resultPayload || {})
    },
    activeExecution: false,
    finishedAt: now,
    updatedAt: now
  })
}

export async function failPayoutAttempt(id: string, error: string, resultPayload?: Record<string, unknown>) {
  const existing = shouldUseFileStorage()
    ? loadPayoutAttempts().find((item) => item.id === id) || null
    : await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_payout_attempts WHERE id = ? LIMIT 1', [id]).then((rows) => rows[0] ? mapPayoutAttemptRow(rows[0]) : null)
  if (!existing) return null

  const now = new Date().toISOString()
  return upsertPayoutAttempt({
    ...existing,
    status: 'failed',
    error,
    resultPayload: {
      ...(existing.resultPayload || {}),
      ...(resultPayload || {})
    },
    activeExecution: false,
    finishedAt: now,
    updatedAt: now
  })
}
