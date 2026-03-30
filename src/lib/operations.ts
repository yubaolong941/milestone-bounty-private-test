import { v4 as uuidv4 } from 'uuid'
import { insertAuditLog as insertAuditLogDb } from '@/lib/access-control-db'
import { SessionUser } from '@/lib/auth'
import { startWorkflowEvent, completeWorkflowEvent } from '@/lib/repositories/workflow-event-repository'
import { insertNotificationDb } from '@/lib/runtime-data-db'
import { AuditLog, NotificationEvent, TaskBounty, TaskBountyStatus } from '@/lib/types'
import { applyTaskWorkflowTransition } from '@/lib/workflow/engine'

export const MANUAL_REVIEW_STATUSES: TaskBountyStatus[] = [
  'awaiting_acceptance',
  'awaiting_manual_review',
  'awaiting_finance_review',
  'payment_failed'
]

export function transitionTaskStatus(task: TaskBounty, nextStatus: TaskBountyStatus, options?: {
  reason?: string
  manualReviewRequired?: boolean
}) {
  applyTaskWorkflowTransition({ task, nextStatus, options })
  return task
}

export async function recordAuditEvent(input: Omit<AuditLog, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
  const item: AuditLog = {
    id: input.id || uuidv4(),
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    metadata: input.metadata,
    createdAt: input.createdAt || new Date().toISOString()
  }
  await insertAuditLogDb(item)
  return item
}

export async function pushNotification(input: Omit<NotificationEvent, 'id' | 'createdAt' | 'acknowledged'> & { id?: string; createdAt?: string }) {
  const item: NotificationEvent = {
    id: input.id || uuidv4(),
    companyId: input.companyId,
    severity: input.severity,
    channel: input.channel,
    category: input.category,
    title: input.title,
    message: input.message,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    actionUrl: input.actionUrl,
    acknowledged: false,
    metadata: input.metadata,
    createdAt: input.createdAt || new Date().toISOString()
  }
  await insertNotificationDb(item)
  return item
}

export async function notifyTaskIssue(input: {
  task: TaskBounty
  severity: NotificationEvent['severity']
  category: NotificationEvent['category']
  title: string
  message: string
  actionUrl?: string
}) {
  input.task.lastNotificationAt = new Date().toISOString()
  const defaultActionUrl = input.category === 'payment_failure'
    ? '/staff?layer=operations&ops=payments&preset=with_issue'
    : input.category === 'manual_review'
      ? '/staff?layer=operations&ops=reviews&preset=review'
      : input.category === 'integration'
        ? '/staff?layer=evidence&evidence=health'
        : input.task.requirementDocUrl
          ? `/staff?layer=operations&ops=tasks&source=${input.task.source}&status=${input.task.status}`
          : '/staff?layer=operations&ops=tasks&source=external&needs=requirement'
  const inbox = await pushNotification({
    companyId: input.task.companyId,
    severity: input.severity,
    channel: 'inbox',
    category: input.category,
    title: input.title,
    message: input.message,
    taskId: input.task.id,
    taskTitle: input.task.title,
    actionUrl: input.actionUrl || defaultActionUrl,
    metadata: {
      status: input.task.status,
      companyName: input.task.companyName
    }
  })
  return { inbox }
}

export async function auditTaskTransition(task: TaskBounty, actor: SessionUser, summary: string, metadata?: Record<string, unknown>) {
  const workflowEvent = await startWorkflowEvent({
    taskId: task.id,
    companyId: task.companyId,
    eventType: `task.transition.${task.status}`,
    actorType: 'user',
    actorId: actor.userId,
    idempotencyKey: `task-transition:${task.id}:${task.status}:${task.updatedAt}`,
    payload: {
      summary,
      metadata: metadata || {}
    }
  })
  const audit = await recordAuditEvent({
    companyId: task.companyId,
    actorUserId: actor.userId,
    actorRole: actor.activeCompanyRole || actor.role,
    action: 'task.transition',
    targetType: 'task_bounty',
    targetId: task.id,
    summary,
    metadata: {
      taskStatus: task.status,
      taskTitle: task.title,
      ...metadata
    }
  })
  if (!workflowEvent.duplicate) {
    await completeWorkflowEvent(workflowEvent.event.id, {
      auditLogId: audit.id,
      taskStatus: task.status,
      taskId: task.id
    })
  }
  return audit
}
