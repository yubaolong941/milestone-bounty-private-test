import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { loadBountyFundingLocks, saveBountyFundingLocks } from '@/lib/storage'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import { BountyFundingLock } from '@/lib/types'

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

function mapBountyFundingLockRow(row: RowDataPacket): BountyFundingLock {
  const item = parseJson<BountyFundingLock>(row.lock_json, {} as BountyFundingLock)
  return {
    ...item,
    id: String(row.id),
    taskId: String(row.task_id || item.taskId),
    issueNumber: row.issue_number !== null && row.issue_number !== undefined ? Number(row.issue_number) : item.issueNumber,
    issueUrl: row.issue_url ? String(row.issue_url) : item.issueUrl,
    rewardAmount: Number(row.reward_amount ?? item.rewardAmount ?? 0),
    rewardToken: String(row.reward_token || item.rewardToken || 'USD1'),
    payerCompanyWalletId: row.payer_company_wallet_id ? String(row.payer_company_wallet_id) : item.payerCompanyWalletId,
    payerCompanyName: row.payer_company_name ? String(row.payer_company_name) : item.payerCompanyName,
    payerWalletAddress: row.payer_wallet_address ? String(row.payer_wallet_address) : item.payerWalletAddress,
    fundingTxHash: row.funding_tx_hash ? String(row.funding_tx_hash) : item.fundingTxHash,
    lockContractAddress: row.lock_contract_address ? String(row.lock_contract_address) : item.lockContractAddress,
    lockTransactionHash: row.lock_transaction_hash ? String(row.lock_transaction_hash) : item.lockTransactionHash,
    releaseTransactionHash: row.release_transaction_hash ? String(row.release_transaction_hash) : item.releaseTransactionHash,
    onchainLockId: row.onchain_lock_id ? String(row.onchain_lock_id) : item.onchainLockId,
    onchainVerifiedAt: row.onchain_verified_at ? toIso(row.onchain_verified_at) : item.onchainVerifiedAt,
    status: (row.status || item.status) as BountyFundingLock['status'],
    createdByUserId: String(row.created_by_user_id || item.createdByUserId),
    createdAt: toIso(row.created_at || item.createdAt),
    updatedAt: toIso(row.updated_at || item.updatedAt)
  }
}

export async function listBountyFundingLocks(): Promise<BountyFundingLock[]> {
  if (shouldUseFileStorage()) return loadBountyFundingLocks()
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_bounty_funding_locks ORDER BY updated_at DESC')
  return rows.map(mapBountyFundingLockRow)
}

export async function getActiveBountyFundingLockForTask(taskId: string, fundingLockId?: string): Promise<BountyFundingLock | null> {
  if (shouldUseFileStorage()) {
    const locks = loadBountyFundingLocks()
    if (fundingLockId) {
      return locks.find((item) => item.id === fundingLockId && item.status === 'locked') || null
    }
    return locks.find((item) => item.taskId === taskId && item.status === 'locked') || null
  }
  const rows = fundingLockId
    ? await queryMysql<RowDataPacket[]>(
        'SELECT * FROM wlfi_bounty_funding_locks WHERE id = ? AND status = ? LIMIT 1',
        [fundingLockId, 'locked']
      )
    : await queryMysql<RowDataPacket[]>(
        'SELECT * FROM wlfi_bounty_funding_locks WHERE task_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 1',
        [taskId, 'locked']
      )
  return rows[0] ? mapBountyFundingLockRow(rows[0]) : null
}

export async function upsertBountyFundingLock(item: BountyFundingLock): Promise<BountyFundingLock> {
  if (shouldUseFileStorage()) {
    const items = loadBountyFundingLocks()
    const index = items.findIndex((existing) => existing.id === item.id)
    if (index >= 0) items[index] = item
    else items.push(item)
    saveBountyFundingLocks(items)
    return item
  }

  await queryMysql<ResultSetHeader>(
    `INSERT INTO wlfi_bounty_funding_locks
      (id, task_id, issue_number, issue_url, reward_amount, reward_token, payer_company_wallet_id, payer_company_name, payer_wallet_address, funding_tx_hash, lock_contract_address, lock_transaction_hash, release_transaction_hash, onchain_lock_id, onchain_verified_at, status, created_by_user_id, lock_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      task_id = VALUES(task_id),
      issue_number = VALUES(issue_number),
      issue_url = VALUES(issue_url),
      reward_amount = VALUES(reward_amount),
      reward_token = VALUES(reward_token),
      payer_company_wallet_id = VALUES(payer_company_wallet_id),
      payer_company_name = VALUES(payer_company_name),
      payer_wallet_address = VALUES(payer_wallet_address),
      funding_tx_hash = VALUES(funding_tx_hash),
      lock_contract_address = VALUES(lock_contract_address),
      lock_transaction_hash = VALUES(lock_transaction_hash),
      release_transaction_hash = VALUES(release_transaction_hash),
      onchain_lock_id = VALUES(onchain_lock_id),
      onchain_verified_at = VALUES(onchain_verified_at),
      status = VALUES(status),
      created_by_user_id = VALUES(created_by_user_id),
      lock_json = VALUES(lock_json),
      updated_at = VALUES(updated_at)`,
    [
      item.id,
      item.taskId,
      item.issueNumber ?? null,
      item.issueUrl || null,
      item.rewardAmount,
      item.rewardToken,
      item.payerCompanyWalletId || null,
      item.payerCompanyName || null,
      item.payerWalletAddress || null,
      item.fundingTxHash || null,
      item.lockContractAddress || null,
      item.lockTransactionHash || null,
      item.releaseTransactionHash || null,
      item.onchainLockId || null,
      item.onchainVerifiedAt ? toMysqlDate(item.onchainVerifiedAt) : null,
      item.status,
      item.createdByUserId,
      JSON.stringify(item),
      toMysqlDate(item.createdAt),
      toMysqlDate(item.updatedAt)
    ]
  )
  return item
}
