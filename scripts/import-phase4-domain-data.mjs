import fs from 'fs'
import path from 'path'
import mysql from 'mysql2/promise'

const root = process.cwd()
const dataDir = path.join(root, 'data')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

function readJson(name) {
  const file = path.join(dataDir, name)
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function mysqlDate(value) {
  return new Date(value || Date.now()).toISOString().slice(0, 23).replace('T', ' ')
}

function deriveFundingState(task) {
  if (task.rewardLockStatus === 'locked') return 'locked'
  if (task.rewardLockStatus === 'released') return 'released'
  if (task.rewardLockStatus === 'cancelled') return 'cancelled'
  if (task.lastAutoPayoutFailureCode === 'INSUFFICIENT_ESCROW_BALANCE') return 'lock_failed'
  if (task.rewardLockId || task.rewardLockTxHash || task.treasuryFundingTxHash) return 'pending_lock'
  return 'not_required'
}

function derivePayoutState(task) {
  if (task.paidAt || task.txHash || task.rewardReleaseTxHash) return 'paid'
  if (task.status === 'payment_failed' || task.lastAutoPayoutFailureCode) return 'failed'
  if (task.status === 'accepted') return 'processing'
  if (task.status === 'awaiting_finance_review') return 'ready'
  return 'not_ready'
}

function deriveSettlementCaseFromTask(task) {
  const createdAt = task.createdAt || new Date().toISOString()
  const updatedAt = task.updatedAt || createdAt
  return {
    id: `settlement-${task.id}`,
    taskId: task.id,
    companyId: task.companyId,
    companyName: task.companyName ?? task.payerCompanyName,
    amount: task.rewardLockedAmount ?? task.treasuryFundingAmount ?? task.rewardAmount ?? 0,
    token: task.rewardLockedToken ?? task.treasuryFundingToken ?? task.rewardToken ?? 'USD1',
    payerWalletId: task.payerCompanyWalletId,
    payerWalletAddress: task.payerWalletAddress,
    recipientGithubLogin: task.claimedByGithubLogin,
    recipientWalletAddress: task.developerWallet || undefined,
    fundingLockId: task.rewardLockId,
    fundingTxHash: task.rewardLockTxHash ?? task.treasuryFundingTxHash,
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

function inferRequirementBindingSource(task) {
  if (task.meegleIssueId) return 'meegle_sync'
  if (task.githubIssueUrl) return 'github_issue_sync'
  if (task.source === 'external') return 'task_promote'
  return 'task_create'
}

function buildContentVersion(task) {
  return [
    task.requirementDocUrl || '',
    task.requirementDocTitle || '',
    task.requirementSummarySnapshot || task.description || '',
    ...(task.acceptanceCriteriaSnapshot || [])
  ].join('|')
}

function buildStatusVersion(task) {
  return [
    task.meegleIssueId || '',
    task.meegleUrl || '',
    task.githubIssueNumber ? String(task.githubIssueNumber) : '',
    task.githubIssueUrl || ''
  ].join('|')
}

function deriveRequirementBindingFromTask(task) {
  if (!task.requirementId || !task.requirementDocUrl) return null
  const createdAt = task.createdAt || new Date().toISOString()
  const updatedAt = task.updatedAt || createdAt
  return {
    id: task.requirementBindingId || `requirement-${task.requirementId}`,
    requirementId: task.requirementId,
    title: task.requirementDocTitle || task.title,
    companyId: task.companyId,
    companyName: task.companyName,
    larkDocUrl: task.requirementDocUrl,
    larkDocTitle: task.requirementDocTitle,
    meegleIssueId: task.meegleIssueId,
    meegleUrl: task.meegleUrl,
    meegleStatus: undefined,
    githubRepo: task.repo,
    githubIssueNumber: task.githubIssueNumber,
    githubIssueUrl: task.githubIssueUrl,
    acceptanceCriteriaSnapshot: task.acceptanceCriteriaSnapshot || [],
    summarySnapshot: task.requirementSummarySnapshot || task.description || '',
    contentVersion: buildContentVersion(task),
    statusVersion: buildStatusVersion(task),
    source: inferRequirementBindingSource(task),
    createdAt,
    updatedAt
  }
}

async function upsertSettlementCase(pool, item) {
  await pool.query(
    `INSERT INTO wlfi_settlement_cases
      (id, task_id, company_id, company_name, amount, token, payer_wallet_id, payer_wallet_address, recipient_github_login, recipient_wallet_address, funding_lock_id, funding_tx_hash, release_tx_hash, funding_state, payout_state, payout_tx_hash, failure_code, retry_strategy, last_error, last_attempt_at, paid_at, source_task_status, settlement_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      company_id = VALUES(company_id),
      company_name = VALUES(company_name),
      amount = VALUES(amount),
      token = VALUES(token),
      payer_wallet_id = VALUES(payer_wallet_id),
      payer_wallet_address = VALUES(payer_wallet_address),
      recipient_github_login = VALUES(recipient_github_login),
      recipient_wallet_address = VALUES(recipient_wallet_address),
      funding_lock_id = VALUES(funding_lock_id),
      funding_tx_hash = VALUES(funding_tx_hash),
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
      Number(item.amount || 0),
      item.token || 'USD1',
      item.payerWalletId || null,
      item.payerWalletAddress || null,
      item.recipientGithubLogin || null,
      item.recipientWalletAddress || null,
      item.fundingLockId || null,
      item.fundingTxHash || null,
      item.releaseTxHash || null,
      item.fundingState,
      item.payoutState,
      item.payoutTxHash || null,
      item.failureCode || null,
      item.retryStrategy || null,
      item.lastError || null,
      item.lastAttemptAt ? mysqlDate(item.lastAttemptAt) : null,
      item.paidAt ? mysqlDate(item.paidAt) : null,
      item.sourceTaskStatus,
      JSON.stringify(item),
      mysqlDate(item.createdAt),
      mysqlDate(item.updatedAt)
    ]
  )
}

async function upsertRequirementBinding(pool, item) {
  await pool.query(
    `INSERT INTO wlfi_requirement_bindings
      (id, requirement_id, title, company_id, company_name, lark_doc_url, lark_doc_title, meegle_issue_id, meegle_url, meegle_status, github_repo, github_issue_number, github_issue_url, acceptance_criteria_json, summary_snapshot, content_version, status_version, source, binding_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      requirement_id = VALUES(requirement_id),
      title = VALUES(title),
      company_id = VALUES(company_id),
      company_name = VALUES(company_name),
      lark_doc_url = VALUES(lark_doc_url),
      lark_doc_title = VALUES(lark_doc_title),
      meegle_issue_id = VALUES(meegle_issue_id),
      meegle_url = VALUES(meegle_url),
      meegle_status = VALUES(meegle_status),
      github_repo = VALUES(github_repo),
      github_issue_number = VALUES(github_issue_number),
      github_issue_url = VALUES(github_issue_url),
      acceptance_criteria_json = VALUES(acceptance_criteria_json),
      summary_snapshot = VALUES(summary_snapshot),
      content_version = VALUES(content_version),
      status_version = VALUES(status_version),
      source = VALUES(source),
      binding_json = VALUES(binding_json),
      updated_at = VALUES(updated_at)`,
    [
      item.id,
      item.requirementId,
      item.title,
      item.companyId || null,
      item.companyName || null,
      item.larkDocUrl,
      item.larkDocTitle || null,
      item.meegleIssueId || null,
      item.meegleUrl || null,
      item.meegleStatus || null,
      item.githubRepo || null,
      item.githubIssueNumber ?? null,
      item.githubIssueUrl || null,
      JSON.stringify(item.acceptanceCriteriaSnapshot || []),
      item.summarySnapshot || '',
      item.contentVersion || null,
      item.statusVersion || null,
      item.source,
      JSON.stringify(item),
      mysqlDate(item.createdAt),
      mysqlDate(item.updatedAt)
    ]
  )
}

async function upsertWorkflowEvent(pool, item) {
  await pool.query(
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
      Number(item.replayCount || 0),
      item.lastReplayedAt ? mysqlDate(item.lastReplayedAt) : null,
      item.processedAt ? mysqlDate(item.processedAt) : null,
      mysqlDate(item.createdAt),
      mysqlDate(item.updatedAt)
    ]
  )
}

async function main() {
  loadEnvFile(path.join(root, '.env.local'))
  loadEnvFile(path.join(root, '.env'))

  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5
  })

  const tasks = readJson('tasks.json')
  const storedSettlementCases = readJson('settlement-cases.json')
  const storedRequirementBindings = readJson('requirement-bindings.json')
  const workflowEvents = readJson('workflow-events.json')

  const settlementCases = storedSettlementCases.length > 0
    ? storedSettlementCases
    : tasks.map(deriveSettlementCaseFromTask)

  const requirementBindings = storedRequirementBindings.length > 0
    ? storedRequirementBindings
    : tasks.map(deriveRequirementBindingFromTask).filter(Boolean)

  for (const item of settlementCases) {
    await upsertSettlementCase(pool, item)
  }

  for (const item of requirementBindings) {
    await upsertRequirementBinding(pool, item)
  }

  for (const item of workflowEvents) {
    await upsertWorkflowEvent(pool, item)
  }

  await pool.end()

  console.log(JSON.stringify({
    success: true,
    source: {
      tasks: tasks.length,
      settlementCasesFile: storedSettlementCases.length,
      requirementBindingsFile: storedRequirementBindings.length,
      workflowEventsFile: workflowEvents.length
    },
    imported: {
      settlementCases: settlementCases.length,
      requirementBindings: requirementBindings.length,
      workflowEvents: workflowEvents.length
    }
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
