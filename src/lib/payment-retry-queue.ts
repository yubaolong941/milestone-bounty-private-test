import { v4 as uuidv4 } from 'uuid'
import { appendAgentLedgerRecord } from '@/lib/bounty-payout'
import { notifyTaskIssue, recordAuditEvent, transitionTaskStatus } from '@/lib/operations'
import { classifyPaymentFailure, PaymentFailureClassification, shouldAutoRetryFailure } from '@/lib/payment-failures'
import { tryAutoPayout } from '@/lib/payout-executor'
import { markSettlementPaid, markSettlementPayoutFailed, markSettlementRetryQueued, syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import { getTaskBountyByIdDb, saveTaskBountiesDb, listPaymentRetryJobsDb, getActiveRetryJobForTaskDb, upsertPaymentRetryJobDb, savePaymentRetryJobsDb } from '@/lib/runtime-data-db'
import { PaymentRetryJob, PaymentFailureCode, TaskBounty } from '@/lib/types'

const AUTO_RETRY_DELAYS_MINUTES: Record<PaymentFailureCode, number> = {
  MERGE_NOT_COMPLETE: 5,
  CI_NOT_PASSED: 10,
  REVIEW_NOT_APPROVED: 0,
  AI_GATE_BLOCKED: 0,
  INSUFFICIENT_ESCROW_BALANCE: 0,
  ESCROW_VERIFICATION_FAILED: 0,
  ONCHAIN_FAILURE: 0,
  SIGNATURE_FAILURE: 0,
  PAYER_WALLET_MISMATCH: 0,
  RECIPIENT_IDENTITY_MISMATCH: 0,
  UNKNOWN_FAILURE: 0
}

const AUTO_RETRY_MAX_ATTEMPTS: Record<PaymentFailureCode, number> = {
  MERGE_NOT_COMPLETE: 3,
  CI_NOT_PASSED: 3,
  REVIEW_NOT_APPROVED: 0,
  AI_GATE_BLOCKED: 0,
  INSUFFICIENT_ESCROW_BALANCE: 0,
  ESCROW_VERIFICATION_FAILED: 0,
  ONCHAIN_FAILURE: 0,
  SIGNATURE_FAILURE: 0,
  PAYER_WALLET_MISMATCH: 0,
  RECIPIENT_IDENTITY_MISMATCH: 0,
  UNKNOWN_FAILURE: 0
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function getRetryDelayMinutes(code: PaymentFailureCode) {
  return AUTO_RETRY_DELAYS_MINUTES[code] ?? 15
}

function getRetryMaxAttempts(code: PaymentFailureCode) {
  return AUTO_RETRY_MAX_ATTEMPTS[code] ?? 2
}

export function getRetryScheduleForFailure(code: PaymentFailureCode, from = new Date()) {
  const delayMinutes = getRetryDelayMinutes(code)
  return {
    delayMinutes,
    scheduledAt: addMinutes(from, delayMinutes).toISOString(),
    maxAttempts: getRetryMaxAttempts(code)
  }
}

export async function enqueueAutoRetryForTask(input: {
  task: TaskBounty
  classification: PaymentFailureClassification
  source: PaymentRetryJob['source']
  error?: string
  metadata?: Record<string, unknown>
}) {
  if (!shouldAutoRetryFailure(input.classification, input.task.paymentFailureCount || 0)) {
    return { queued: false as const, reason: 'not_eligible' }
  }

  const now = new Date()
  const schedule = getRetryScheduleForFailure(input.classification.code, now)
  const active = await getActiveRetryJobForTaskDb(input.task.id)

  if (active) {
    active.failureCode = input.classification.code
    active.retryStrategy = input.classification.retryStrategy
    active.nextAction = input.classification.nextAction
    active.scheduledAt = schedule.scheduledAt
    active.maxAttempts = schedule.maxAttempts
    active.lastError = input.error || active.lastError
    active.metadata = { ...(active.metadata || {}), ...(input.metadata || {}) }
    active.updatedAt = now.toISOString()
    await upsertPaymentRetryJobDb(active)
    input.task.autoRetryJobId = active.id
    input.task.nextAutoRetryAt = active.scheduledAt
    input.task.updatedAt = now.toISOString()
    return { queued: true as const, job: active, deduped: true as const }
  }

  const job: PaymentRetryJob = {
    id: uuidv4(),
    taskId: input.task.id,
    companyId: input.task.companyId,
    taskTitle: input.task.title,
    failureCode: input.classification.code,
    retryStrategy: input.classification.retryStrategy,
    status: 'pending',
    source: input.source,
    attempts: 0,
    maxAttempts: schedule.maxAttempts,
    scheduledAt: schedule.scheduledAt,
    lastError: input.error,
    nextAction: input.classification.nextAction,
    metadata: input.metadata,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }
  await upsertPaymentRetryJobDb(job)
  input.task.autoRetryJobId = job.id
  input.task.nextAutoRetryAt = job.scheduledAt
  input.task.updatedAt = now.toISOString()
  return { queued: true as const, job, deduped: false as const }
}

function settleJob(job: PaymentRetryJob, status: PaymentRetryJob['status'], error?: string) {
  const now = new Date().toISOString()
  job.status = status
  job.updatedAt = now
  job.lockedAt = undefined
  if (error !== undefined) job.lastError = error
  if (status === 'completed' || status === 'dead_letter' || status === 'cancelled') {
    job.completedAt = now
  }
}

async function handleRetryFailure(job: PaymentRetryJob, task: TaskBounty, payout: { error?: string; checks?: Record<string, unknown> }) {
  const now = new Date()
  task.paymentFailureCount = (task.paymentFailureCount || 0) + 1
  task.lastPaymentAttemptAt = now.toISOString()

  const failure = classifyPaymentFailure({ error: payout.error, checks: payout.checks })
  task.lastAutoPayoutError = payout.error
  task.lastAutoPayoutFailureCode = failure.code
  task.lastAutoPayoutRetryStrategy = failure.retryStrategy
  task.lastAutoPayoutChecks = payout.checks

  if (shouldAutoRetryFailure(failure, task.paymentFailureCount) && job.attempts < job.maxAttempts) {
    const nextSchedule = getRetryScheduleForFailure(failure.code, now)
    job.failureCode = failure.code
    job.retryStrategy = failure.retryStrategy
    job.nextAction = failure.nextAction
    job.status = 'pending'
    job.scheduledAt = nextSchedule.scheduledAt
    job.maxAttempts = nextSchedule.maxAttempts
    job.updatedAt = now.toISOString()
    job.lockedAt = undefined
    job.lastError = payout.error || 'Auto-retry failed'
    task.nextAutoRetryAt = job.scheduledAt
    task.autoRetryJobId = job.id
    await markSettlementRetryQueued(task)
  } else {
    settleJob(job, 'dead_letter', payout.error || 'Auto-retry failed')
    task.nextAutoRetryAt = undefined
    task.autoRetryJobId = undefined
    transitionTaskStatus(task, 'payment_failed', {
      manualReviewRequired: true,
      reason: payout.error || 'Auto-retry exhausted. Escalating to manual review.'
    })
    await notifyTaskIssue({
      task,
      severity: 'critical',
      category: 'payment_failure',
      title: 'Auto-retry exhausted. Escalating to manual review.',
      message: `${task.title} auto-retry has reached its limit and requires manual intervention [${failure.code}]`,
      actionUrl: '/staff'
    })
    await markSettlementPayoutFailed(task, {
      failureCode: failure.code,
      retryStrategy: failure.retryStrategy,
      lastError: payout.error
    })
  }

  await recordAuditEvent({
    companyId: task.companyId,
    actorUserId: 'system:auto-retry',
    actorRole: 'system',
    action: 'payment.retry.failed',
    targetType: 'task_bounty',
    targetId: task.id,
    summary: `Auto-retry failed: ${failure.code}`,
    metadata: {
      taskStatus: task.status,
      taskTitle: task.title,
      error: payout.error,
      checks: payout.checks,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextScheduledAt: job.status === 'pending' ? job.scheduledAt : null,
      failureCode: failure.code,
      retryStrategy: failure.retryStrategy
    }
  })
}

async function handleRetrySuccess(job: PaymentRetryJob, task: TaskBounty, payout: {
  txHash?: string
  walletBindingId?: string
  fundingLockId?: string
  checks?: Record<string, unknown>
  shouldRecordLedger?: boolean
}) {
  task.nextAutoRetryAt = undefined
  task.autoRetryJobId = undefined
  task.lastPaymentAttemptAt = new Date().toISOString()
  settleJob(job, 'completed')
  await markSettlementPaid(task)

  const ledger = payout.shouldRecordLedger === false
    ? null
    : await appendAgentLedgerRecord({
        task,
        payout: {
          success: true,
          txHash: payout.txHash,
          walletBindingId: payout.walletBindingId,
          fundingLockId: payout.fundingLockId,
          checks: payout.checks
        }
      })

  await recordAuditEvent({
    companyId: task.companyId,
    actorUserId: 'system:auto-retry',
    actorRole: 'system',
    action: 'payment.retry.succeeded',
    targetType: 'task_bounty',
    targetId: task.id,
    summary: 'Auto-retry payment succeeded',
    metadata: {
      taskStatus: task.status,
      taskTitle: task.title,
      attempts: job.attempts,
      txHash: payout.txHash,
      ledgerId: ledger?.id || null,
      checks: payout.checks
    }
  })
}

export async function processDuePaymentRetryJobs(input?: {
  limit?: number
  now?: Date
}) {
  const now = input?.now || new Date()
  const limit = input?.limit || 10

  // Fetch all pending jobs due now — DB returns them sorted by scheduled_at ASC
  const allPending = await listPaymentRetryJobsDb({ status: 'pending', limit: 200 })
  const due = allPending
    .filter((job) => new Date(job.scheduledAt).getTime() <= now.getTime())
    .slice(0, limit)

  const results: Array<Record<string, unknown>> = []

  for (const job of due) {
    // Lock the job
    job.status = 'processing'
    job.lockedAt = now.toISOString()
    job.updatedAt = now.toISOString()
    job.attempts += 1
    await upsertPaymentRetryJobDb(job)

    const task = await getTaskBountyByIdDb(job.taskId)
    if (!task) {
      settleJob(job, 'cancelled', 'Task not found. Auto-retry cancelled.')
      await upsertPaymentRetryJobDb(job)
      results.push({ jobId: job.id, taskId: job.taskId, success: false, detail: 'task_missing' })
      continue
    }
    if (task.status === 'paid' || task.status === 'cancelled' || task.status === 'disputed') {
      settleJob(job, 'cancelled', `Task status=${task.status}. Auto-retry cancelled.`)
      task.nextAutoRetryAt = undefined
      task.autoRetryJobId = undefined
      task.updatedAt = new Date().toISOString()
      await upsertPaymentRetryJobDb(job)
      await saveTaskBountiesDb([task])
      await syncSettlementCaseFromTask(task)
      results.push({ jobId: job.id, taskId: task.id, success: false, detail: `task_${task.status}` })
      continue
    }
    if (task.status !== 'accepted') {
      settleJob(job, 'cancelled', `Task status=${task.status}. Finance clearance must be completed before retrying.`)
      task.nextAutoRetryAt = undefined
      task.autoRetryJobId = undefined
      task.updatedAt = new Date().toISOString()
      await upsertPaymentRetryJobDb(job)
      await saveTaskBountiesDb([task])
      await syncSettlementCaseFromTask(task)
      results.push({ jobId: job.id, taskId: task.id, success: false, detail: `waiting_finance_${task.status}` })
      continue
    }

    const payout = await tryAutoPayout(task, {
      mergedOverride: undefined,
      riskPassed: true,
      source: 'scheduler',
      idempotencyKey: `payout:retry-job:${job.id}:attempt:${job.attempts}`
    })
    if (!payout.success) {
      await handleRetryFailure(job, task, payout)
      task.updatedAt = new Date().toISOString()
      await upsertPaymentRetryJobDb(job)
      await saveTaskBountiesDb([task])
      results.push({
        jobId: job.id,
        taskId: task.id,
        success: false,
        detail: payout.error || 'retry_failed',
        failureCode: task.lastAutoPayoutFailureCode,
        nextAutoRetryAt: task.nextAutoRetryAt || null
      })
      continue
    }

    await handleRetrySuccess(job, task, payout)
    task.updatedAt = new Date().toISOString()
    await upsertPaymentRetryJobDb(job)
    await saveTaskBountiesDb([task])
    results.push({
      jobId: job.id,
      taskId: task.id,
      success: true,
      txHash: payout.txHash,
      attempts: job.attempts
    })
  }

  const remainingPending = await listPaymentRetryJobsDb({ status: 'pending', limit: 200 })
  return {
    success: true as const,
    processed: due.length,
    results,
    queueDepth: remainingPending.length
  }
}
