import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import { appendAgentLedgerRecord } from '@/lib/bounty-payout'
import {
  auditTaskTransition,
  notifyTaskIssue,
  transitionTaskStatus
} from '@/lib/operations'
import { classifyPaymentFailure } from '@/lib/payment-failures'
import { enqueueAutoRetryForTask } from '@/lib/payment-retry-queue'
import { tryAutoPayout } from '@/lib/payout-executor'
import {
  markSettlementPaid,
  markSettlementPayoutFailed,
  markSettlementRetryQueued
} from '@/lib/repositories/settlement-case-repository'
import { saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureTaskCapability
} from '../helpers'

export async function handleExecutePayout(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[],
  source: 'manual_retry' | 'manual_execute' = 'manual_execute'
): Promise<NextResponse> {
  const permission = await ensureTaskCapability(session, task, 'payment.approve')
  if (!permission.ok) return permission.response
  if (task.status !== 'accepted') {
    return NextResponse.json({ error: 'Finance approval must be completed and task must be in accepted status before executing payout' }, { status: 400 })
  }
  const allowManualRelease =
    body.forceManualRelease === true
    || task.manualReviewDecision === 'approved'
    || task.status === 'accepted'
  const payout = await tryAutoPayout(task, {
    mergedOverride: body.merged as boolean | undefined,
    riskPassed: body.riskPassed !== false,
    allowManualRelease,
    source,
    idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined
  })
  await saveTaskBountiesDb(tasks)
  if (!payout.success) {
    task.paymentFailureCount = (task.paymentFailureCount || 0) + 1
    task.lastPaymentAttemptAt = new Date().toISOString()
    const failure = classifyPaymentFailure({ error: payout.error, checks: payout.checks })
    task.lastAutoPayoutFailureCode = failure.code
    task.lastAutoPayoutRetryStrategy = failure.retryStrategy
    const retryJob = await enqueueAutoRetryForTask({
      task,
      classification: failure,
      source: 'manual_retry',
      error: payout.error,
      metadata: {
        checks: payout.checks
      }
    })
    transitionTaskStatus(task, 'payment_failed', {
      manualReviewRequired: true,
      reason: payout.error || 'Payout retry failed'
    })
    await saveTaskBountiesDb(tasks)
    await markSettlementPayoutFailed(task, {
      failureCode: failure.code,
      retryStrategy: failure.retryStrategy,
      lastError: payout.error
    })
    if (retryJob.queued) {
      await markSettlementRetryQueued(task)
    }
    await notifyTaskIssue({
      task,
      severity: 'critical',
      category: 'payment_failure',
      title: 'Payout retry failed',
      message: `${payout.error || 'Payout retry failed'} [${failure.code}]`,
      actionUrl: '/staff'
    })
    await auditTaskTransition(task, session, 'Payout retry failed', {
      error: payout.error,
      checks: payout.checks,
      failureCode: failure.code,
      retryStrategy: failure.retryStrategy,
      autoRetryJobId: retryJob.queued ? retryJob.job.id : null,
      nextAutoRetryAt: retryJob.queued ? retryJob.job.scheduledAt : null
    })
    return NextResponse.json({
      success: false,
      error: payout.error,
      checks: payout.checks,
      failureCode: failure.code,
      retryStrategy: failure.retryStrategy,
      autoRetryJobId: retryJob.queued ? retryJob.job.id : undefined,
      nextAutoRetryAt: retryJob.queued ? retryJob.job.scheduledAt : undefined
    }, { status: 400 })
  }
  task.nextAutoRetryAt = undefined
  task.autoRetryJobId = undefined
  await saveTaskBountiesDb(tasks)
  await markSettlementPaid(task)
  const ledger = payout.shouldRecordLedger
    ? await appendAgentLedgerRecord({
        task,
        payout: {
          success: true,
          txHash: payout.txHash,
          walletBindingId: payout.walletBindingId,
          fundingLockId: payout.fundingLockId,
          checks: payout.checks
        }
      })
    : null
  await auditTaskTransition(task, session, 'Payout retry succeeded after manual review', {
    txHash: payout.txHash,
    checks: payout.checks
  })
  return NextResponse.json({ success: true, task, txHash: payout.txHash, ledger })
}
