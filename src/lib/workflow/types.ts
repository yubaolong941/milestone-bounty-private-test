import { TaskBounty, TaskBountyStatus } from '@/lib/types'

export type WorkflowStatus = TaskBountyStatus

export interface WorkflowTransitionOptions {
  reason?: string
  manualReviewRequired?: boolean
  changedAt?: string
}

export interface WorkflowTransitionResult {
  previousStatus: WorkflowStatus
  currentStatus: WorkflowStatus
  changedAt: string
}

export interface WorkflowTransitionInput {
  task: TaskBounty
  nextStatus: WorkflowStatus
  options?: WorkflowTransitionOptions
}
