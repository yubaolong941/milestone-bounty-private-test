import { describe, expect, it } from 'vitest'
import { applyTaskWorkflowTransition, isTaskWorkflowTerminal } from '@/lib/workflow/engine'
import { canTransitionTaskStatus, WORKFLOW_TRANSITIONS } from '@/lib/workflow/guards'
import type { TaskBounty, TaskBountyStatus } from '@/lib/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-001',
    title: 'Test task',
    description: 'desc',
    source: 'external',
    rewardAmount: 100,
    rewardToken: 'USD1',
    labels: ['auto-payout:on'],
    developerName: 'alice',
    developerWallet: '0x' + 'a'.repeat(40),
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

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

// ---------------------------------------------------------------------------
// canTransitionTaskStatus — same-state identity transitions
// ---------------------------------------------------------------------------

describe('canTransitionTaskStatus — identity (same → same)', () => {
  it.each(ALL_STATUSES)('allows %s → %s (same state)', (status) => {
    const task = makeTask({ status })
    expect(canTransitionTaskStatus(task, status)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// canTransitionTaskStatus — valid transitions from WORKFLOW_TRANSITIONS
// ---------------------------------------------------------------------------

describe('canTransitionTaskStatus — valid transitions per spec', () => {
  for (const [from, targets] of Object.entries(WORKFLOW_TRANSITIONS)) {
    for (const to of targets) {
      it(`allows ${from} → ${to}`, () => {
        const task = makeTask({ status: from as TaskBountyStatus })
        expect(canTransitionTaskStatus(task, to as TaskBountyStatus)).toBe(true)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// canTransitionTaskStatus — invalid transitions
// ---------------------------------------------------------------------------

describe('canTransitionTaskStatus — invalid transitions', () => {
  it('paid is a terminal state — no outbound transitions allowed', () => {
    const task = makeTask({ status: 'paid' })
    const disallowed = ALL_STATUSES.filter((s) => s !== 'paid')
    for (const next of disallowed) {
      expect(canTransitionTaskStatus(task, next)).toBe(false)
    }
  })

  it('cancelled is a terminal state — no outbound transitions allowed', () => {
    const task = makeTask({ status: 'cancelled' })
    const disallowed = ALL_STATUSES.filter((s) => s !== 'cancelled')
    for (const next of disallowed) {
      expect(canTransitionTaskStatus(task, next)).toBe(false)
    }
  })

  it('open cannot jump directly to paid', () => {
    expect(canTransitionTaskStatus(makeTask({ status: 'open' }), 'paid')).toBe(false)
  })

  it('open cannot jump directly to accepted', () => {
    expect(canTransitionTaskStatus(makeTask({ status: 'open' }), 'accepted')).toBe(false)
  })

  it('in_progress cannot jump directly to paid', () => {
    expect(canTransitionTaskStatus(makeTask({ status: 'in_progress' }), 'paid')).toBe(false)
  })

  it('submitted cannot jump directly to accepted', () => {
    expect(canTransitionTaskStatus(makeTask({ status: 'submitted' }), 'accepted')).toBe(false)
  })

  it('ai_reviewing cannot jump to in_progress', () => {
    expect(canTransitionTaskStatus(makeTask({ status: 'ai_reviewing' }), 'in_progress')).toBe(false)
  })

  it('accepted cannot go to submitted', () => {
    expect(canTransitionTaskStatus(makeTask({ status: 'accepted' }), 'submitted')).toBe(false)
  })

  it('disputed can only go to cancelled', () => {
    const task = makeTask({ status: 'disputed' })
    const allowed = WORKFLOW_TRANSITIONS.disputed
    for (const next of ALL_STATUSES) {
      if (next === 'disputed') {
        expect(canTransitionTaskStatus(task, next)).toBe(true) // same-state
      } else if (allowed.includes(next as TaskBountyStatus)) {
        expect(canTransitionTaskStatus(task, next)).toBe(true)
      } else {
        expect(canTransitionTaskStatus(task, next)).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// applyTaskWorkflowTransition — success paths
// ---------------------------------------------------------------------------

describe('applyTaskWorkflowTransition — successful transitions', () => {
  it('transitions open → in_progress and returns result object', () => {
    const task = makeTask({ status: 'open' })
    const result = applyTaskWorkflowTransition({ task, nextStatus: 'in_progress' })
    expect(result.previousStatus).toBe('open')
    expect(result.currentStatus).toBe('in_progress')
    expect(task.status).toBe('in_progress')
  })

  it('transitions in_progress → submitted', () => {
    const task = makeTask({ status: 'in_progress' })
    applyTaskWorkflowTransition({ task, nextStatus: 'submitted' })
    expect(task.status).toBe('submitted')
  })

  it('transitions submitted → ai_reviewing', () => {
    const task = makeTask({ status: 'submitted' })
    applyTaskWorkflowTransition({ task, nextStatus: 'ai_reviewing' })
    expect(task.status).toBe('ai_reviewing')
  })

  it('transitions ai_reviewing → awaiting_acceptance', () => {
    const task = makeTask({ status: 'ai_reviewing' })
    applyTaskWorkflowTransition({ task, nextStatus: 'awaiting_acceptance' })
    expect(task.status).toBe('awaiting_acceptance')
  })

  it('transitions awaiting_acceptance → accepted', () => {
    const task = makeTask({ status: 'awaiting_acceptance' })
    applyTaskWorkflowTransition({ task, nextStatus: 'accepted' })
    expect(task.status).toBe('accepted')
  })

  it('transitions accepted → paid', () => {
    const task = makeTask({ status: 'accepted' })
    applyTaskWorkflowTransition({ task, nextStatus: 'paid' })
    expect(task.status).toBe('paid')
  })

  it('transitions any non-terminal status → cancelled', () => {
    const cancellable: TaskBountyStatus[] = ['open', 'in_progress', 'submitted', 'ai_reviewing', 'awaiting_acceptance', 'accepted']
    for (const status of cancellable) {
      const task = makeTask({ status })
      applyTaskWorkflowTransition({ task, nextStatus: 'cancelled' })
      expect(task.status).toBe('cancelled')
    }
  })

  it('updates task.updatedAt on successful transition', () => {
    const before = '2020-01-01T00:00:00.000Z'
    const task = makeTask({ status: 'open', updatedAt: before })
    applyTaskWorkflowTransition({ task, nextStatus: 'in_progress' })
    expect(task.updatedAt).not.toBe(before)
  })

  it('uses options.changedAt when provided', () => {
    const changedAt = '2026-06-15T12:00:00.000Z'
    const task = makeTask({ status: 'open' })
    const result = applyTaskWorkflowTransition({ task, nextStatus: 'in_progress', options: { changedAt } })
    expect(result.changedAt).toBe(changedAt)
    expect(task.updatedAt).toBe(changedAt)
  })

  it('sets manualReviewRequired when provided in options', () => {
    const task = makeTask({ status: 'open' })
    applyTaskWorkflowTransition({ task, nextStatus: 'awaiting_manual_review', options: { manualReviewRequired: true } })
    expect(task.manualReviewRequired).toBe(true)
  })

  it('sets manualReviewReason (reason) when provided in options', () => {
    const task = makeTask({ status: 'open' })
    applyTaskWorkflowTransition({ task, nextStatus: 'awaiting_manual_review', options: { reason: 'needs human review' } })
    expect(task.manualReviewReason).toBe('needs human review')
  })

  it('does not mutate manualReviewRequired when option not provided', () => {
    const task = makeTask({ status: 'open', manualReviewRequired: false })
    applyTaskWorkflowTransition({ task, nextStatus: 'in_progress' })
    expect(task.manualReviewRequired).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// applyTaskWorkflowTransition — error paths
// ---------------------------------------------------------------------------

describe('applyTaskWorkflowTransition — invalid transitions throw', () => {
  it('throws on paid → any non-paid status', () => {
    const task = makeTask({ status: 'paid' })
    expect(() => applyTaskWorkflowTransition({ task, nextStatus: 'open' })).toThrow(
      /Invalid status transition/
    )
  })

  it('throws on cancelled → open', () => {
    const task = makeTask({ status: 'cancelled' })
    expect(() => applyTaskWorkflowTransition({ task, nextStatus: 'open' })).toThrow(
      /Invalid status transition/
    )
  })

  it('throws on open → paid (skip)', () => {
    const task = makeTask({ status: 'open' })
    expect(() => applyTaskWorkflowTransition({ task, nextStatus: 'paid' })).toThrow(
      /Invalid status transition/
    )
  })

  it('error message contains the from and to states', () => {
    const task = makeTask({ status: 'open' })
    expect(() => applyTaskWorkflowTransition({ task, nextStatus: 'paid' })).toThrow('open -> paid')
  })

  it('does not mutate task.status on a failed transition', () => {
    const task = makeTask({ status: 'paid' })
    try {
      applyTaskWorkflowTransition({ task, nextStatus: 'open' })
    } catch {
      // expected
    }
    expect(task.status).toBe('paid')
  })
})

// ---------------------------------------------------------------------------
// isTaskWorkflowTerminal
// ---------------------------------------------------------------------------

describe('isTaskWorkflowTerminal', () => {
  it('considers paid as terminal', () => {
    expect(isTaskWorkflowTerminal(makeTask({ status: 'paid' }))).toBe(true)
  })

  it('considers cancelled as terminal', () => {
    expect(isTaskWorkflowTerminal(makeTask({ status: 'cancelled' }))).toBe(true)
  })

  it('considers disputed as terminal', () => {
    expect(isTaskWorkflowTerminal(makeTask({ status: 'disputed' }))).toBe(true)
  })

  it.each(['open', 'in_progress', 'submitted', 'ai_reviewing', 'awaiting_acceptance', 'awaiting_manual_review', 'awaiting_finance_review', 'payment_failed', 'accepted'] as TaskBountyStatus[])(
    '%s is not terminal',
    (status) => {
      expect(isTaskWorkflowTerminal(makeTask({ status }))).toBe(false)
    }
  )
})
