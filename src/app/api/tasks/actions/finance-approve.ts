import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import {
  auditTaskTransition,
  notifyTaskIssue,
  transitionTaskStatus
} from '@/lib/operations'
import {
  markSettlementExecutionReady,
  markSettlementRecipientWalletFrozen
} from '@/lib/repositories/settlement-case-repository'
import { saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureTaskCapability,
  resolveRecipientWalletSource
} from '../helpers'

export async function handleFinanceApprove(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  const permission = await ensureTaskCapability(session, task, 'payment.approve')
  if (!permission.ok) return permission.response
  if (!['awaiting_acceptance', 'awaiting_finance_review', 'payment_failed'].includes(task.status)) {
    return NextResponse.json({ error: 'Current task status does not allow finance approval' }, { status: 400 })
  }
  if (!task.developerWallet) {
    return NextResponse.json({ error: 'Missing recipient wallet address; cannot execute finance approval' }, { status: 400 })
  }
  transitionTaskStatus(task, 'accepted', {
    manualReviewRequired: false,
    reason: String(body.reason || 'Finance approved payout conditions; handing off to payout execution')
  })
  task.manualReviewRequired = false
  task.lastAutoPayoutError = undefined
  task.lastAutoPayoutFailureCode = undefined
  task.lastAutoPayoutRetryStrategy = undefined
  task.nextAutoRetryAt = undefined
  task.autoRetryJobId = undefined
  task.updatedAt = new Date().toISOString()
  await saveTaskBountiesDb(tasks)
  await markSettlementRecipientWalletFrozen(task, {
    recipientWalletAddress: task.developerWallet,
    recipientGithubLogin: task.claimedByGithubLogin,
    recipientWalletSource: resolveRecipientWalletSource(task, task.developerWallet)
  })
  await markSettlementExecutionReady(task)
  await notifyTaskIssue({
    task,
    severity: 'info',
    category: 'task_status',
    title: 'Finance approved',
    message: `${task.title} finance approval completed; awaiting payout execution`,
    actionUrl: '/staff'
  })
  await auditTaskTransition(task, session, 'Finance approved; entering payout execution', { reason: body.reason || null })
  return NextResponse.json({ success: true, task })
}
