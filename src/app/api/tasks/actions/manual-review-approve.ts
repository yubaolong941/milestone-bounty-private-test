import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import {
  auditTaskTransition,
  notifyTaskIssue,
  transitionTaskStatus
} from '@/lib/operations'
import {
  markSettlementFinanceReviewReady,
  markSettlementRecipientWalletFrozen
} from '@/lib/repositories/settlement-case-repository'
import { saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureTaskCapability,
  resolveRecipientWalletSource
} from '../helpers'

export async function handleManualReviewApprove(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  const permission = await ensureTaskCapability(session, task, 'task.review')
  if (!permission.ok) return permission.response
  if (!task.developerWallet) {
    return NextResponse.json({ error: 'Missing recipient wallet address; cannot proceed to finance approval stage' }, { status: 400 })
  }
  task.manualReviewRequired = false
  task.manualReviewDecision = 'approved'
  task.manualReviewedByUserId = session.userId
  task.manualReviewedAt = new Date().toISOString()
  transitionTaskStatus(task, 'awaiting_finance_review', { reason: String(body.reason || 'Manual review approved; awaiting finance or operations to retry payout') })
  await saveTaskBountiesDb(tasks)
  await markSettlementRecipientWalletFrozen(task, {
    recipientWalletAddress: task.developerWallet,
    recipientGithubLogin: task.claimedByGithubLogin,
    recipientWalletSource: resolveRecipientWalletSource(task, task.developerWallet)
  })
  await markSettlementFinanceReviewReady(task)
  await notifyTaskIssue({
    task,
    severity: 'info',
    category: 'manual_review',
    title: 'Manual review approved',
    message: `${task.title} passed manual review; awaiting payout retry or finance confirmation`,
    actionUrl: '/staff'
  })
  await auditTaskTransition(task, session, 'Manual review approved', { reason: body.reason || null })
  return NextResponse.json({ success: true, task })
}
