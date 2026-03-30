import { TaskBounty } from '@/lib/types'
import { WorkflowStatus } from '@/lib/workflow/types'

export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  open: ['in_progress', 'cancelled', 'disputed', 'awaiting_manual_review'],
  in_progress: ['open', 'submitted', 'ai_reviewing', 'awaiting_manual_review', 'cancelled', 'disputed'],
  submitted: ['open', 'ai_reviewing', 'awaiting_acceptance', 'awaiting_manual_review', 'payment_failed', 'cancelled', 'disputed'],
  ai_reviewing: ['open', 'awaiting_acceptance', 'awaiting_manual_review', 'payment_failed', 'cancelled', 'disputed'],
  awaiting_acceptance: ['open', 'awaiting_manual_review', 'awaiting_finance_review', 'accepted', 'payment_failed', 'paid', 'cancelled', 'disputed'],
  awaiting_manual_review: ['open', 'awaiting_acceptance', 'awaiting_finance_review', 'payment_failed', 'cancelled', 'disputed'],
  awaiting_finance_review: ['open', 'awaiting_acceptance', 'accepted', 'payment_failed', 'paid', 'cancelled', 'disputed'],
  payment_failed: ['open', 'awaiting_manual_review', 'awaiting_finance_review', 'accepted', 'paid', 'cancelled', 'disputed'],
  accepted: ['open', 'awaiting_finance_review', 'payment_failed', 'paid', 'cancelled', 'disputed'],
  paid: [],
  disputed: ['cancelled'],
  cancelled: []
}

export function canTransitionTaskStatus(task: TaskBounty, nextStatus: WorkflowStatus) {
  if (task.status === nextStatus) return true
  return WORKFLOW_TRANSITIONS[task.status]?.includes(nextStatus) || false
}
