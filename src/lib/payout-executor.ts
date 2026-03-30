import { evaluateAutoPayout } from '@/lib/bounty-payout'
import { completePayoutAttempt, failPayoutAttempt, startPayoutAttempt } from '@/lib/repositories/payout-attempt-repository'
import { syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import { TaskBounty } from '@/lib/types'
import { hashWorkflowPayload } from '@/lib/workflow/events'

export interface TryAutoPayoutOptions {
  mergedOverride?: boolean
  riskPassed: boolean
  allowManualRelease?: boolean
  source?: 'auto_payout' | 'manual_execute' | 'manual_retry' | 'github_webhook' | 'lark_callback' | 'scheduler'
  idempotencyKey?: string
}

export interface TryAutoPayoutResult {
  success: boolean
  error?: string
  checks?: Record<string, unknown>
  txHash?: string
  walletBindingId?: string
  fundingLockId?: string
  duplicate?: boolean
  shouldRecordLedger?: boolean
}

export async function tryAutoPayout(task: TaskBounty, options: TryAutoPayoutOptions): Promise<TryAutoPayoutResult> {
  const settlement = await syncSettlementCaseFromTask(task)
  if ((task.status === 'paid' || settlement.payoutState === 'paid') && (task.txHash || settlement.payoutTxHash)) {
    const txHash = task.txHash || settlement.payoutTxHash
    if (txHash) task.txHash = txHash
    if (!task.paidAt && settlement.paidAt) task.paidAt = settlement.paidAt
    task.status = 'paid'
    task.updatedAt = new Date().toISOString()
    return {
      success: true,
      txHash,
      duplicate: true,
      shouldRecordLedger: false,
      walletBindingId: task.payoutWalletBindingId,
      fundingLockId: task.rewardLockId,
      checks: task.lastAutoPayoutChecks
    }
  }

  const idempotencyKey = options.idempotencyKey
    || `payout:${options.source || 'auto_payout'}:${task.id}:${hashWorkflowPayload([
      task.status,
      task.updatedAt,
      task.rewardLockId,
      task.rewardReleaseTxHash,
      task.prUrl,
      String(options.mergedOverride ?? ''),
      String(options.riskPassed),
      String(options.allowManualRelease ?? false)
    ])}`
  const attemptStart = await startPayoutAttempt({
    settlementCaseId: settlement.id,
    taskId: task.id,
    companyId: task.companyId,
    payoutContext: options.source || 'auto_payout',
    idempotencyKey,
    amount: settlement.allocatedAmount ?? settlement.amount,
    token: settlement.token,
    recipientWalletAddress: settlement.recipientWalletAddress || task.developerWallet,
    requestPayload: {
      mergedOverride: options.mergedOverride ?? null,
      riskPassed: options.riskPassed,
      allowManualRelease: options.allowManualRelease ?? false,
      sourceTaskStatus: task.status,
      settlementPayoutState: settlement.payoutState
    }
  })

  if (attemptStart.kind === 'duplicate') {
    const existing = attemptStart.attempt
    if (existing.status === 'succeeded') {
      if (existing.txHash) task.txHash = existing.txHash
      task.status = 'paid'
      task.updatedAt = new Date().toISOString()
      return {
        success: true,
        txHash: existing.txHash,
        duplicate: true,
        shouldRecordLedger: false,
        walletBindingId: task.payoutWalletBindingId,
        fundingLockId: task.rewardLockId,
        checks: existing.resultPayload
      }
    }
    if (existing.status === 'processing') {
      return {
        success: false,
        error: 'A payout is already in progress for this task. Please try again later.',
        checks: existing.resultPayload || existing.requestPayload
      }
    }
    return {
      success: false,
      error: existing.error || 'A payout attempt with the same idempotency key has already failed',
      checks: existing.resultPayload
    }
  }

  if (attemptStart.kind === 'active_conflict') {
    return {
      success: false,
      error: 'An active payout execution context already exists for this settlement case. Duplicate broadcast has been blocked.',
      checks: {
        activeAttemptId: attemptStart.attempt.id,
        activeAttemptStatus: attemptStart.attempt.status,
        activeAttemptStartedAt: attemptStart.attempt.startedAt
      }
    }
  }

  const payout = await evaluateAutoPayout(task, options)
  if (!payout.success) {
    await failPayoutAttempt(attemptStart.attempt.id, payout.error || 'Payment failed', payout.checks)
    return payout
  }

  await completePayoutAttempt(attemptStart.attempt.id, {
    provider: payout.transferProvider,
    txHash: payout.txHash,
    resultPayload: payout.checks
  })

  return {
    ...payout,
    duplicate: false,
    shouldRecordLedger: true
  }
}
