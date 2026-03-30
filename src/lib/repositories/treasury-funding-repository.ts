import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { loadTreasuryFundings, saveTreasuryFundings } from '@/lib/storage'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import { TreasuryFunding, TreasuryFundingRecord, TreasuryFundingStatus } from '@/lib/types'

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

function normalizeTreasuryFunding(item: TreasuryFunding): TreasuryFunding {
  const linkedTaskIds = Array.isArray(item.linkedTaskIds) ? item.linkedTaskIds.filter(Boolean) : []
  const linkedTaskTitles = Array.isArray(item.linkedTaskTitles) ? item.linkedTaskTitles.filter(Boolean) : []
  const amount = Number(item.amount || 0)
  const allocatedAmount = Math.max(0, Number(item.allocatedAmount || 0))
  const remainingAmount = Math.max(0, Number(item.remainingAmount ?? (amount - allocatedAmount)))
  let status: TreasuryFundingStatus = item.status
  if (remainingAmount <= 0 && allocatedAmount > 0 && status !== 'released' && status !== 'refunded') {
    status = 'exhausted'
  } else if (allocatedAmount > 0 && remainingAmount > 0 && status !== 'released' && status !== 'refunded') {
    status = 'partially_allocated'
  } else if (allocatedAmount > 0 && status !== 'released' && status !== 'refunded') {
    status = 'allocated'
  } else if (!status) {
    status = 'received'
  }
  return {
    ...item,
    amount,
    allocatedAmount,
    remainingAmount,
    linkedTaskIds,
    linkedTaskTitles,
    status
  }
}

function mapTreasuryFundingRow(row: RowDataPacket): TreasuryFunding {
  const item = parseJson<TreasuryFunding>(row.funding_json, {} as TreasuryFunding)
  return normalizeTreasuryFunding({
    ...item,
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : item.companyId,
    companyName: row.company_name ? String(row.company_name) : item.companyName,
    txHash: String(row.tx_hash || item.txHash),
    amount: Number(row.amount ?? item.amount ?? 0),
    allocatedAmount: Number(row.allocated_amount ?? item.allocatedAmount ?? 0),
    remainingAmount: Number(row.remaining_amount ?? item.remainingAmount ?? 0),
    tokenSymbol: String(row.token_symbol || item.tokenSymbol || 'USD1'),
    network: row.network ? String(row.network) : item.network,
    fromAddress: row.from_address ? String(row.from_address) : item.fromAddress,
    toAddress: row.to_address ? String(row.to_address) : item.toAddress,
    status: (row.status || item.status || 'received') as TreasuryFundingStatus,
    source: (row.source || item.source || 'wallet_payment') as TreasuryFunding['source'],
    linkedTaskIds: parseJson<string[]>(row.linked_task_ids_json, item.linkedTaskIds || []),
    linkedTaskTitles: parseJson<string[]>(row.linked_task_titles_json, item.linkedTaskTitles || []),
    verifiedAt: row.verified_at ? toIso(row.verified_at) : item.verifiedAt,
    recordedByUserId: row.recorded_by_user_id ? String(row.recorded_by_user_id) : item.recordedByUserId,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, item.metadata || {}),
    createdAt: toIso(row.created_at || item.createdAt),
    updatedAt: toIso(row.updated_at || item.updatedAt)
  })
}

export function listTreasuryFundingsSync(): TreasuryFunding[] {
  return loadTreasuryFundings().map(normalizeTreasuryFunding).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listTreasuryFundings(companyId?: string): Promise<TreasuryFunding[]> {
  if (shouldUseFileStorage()) {
    const items = listTreasuryFundingsSync()
    return companyId ? items.filter((item) => item.companyId === companyId) : items
  }
  const rows = companyId
    ? await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_treasury_fundings WHERE company_id = ? ORDER BY created_at DESC', [companyId])
    : await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_treasury_fundings ORDER BY created_at DESC')
  return rows.map(mapTreasuryFundingRow)
}

export async function getTreasuryFundingByTxHash(txHash: string): Promise<TreasuryFunding | null> {
  if (shouldUseFileStorage()) {
    return listTreasuryFundingsSync().find((item) => item.txHash === txHash) || null
  }
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_treasury_fundings WHERE tx_hash = ? LIMIT 1', [txHash])
  return rows[0] ? mapTreasuryFundingRow(rows[0]) : null
}

export async function upsertTreasuryFunding(item: TreasuryFunding): Promise<TreasuryFunding> {
  const normalized = normalizeTreasuryFunding(item)
  if (shouldUseFileStorage()) {
    const items = loadTreasuryFundings()
    const index = items.findIndex((existing) => existing.id === normalized.id || existing.txHash === normalized.txHash)
    if (index >= 0) items[index] = normalized
    else items.push(normalized)
    saveTreasuryFundings(items)
    return normalized
  }

  await queryMysql<ResultSetHeader>(
      `INSERT INTO wlfi_treasury_fundings
        (id, company_id, company_name, tx_hash, amount, allocated_amount, remaining_amount, token_symbol, network, from_address, to_address, status, source, linked_task_ids_json, linked_task_titles_json, verified_at, recorded_by_user_id, metadata_json, funding_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        company_id = VALUES(company_id),
        company_name = VALUES(company_name),
        amount = VALUES(amount),
        allocated_amount = VALUES(allocated_amount),
        remaining_amount = VALUES(remaining_amount),
        token_symbol = VALUES(token_symbol),
        network = VALUES(network),
        from_address = VALUES(from_address),
        to_address = VALUES(to_address),
        status = VALUES(status),
        source = VALUES(source),
        linked_task_ids_json = VALUES(linked_task_ids_json),
        linked_task_titles_json = VALUES(linked_task_titles_json),
        verified_at = VALUES(verified_at),
        recorded_by_user_id = VALUES(recorded_by_user_id),
        metadata_json = VALUES(metadata_json),
        funding_json = VALUES(funding_json),
        updated_at = VALUES(updated_at)`,
      [
        normalized.id,
        normalized.companyId || null,
        normalized.companyName || null,
        normalized.txHash,
        normalized.amount,
        normalized.allocatedAmount,
        normalized.remainingAmount,
        normalized.tokenSymbol,
        normalized.network || null,
        normalized.fromAddress || null,
        normalized.toAddress || null,
        normalized.status,
        normalized.source,
        JSON.stringify(normalized.linkedTaskIds),
        JSON.stringify(normalized.linkedTaskTitles),
        normalized.verifiedAt ? toMysqlDate(normalized.verifiedAt) : null,
        normalized.recordedByUserId || null,
        JSON.stringify(normalized.metadata || {}),
        JSON.stringify(normalized),
        toMysqlDate(normalized.createdAt),
        toMysqlDate(normalized.updatedAt)
      ]
    )
  return normalized
}

export async function recordTreasuryFunding(input: {
  id: string
  companyId?: string
  companyName?: string
  txHash: string
  amount: number
  tokenSymbol: string
  network?: string
  fromAddress?: string
  toAddress?: string
  source: TreasuryFunding['source']
  verifiedAt?: string
  recordedByUserId?: string
  metadata?: Record<string, unknown>
}): Promise<TreasuryFunding> {
  const existing = await getTreasuryFundingByTxHash(input.txHash)
  const now = new Date().toISOString()
  return upsertTreasuryFunding({
    id: existing?.id || input.id,
    companyId: input.companyId ?? existing?.companyId,
    companyName: input.companyName ?? existing?.companyName,
    txHash: input.txHash,
    amount: Number(input.amount || existing?.amount || 0),
    allocatedAmount: existing?.allocatedAmount || 0,
    remainingAmount: existing?.remainingAmount ?? Number(input.amount || existing?.amount || 0),
    tokenSymbol: input.tokenSymbol || existing?.tokenSymbol || 'USD1',
    network: input.network ?? existing?.network,
    fromAddress: input.fromAddress ?? existing?.fromAddress,
    toAddress: input.toAddress ?? existing?.toAddress,
    status: existing?.status || 'received',
    source: input.source || existing?.source || 'wallet_payment',
    linkedTaskIds: existing?.linkedTaskIds || [],
    linkedTaskTitles: existing?.linkedTaskTitles || [],
    verifiedAt: input.verifiedAt ?? existing?.verifiedAt,
    recordedByUserId: input.recordedByUserId ?? existing?.recordedByUserId,
    metadata: {
      ...(existing?.metadata || {}),
      ...(input.metadata || {})
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now
  })
}

export async function allocateTreasuryFundingToTask(input: {
  txHash: string
  taskId: string
  taskTitle: string
  amount: number
  metadata?: Record<string, unknown>
}): Promise<TreasuryFunding | null> {
  const existing = await getTreasuryFundingByTxHash(input.txHash)
  if (!existing) return null
  const now = new Date().toISOString()
  const linkedTaskIds = Array.from(new Set([...(existing.linkedTaskIds || []), input.taskId]))
  const linkedTaskTitles = Array.from(new Set([...(existing.linkedTaskTitles || []), input.taskTitle]))
  const alreadyAllocated = existing.linkedTaskIds.includes(input.taskId)
  const nextAllocatedAmount = alreadyAllocated
    ? existing.allocatedAmount
    : Math.min(existing.amount, Number((existing.allocatedAmount + input.amount).toFixed(6)))
  const nextRemainingAmount = Math.max(0, Number((existing.amount - nextAllocatedAmount).toFixed(6)))
  return upsertTreasuryFunding({
    ...existing,
    allocatedAmount: nextAllocatedAmount,
    remainingAmount: nextRemainingAmount,
    status: nextRemainingAmount <= 0 ? 'exhausted' : nextAllocatedAmount > 0 ? 'partially_allocated' : 'received',
    linkedTaskIds,
    linkedTaskTitles,
    metadata: {
      ...(existing.metadata || {}),
      ...(input.metadata || {})
    },
    updatedAt: now
  })
}

export function toTreasuryFundingRecord(item: TreasuryFunding): TreasuryFundingRecord {
  return {
    id: item.id,
    companyId: item.companyId,
    companyName: item.companyName,
    txHash: item.txHash,
    amount: item.amount,
    tokenSymbol: item.tokenSymbol,
    network: item.network,
    fromAddress: item.fromAddress,
    toAddress: item.toAddress,
    taskId: item.linkedTaskIds[0],
    taskTitle: item.linkedTaskTitles[0],
    status: item.allocatedAmount > 0 ? 'applied' : 'recorded',
    source: item.source,
    createdAt: item.createdAt,
    recordedByUserId: item.recordedByUserId
  }
}
