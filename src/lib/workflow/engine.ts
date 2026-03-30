import { TaskBounty } from '@/lib/types'
import { canTransitionTaskStatus } from '@/lib/workflow/guards'
import { WorkflowTransitionInput, WorkflowTransitionResult } from '@/lib/workflow/types'

export function applyTaskWorkflowTransition(input: WorkflowTransitionInput): WorkflowTransitionResult {
  const { task, nextStatus, options } = input
  const previousStatus = task.status

  if (!canTransitionTaskStatus(task, nextStatus)) {
    throw new Error(`Invalid status transition: ${previousStatus} -> ${nextStatus}`)
  }

  const changedAt = options?.changedAt || new Date().toISOString()
  task.status = nextStatus
  task.updatedAt = changedAt

  if (options?.manualReviewRequired !== undefined) {
    task.manualReviewRequired = options.manualReviewRequired
  }
  if (options?.reason !== undefined) {
    task.manualReviewReason = options.reason
  }

  return {
    previousStatus,
    currentStatus: nextStatus,
    changedAt
  }
}

export function isTaskWorkflowTerminal(task: TaskBounty) {
  return task.status === 'paid' || task.status === 'cancelled' || task.status === 'disputed'
}
