import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import {
  auditTaskTransition,
  notifyTaskIssue,
  transitionTaskStatus
} from '@/lib/operations'
import { syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import { saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureTaskCapability
} from '../helpers'

export async function handleManualReviewReject(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  const permission = await ensureTaskCapability(session, task, 'task.review')
  if (!permission.ok) return permission.response
  task.manualReviewRequired = false
  task.manualReviewDecision = 'rejected'
  task.manualReviewedByUserId = session.userId
  task.manualReviewedAt = new Date().toISOString()
  transitionTaskStatus(task, 'disputed', { reason: String(body.reason || 'Manual review rejected') })
  await saveTaskBountiesDb(tasks)
  await syncSettlementCaseFromTask(task)
  await notifyTaskIssue({
    task,
    severity: 'warning',
    category: 'manual_review',
    title: 'Manual review rejected',
    message: `${task.title} was rejected by manual review and has entered disputed status`,
    actionUrl: '/staff'
  })
  await auditTaskTransition(task, session, 'Manual review rejected', { reason: body.reason || null })
  return NextResponse.json({ success: true, task })
}
