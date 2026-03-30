import { describe, expect, it } from 'vitest'
import { resolveTaskHandoff } from '@/lib/workflow/handoff'
import type { TaskBounty } from '@/lib/types'

function makeTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'Bounty task',
    description: 'desc',
    source: 'external',
    rewardAmount: 120,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'alice',
    developerWallet: '0x' + '1'.repeat(40),
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('resolveTaskHandoff', () => {
  it('routes payment_failed to Finance queue with payout blocker narrative', () => {
    const handoff = resolveTaskHandoff(makeTask({
      status: 'payment_failed',
      lastAutoPayoutError: 'Missing bounty:$xx label',
      rewardAmount: 80,
      rewardToken: 'USD1'
    }))

    expect(handoff.owner).toBe('finance')
    expect(handoff.queue).toBe('finance')
    expect(handoff.blockerSummary).toContain('confirmed amount 80 USD1')
  })

  it('routes awaiting_finance_review to Finance with explicit pre-payment next action', () => {
    const handoff = resolveTaskHandoff(makeTask({ status: 'awaiting_finance_review' }))
    expect(handoff.owner).toBe('finance')
    expect(handoff.queue).toBe('finance')
    expect(handoff.nextAction).toContain('Verify escrow lock status')
  })

  it('routes open unclaimed task to external contributor and claim blocker', () => {
    const handoff = resolveTaskHandoff(makeTask({ status: 'open', claimedByGithubLogin: undefined }))
    expect(handoff.owner).toBe('external_contributor')
    expect(handoff.queue).toBe('delivery')
    expect(handoff.blockerSummary).toContain('Waiting for claimer')
  })

  it('routes in_progress with PR evidence to delivery queue and evidence blocker text', () => {
    const handoff = resolveTaskHandoff(makeTask({ status: 'in_progress', prUrl: 'https://github.com/acme/repo/pull/1' }))
    expect(handoff.owner).toBe('external_contributor')
    expect(handoff.blockerSummary).toContain('Delivery evidence exists')
  })

  it('routes paid to done queue and prefers txHash in blocker summary', () => {
    const handoff = resolveTaskHandoff(makeTask({ status: 'paid', txHash: '0xpaidtx' }))
    expect(handoff.ownerLabel).toBe('Closed')
    expect(handoff.queue).toBe('done')
    expect(handoff.blockerSummary).toBe('0xpaidtx')
  })

  it('routes disputed/cancelled to platform ops queue', () => {
    const disputed = resolveTaskHandoff(makeTask({ status: 'disputed' }))
    const cancelled = resolveTaskHandoff(makeTask({ status: 'cancelled' }))
    expect(disputed.owner).toBe('platform_ops')
    expect(disputed.queue).toBe('ops')
    expect(cancelled.owner).toBe('platform_ops')
    expect(cancelled.queue).toBe('ops')
  })
})
