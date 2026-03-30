import { ResultSetHeader, RowDataPacket } from 'mysql2'
import { queryMysql } from '@/lib/db'
import { loadSettlementCases, saveSettlementCases } from '@/lib/storage'
import { shouldUseFileStorage } from '@/lib/storage-backend'
import { PaymentFailureCode, PaymentRetryStrategy, SettlementCase, SettlementFundingState, SettlementPayoutState, TaskBounty } from '@/lib/types'
import { getTreasuryFundingByTxHash } from '@/lib/repositories/treasury-funding-repository'

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

function mapSettlementCaseRow(row: RowDataPacket): SettlementCase {
  const settlement = parseJson<SettlementCase>(row.settlement_json, {} as SettlementCase)
  return {
    ...settlement,
    id: String(row.id),
    taskId: String(row.task_id),
    companyId: row.company_id ? String(row.company_id) : settlement.companyId,
    companyName: row.company_name ? String(row.company_name) : settlement.companyName,
    amount: Number(row.amount ?? settlement.amount ?? 0),
    allocatedAmount: Number(row.allocated_amount ?? settlement.allocatedAmount ?? settlement.amount ?? 0),
    token: String(row.token || settlement.token || 'USD1'),
    treasuryFundingId: row.treasury_funding_id ? String(row.treasury_funding_id) : settlement.treasuryFundingId,
    treasuryFundingTxHash: row.treasury_funding_tx_hash ? String(row.treasury_funding_tx_hash) : settlement.treasuryFundingTxHash,
    payerWalletId: row.payer_wallet_id ? String(row.payer_wallet_id) : settlement.payerWalletId,
    payerWalletAddress: row.payer_wallet_address ? String(row.payer_wallet_address) : settlement.payerWalletAddress,
    recipientGithubLogin: row.recipient_github_login ? String(row.recipient_github_login) : settlement.recipientGithubLogin,
    recipientWalletAddress: row.recipient_wallet_address ? String(row.recipient_wallet_address) : settlement.recipientWalletAddress,
    recipientWalletFrozenAt: row.recipient_wallet_frozen_at ? toIso(row.recipient_wallet_frozen_at) : settlement.recipientWalletFrozenAt,
    recipientWalletSource: row.recipient_wallet_source ? String(row.recipient_wallet_source) as SettlementCase['recipientWalletSource'] : settlement.recipientWalletSource,
    fundingLockId: row.funding_lock_id ? String(row.funding_lock_id) : settlement.fundingLockId,
    fundingTxHash: row.funding_tx_hash ? String(row.funding_tx_hash) : settlement.fundingTxHash,
    fundingReservedAt: row.funding_reserved_at ? toIso(row.funding_reserved_at) : settlement.fundingReservedAt,
    releaseTxHash: row.release_tx_hash ? String(row.release_tx_hash) : settlement.releaseTxHash,
    fundingState: row.funding_state as SettlementCase['fundingState'],
    payoutState: row.payout_state as SettlementCase['payoutState'],
    payoutTxHash: row.payout_tx_hash ? String(row.payout_tx_hash) : settlement.payoutTxHash,
    failureCode: row.failure_code ? String(row.failure_code) as PaymentFailureCode : settlement.failureCode,
    retryStrategy: row.retry_strategy ? row.retry_strategy as PaymentRetryStrategy : settlement.retryStrategy,
    lastError: row.last_error ? String(row.last_error) : settlement.lastError,
    lastAttemptAt: row.last_attempt_at ? toIso(row.last_attempt_at) : settlement.lastAttemptAt,
    paidAt: row.paid_at ? toIso(row.paid_at) : settlement.paidAt,
    sourceTaskStatus: (row.source_task_status || settlement.sourceTaskStatus) as SettlementCase['sourceTaskStatus'],
    createdAt: toIso(row.created_at || settlement.createdAt),
    updatedAt: toIso(row.updated_at || settlement.updatedAt)
  }
}

function deriveFundingState(task: TaskBounty): SettlementFundingState {
  if (task.rewardLockStatus === 'locked') return 'locked'
  if (task.rewardLockStatus === 'released') return 'released'
  if (task.rewardLockStatus === 'cancelled') return 'cancelled'
  if (task.lastAutoPayoutFailureCode === 'INSUFFICIENT_ESCROW_BALANCE') return 'lock_failed'
  if (task.rewardLockId || task.rewardLockTxHash || task.treasuryFundingTxHash) return 'pending_lock'
  return 'not_required'
}

function derivePayoutState(task: TaskBounty): SettlementPayoutState {
  if (task.paidAt || task.txHash || task.rewardReleaseTxHash) return 'paid'
  if (task.status === 'payment_failed' || task.lastAutoPayoutFailureCode) return 'failed'
  if (task.status === 'accepted') return 'processing'
  if (task.status === 'awaiting_finance_review') return 'ready'
  return 'not_ready'
}

export function deriveSettlementCaseFromTask(task: TaskBounty): SettlementCase {
  const createdAt = task.createdAt || new Date().toISOString()
  const updatedAt = task.updatedAt || createdAt

  return {
    id: `settlement-${task.id}`,
    taskId: task.id,
    companyId: task.companyId,
    companyName: task.companyName ?? task.payerCompanyName,
    amount: task.rewardLockedAmount ?? task.treasuryFundingAmount ?? task.rewardAmount,
    allocatedAmount: task.rewardLockedAmount ?? task.treasuryFundingAmount ?? task.rewardAmount,
    token: task.rewardLockedToken ?? task.treasuryFundingToken ?? task.rewardToken,
    treasuryFundingTxHash: task.treasuryFundingTxHash,
    payerWalletId: task.payerCompanyWalletId,
    payerWalletAddress: task.payerWalletAddress,
    recipientGithubLogin: task.claimedByGithubLogin,
    recipientWalletAddress: task.developerWallet || undefined,
    fundingLockId: task.rewardLockId,
    fundingTxHash: task.rewardLockTxHash ?? task.treasuryFundingTxHash,
    fundingReservedAt: task.treasuryFundingVerifiedAt ?? task.updatedAt ?? createdAt,
    releaseTxHash: task.rewardReleaseTxHash,
    fundingState: deriveFundingState(task),
    payoutState: derivePayoutState(task),
    payoutTxHash: task.txHash,
    failureCode: task.lastAutoPayoutFailureCode,
    retryStrategy: task.lastAutoPayoutRetryStrategy,
    lastError: task.lastAutoPayoutError,
    lastAttemptAt: task.lastPaymentAttemptAt,
    paidAt: task.paidAt,
    sourceTaskStatus: task.status,
    createdAt,
    updatedAt
  }
}

async function buildSettlementFundingPatch(
  task: TaskBounty,
  existing?: SettlementCase | null
): Promise<Partial<SettlementCase>> {
  const reservedAmount = task.rewardLockedAmount ?? task.treasuryFundingAmount ?? task.rewardAmount

  if (!task.treasuryFundingTxHash) {
    return existing?.treasuryFundingTxHash
      ? {
          treasuryFundingId: existing.treasuryFundingId,
          treasuryFundingTxHash: existing.treasuryFundingTxHash,
          allocatedAmount: existing.allocatedAmount ?? reservedAmount,
          fundingReservedAt: existing.fundingReservedAt
        }
      : {}
  }

  const treasuryFunding = await getTreasuryFundingByTxHash(task.treasuryFundingTxHash)
  if (!treasuryFunding) {
    return {
      treasuryFundingId: existing?.treasuryFundingId,
      treasuryFundingTxHash: task.treasuryFundingTxHash,
      allocatedAmount: existing?.allocatedAmount ?? reservedAmount,
      fundingReservedAt: existing?.fundingReservedAt ?? task.treasuryFundingVerifiedAt ?? task.updatedAt
    }
  }

  const linkedToTask = treasuryFunding.linkedTaskIds.includes(task.id)
  return {
    treasuryFundingId: treasuryFunding.id,
    treasuryFundingTxHash: treasuryFunding.txHash,
    allocatedAmount: linkedToTask
      ? (existing?.allocatedAmount ?? reservedAmount)
      : existing?.allocatedAmount,
    fundingReservedAt: existing?.fundingReservedAt ?? treasuryFunding.verifiedAt ?? task.treasuryFundingVerifiedAt ?? task.updatedAt
  }
}

function buildSettlementRecipientPatch(
  task: TaskBounty,
  existing?: SettlementCase | null
): Partial<SettlementCase> {
  if (existing?.recipientWalletFrozenAt) {
    return {
      recipientGithubLogin: existing.recipientGithubLogin ?? task.claimedByGithubLogin,
      recipientWalletAddress: existing.recipientWalletAddress,
      recipientWalletFrozenAt: existing.recipientWalletFrozenAt,
      recipientWalletSource: existing.recipientWalletSource
    }
  }

  return {
    recipientGithubLogin: task.claimedByGithubLogin,
    recipientWalletAddress: task.developerWallet || undefined
  }
}

export function listSettlementCasesSync(): SettlementCase[] {
  return loadSettlementCases().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getSettlementCaseByTaskIdSync(taskId: string): SettlementCase | null {
  return loadSettlementCases().find((item) => item.taskId === taskId) ?? null
}

export async function listSettlementCases(): Promise<SettlementCase[]> {
  if (shouldUseFileStorage()) return listSettlementCasesSync()
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_settlement_cases ORDER BY updated_at DESC')
  return rows.map(mapSettlementCaseRow)
}

export async function getSettlementCaseByTaskId(taskId: string): Promise<SettlementCase | null> {
  if (shouldUseFileStorage()) return getSettlementCaseByTaskIdSync(taskId)
  const rows = await queryMysql<RowDataPacket[]>('SELECT * FROM wlfi_settlement_cases WHERE task_id = ? LIMIT 1', [taskId])
  return rows[0] ? mapSettlementCaseRow(rows[0]) : null
}

export async function upsertSettlementCase(item: SettlementCase): Promise<SettlementCase> {
  if (shouldUseFileStorage()) {
    const items = loadSettlementCases()
    const index = items.findIndex((existing) => existing.id === item.id)
    if (index >= 0) {
      items[index] = item
    } else {
      items.push(item)
    }
    saveSettlementCases(items)
    return item
  }

  await queryMysql<ResultSetHeader>(
      `INSERT INTO wlfi_settlement_cases
        (id, task_id, company_id, company_name, amount, allocated_amount, token, treasury_funding_id, treasury_funding_tx_hash, payer_wallet_id, payer_wallet_address, recipient_github_login, recipient_wallet_address, recipient_wallet_frozen_at, recipient_wallet_source, funding_lock_id, funding_tx_hash, funding_reserved_at, release_tx_hash, funding_state, payout_state, payout_tx_hash, failure_code, retry_strategy, last_error, last_attempt_at, paid_at, source_task_status, settlement_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        company_id = VALUES(company_id),
        company_name = VALUES(company_name),
        amount = VALUES(amount),
        allocated_amount = VALUES(allocated_amount),
        token = VALUES(token),
        treasury_funding_id = VALUES(treasury_funding_id),
        treasury_funding_tx_hash = VALUES(treasury_funding_tx_hash),
        payer_wallet_id = VALUES(payer_wallet_id),
        payer_wallet_address = VALUES(payer_wallet_address),
        recipient_github_login = VALUES(recipient_github_login),
        recipient_wallet_address = VALUES(recipient_wallet_address),
        recipient_wallet_frozen_at = VALUES(recipient_wallet_frozen_at),
        recipient_wallet_source = VALUES(recipient_wallet_source),
        funding_lock_id = VALUES(funding_lock_id),
        funding_tx_hash = VALUES(funding_tx_hash),
        funding_reserved_at = VALUES(funding_reserved_at),
        release_tx_hash = VALUES(release_tx_hash),
        funding_state = VALUES(funding_state),
        payout_state = VALUES(payout_state),
        payout_tx_hash = VALUES(payout_tx_hash),
        failure_code = VALUES(failure_code),
        retry_strategy = VALUES(retry_strategy),
        last_error = VALUES(last_error),
        last_attempt_at = VALUES(last_attempt_at),
        paid_at = VALUES(paid_at),
        source_task_status = VALUES(source_task_status),
        settlement_json = VALUES(settlement_json),
        updated_at = VALUES(updated_at)`,
      [
        item.id,
        item.taskId,
        item.companyId || null,
        item.companyName || null,
        item.amount,
        item.allocatedAmount ?? item.amount,
        item.token,
        item.treasuryFundingId || null,
        item.treasuryFundingTxHash || null,
        item.payerWalletId || null,
        item.payerWalletAddress || null,
        item.recipientGithubLogin || null,
        item.recipientWalletAddress || null,
        item.recipientWalletFrozenAt ? toMysqlDate(item.recipientWalletFrozenAt) : null,
        item.recipientWalletSource || null,
        item.fundingLockId || null,
        item.fundingTxHash || null,
        item.fundingReservedAt ? toMysqlDate(item.fundingReservedAt) : null,
        item.releaseTxHash || null,
        item.fundingState,
        item.payoutState,
        item.payoutTxHash || null,
        item.failureCode || null,
        item.retryStrategy || null,
        item.lastError || null,
        item.lastAttemptAt ? toMysqlDate(item.lastAttemptAt) : null,
        item.paidAt ? toMysqlDate(item.paidAt) : null,
        item.sourceTaskStatus,
        JSON.stringify(item),
        toMysqlDate(item.createdAt),
        toMysqlDate(item.updatedAt)
      ]
    )
  return item
}

export async function syncSettlementCaseFromTask(task: TaskBounty, patch?: Partial<SettlementCase>): Promise<SettlementCase> {
  const existing = await getSettlementCaseByTaskId(task.id)
  const derived = deriveSettlementCaseFromTask(task)
  const treasuryPatch = await buildSettlementFundingPatch(task, existing)
  const recipientPatch = buildSettlementRecipientPatch(task, existing)
  const item: SettlementCase = existing
    ? {
        ...existing,
        ...derived,
        ...treasuryPatch,
        ...recipientPatch,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: patch?.updatedAt || task.updatedAt || new Date().toISOString()
      }
    : {
        ...derived,
        ...treasuryPatch,
        ...recipientPatch,
        ...patch,
        updatedAt: patch?.updatedAt || derived.updatedAt
      }

  return upsertSettlementCase(item)
}

export async function markSettlementRecipientWalletFrozen(task: TaskBounty, input?: {
  recipientWalletAddress?: string
  recipientGithubLogin?: string
  recipientWalletSource?: SettlementCase['recipientWalletSource']
  recipientWalletFrozenAt?: string
}) {
  const resolvedAddress = input?.recipientWalletAddress ?? task.developerWallet
  if (!resolvedAddress) {
    throw new Error('Missing recipient wallet address required for escrow lock')
  }

  return syncSettlementCaseFromTask(task, {
    recipientGithubLogin: input?.recipientGithubLogin ?? task.claimedByGithubLogin,
    recipientWalletAddress: resolvedAddress,
    recipientWalletFrozenAt: input?.recipientWalletFrozenAt ?? new Date().toISOString(),
    recipientWalletSource: input?.recipientWalletSource ?? 'task_snapshot'
  })
}

export async function markSettlementFundingReserved(task: TaskBounty, input?: {
  treasuryFundingId?: string
  treasuryFundingTxHash?: string
  allocatedAmount?: number
  fundingReservedAt?: string
}) {
  const fundingState = task.rewardLockStatus === 'locked'
    ? 'locked'
    : task.treasuryFundingTxHash || input?.treasuryFundingTxHash
      ? 'pending_lock'
      : deriveFundingState(task)

  return syncSettlementCaseFromTask(task, {
    treasuryFundingId: input?.treasuryFundingId,
    treasuryFundingTxHash: input?.treasuryFundingTxHash ?? task.treasuryFundingTxHash,
    allocatedAmount: input?.allocatedAmount ?? task.rewardLockedAmount ?? task.treasuryFundingAmount ?? task.rewardAmount,
    fundingReservedAt: input?.fundingReservedAt ?? task.treasuryFundingVerifiedAt ?? task.updatedAt ?? new Date().toISOString(),
    fundingState
  })
}

export async function markSettlementFundingLocked(task: TaskBounty) {
  return markSettlementFundingReserved(task, {
    fundingReservedAt: task.treasuryFundingVerifiedAt ?? task.updatedAt ?? new Date().toISOString(),
    allocatedAmount: task.rewardLockedAmount ?? task.treasuryFundingAmount ?? task.rewardAmount,
    treasuryFundingTxHash: task.treasuryFundingTxHash
  }).then((settlement) => upsertSettlementCase({
    ...settlement,
    fundingState: 'locked',
    payoutState: task.status === 'awaiting_finance_review' ? 'ready' : derivePayoutState(task)
  }))
}

export async function markSettlementFinanceReviewReady(task: TaskBounty) {
  return syncSettlementCaseFromTask(task, {
    payoutState: 'ready',
    lastError: undefined,
    failureCode: undefined,
    retryStrategy: undefined
  })
}

export async function markSettlementExecutionReady(task: TaskBounty) {
  return syncSettlementCaseFromTask(task, {
    payoutState: 'processing',
    lastError: undefined,
    failureCode: undefined,
    retryStrategy: undefined
  })
}

export async function markSettlementPayoutFailed(task: TaskBounty, input?: {
  failureCode?: PaymentFailureCode
  retryStrategy?: PaymentRetryStrategy
  lastError?: string
}) {
  return syncSettlementCaseFromTask(task, {
    payoutState: 'failed',
    failureCode: input?.failureCode ?? task.lastAutoPayoutFailureCode,
    retryStrategy: input?.retryStrategy ?? task.lastAutoPayoutRetryStrategy,
    lastError: input?.lastError ?? task.lastAutoPayoutError,
    lastAttemptAt: task.lastPaymentAttemptAt
  })
}

export async function markSettlementRetryQueued(task: TaskBounty) {
  return syncSettlementCaseFromTask(task, {
    payoutState: 'failed',
    retryStrategy: task.lastAutoPayoutRetryStrategy,
    lastError: task.lastAutoPayoutError,
    lastAttemptAt: task.lastPaymentAttemptAt
  })
}

export async function markSettlementPaid(task: TaskBounty) {
  return syncSettlementCaseFromTask(task, {
    fundingState: 'released',
    payoutState: 'paid',
    payoutTxHash: task.txHash,
    releaseTxHash: task.rewardReleaseTxHash ?? task.txHash,
    failureCode: undefined,
    retryStrategy: undefined,
    lastError: undefined,
    paidAt: task.paidAt,
    lastAttemptAt: task.lastPaymentAttemptAt
  })
}
