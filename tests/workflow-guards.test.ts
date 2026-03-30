import { describe, expect, it } from 'vitest'
import { canTransitionTaskStatus, WORKFLOW_TRANSITIONS } from '@/lib/workflow/guards'
import type { TaskBounty, TaskBountyStatus } from '@/lib/types'

const ALL_STATUSES: TaskBountyStatus[] = [
  'open',
  'in_progress',
  'submitted',
  'ai_reviewing',
  'awaiting_acceptance',
  'awaiting_manual_review',
  'awaiting_finance_review',
  'payment_failed',
  'accepted',
  'paid',
  'disputed',
  'cancelled'
]

function makeTask(status: TaskBountyStatus): TaskBounty {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'desc',
    source: 'external',
    rewardAmount: 10,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'alice',
    developerWallet: '0x' + 'a'.repeat(40),
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('WORKFLOW_TRANSITIONS invariants', () => {
  it('contains transition definitions for every workflow status', () => {
    expect(Object.keys(WORKFLOW_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('only references known statuses as targets', () => {
    const allowed = new Set(ALL_STATUSES)
    for (const targets of Object.values(WORKFLOW_TRANSITIONS)) {
      for (const target of targets) {
        expect(allowed.has(target as TaskBountyStatus)).toBe(true)
      }
    }
  })

  it('keeps terminal statuses with no outgoing transitions', () => {
    expect(WORKFLOW_TRANSITIONS.paid).toEqual([])
    expect(WORKFLOW_TRANSITIONS.cancelled).toEqual([])
  })

  it('keeps disputed status restricted to cancelled only', () => {
    expect(WORKFLOW_TRANSITIONS.disputed).toEqual(['cancelled'])
  })
})

describe('canTransitionTaskStatus edge guards', () => {
  it('returns false for unknown current status even when next status is valid', () => {
    const unknownTask = makeTask('open') as TaskBounty
    unknownTask.status = 'unknown_status' as TaskBountyStatus
    expect(canTransitionTaskStatus(unknownTask, 'open')).toBe(false)
  })

  it('returns false when target is not in configured transitions', () => {
    expect(canTransitionTaskStatus(makeTask('awaiting_finance_review'), 'submitted')).toBe(false)
  })

  it('allows identity transition for terminal statuses', () => {
    expect(canTransitionTaskStatus(makeTask('paid'), 'paid')).toBe(true)
    expect(canTransitionTaskStatus(makeTask('cancelled'), 'cancelled')).toBe(true)
  })
})
