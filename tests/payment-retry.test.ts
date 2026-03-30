import { describe, expect, it } from 'vitest'
import { classifyPaymentFailure, shouldAutoRetryFailure } from '@/lib/payment-failures'
import { getRetryScheduleForFailure } from '@/lib/payment-retry-queue'
import type { PaymentFailureCode } from '@/lib/types'

// ---------------------------------------------------------------------------
// classifyPaymentFailure — signature
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — SIGNATURE_FAILURE', () => {
  it('classifies "signature" in error string', () => {
    const result = classifyPaymentFailure({ error: 'signature rejected' })
    expect(result.code).toBe('SIGNATURE_FAILURE')
    expect(result.retryStrategy).toBe('manual_retry')
    expect(result.nextAction).toBe('retry_manually')
  })

  it('classifies "signing" in error string', () => {
    const result = classifyPaymentFailure({ error: 'error during signing step' })
    expect(result.code).toBe('SIGNATURE_FAILURE')
  })

  it('is case-insensitive for signature keyword', () => {
    expect(classifyPaymentFailure({ error: 'SIGNATURE timeout' }).code).toBe('SIGNATURE_FAILURE')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — escrow balance
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — INSUFFICIENT_ESCROW_BALANCE', () => {
  it('classifies "escrow balance insufficient" error', () => {
    const result = classifyPaymentFailure({ error: 'On-chain escrow balance insufficient' })
    expect(result.code).toBe('INSUFFICIENT_ESCROW_BALANCE')
    expect(result.retryStrategy).toBe('no_retry')
    expect(result.nextAction).toBe('fix_escrow')
  })

  it('classifies "budget insufficient" error', () => {
    expect(classifyPaymentFailure({ error: 'budget insufficient for this task' }).code).toBe('INSUFFICIENT_ESCROW_BALANCE')
  })

  it('classifies "locked budget is insufficient" error', () => {
    expect(classifyPaymentFailure({ error: 'Bounty not locked or locked budget is insufficient' }).code).toBe('INSUFFICIENT_ESCROW_BALANCE')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — escrow verification
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — ESCROW_VERIFICATION_FAILED', () => {
  it('classifies "on-chain escrow" errors', () => {
    const result = classifyPaymentFailure({ error: 'on-chain escrow verification failed: unknown' })
    expect(result.code).toBe('ESCROW_VERIFICATION_FAILED')
    expect(result.retryStrategy).toBe('manual_retry')
    expect(result.nextAction).toBe('fix_escrow')
  })

  it('classifies "on-chain reward lock" errors', () => {
    expect(classifyPaymentFailure({ error: 'On-chain reward lock already released' }).code).toBe('ESCROW_VERIFICATION_FAILED')
  })

  it('classifies "escrow verification" in error string', () => {
    expect(classifyPaymentFailure({ error: 'escrow verification failed for task' }).code).toBe('ESCROW_VERIFICATION_FAILED')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — payer wallet mismatch
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — PAYER_WALLET_MISMATCH', () => {
  it('classifies payout wallet mismatch errors', () => {
    const result = classifyPaymentFailure({ error: 'Current payout wallet does not match task-configured account' })
    expect(result.code).toBe('PAYER_WALLET_MISMATCH')
    expect(result.retryStrategy).toBe('manual_retry')
    expect(result.nextAction).toBe('investigate')
  })

  it('classifies platform payout account mismatch errors', () => {
    const result = classifyPaymentFailure({ error: 'Current platform payout account does not match expected' })
    expect(result.code).toBe('PAYER_WALLET_MISMATCH')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — recipient identity mismatch
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — RECIPIENT_IDENTITY_MISMATCH', () => {
  it('classifies claimer mismatch errors', () => {
    const result = classifyPaymentFailure({ error: 'Claimer and deliverer do not match' })
    expect(result.code).toBe('RECIPIENT_IDENTITY_MISMATCH')
    expect(result.retryStrategy).toBe('no_retry')
    expect(result.nextAction).toBe('investigate')
  })

  it('classifies "pr author does not match claimer" errors', () => {
    expect(classifyPaymentFailure({ error: 'PR author does not match claimer' }).code).toBe('RECIPIENT_IDENTITY_MISMATCH')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — review not approved
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — REVIEW_NOT_APPROVED', () => {
  it('classifies error string containing "review approval"', () => {
    const result = classifyPaymentFailure({ error: 'Missing GitHub review approval. Task moved to awaiting manual acceptance.' })
    expect(result.code).toBe('REVIEW_NOT_APPROVED')
    expect(result.retryStrategy).toBe('no_retry')
    expect(result.nextAction).toBe('fix_review')
  })

  it('classifies via checks.reviewApproved === false', () => {
    const result = classifyPaymentFailure({ checks: { reviewApproved: false } })
    expect(result.code).toBe('REVIEW_NOT_APPROVED')
  })

  it('does not classify when reviewApproved is true', () => {
    const result = classifyPaymentFailure({ checks: { reviewApproved: true } })
    expect(result.code).not.toBe('REVIEW_NOT_APPROVED')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — CI not passed
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — CI_NOT_PASSED', () => {
  it('classifies via checks.ciPassed === false', () => {
    const result = classifyPaymentFailure({ checks: { ciPassed: false } })
    expect(result.code).toBe('CI_NOT_PASSED')
    expect(result.retryStrategy).toBe('auto_retry')
    expect(result.nextAction).toBe('retry_automatically')
  })

  it('does not classify when ciPassed is true', () => {
    const result = classifyPaymentFailure({ checks: { ciPassed: true } })
    expect(result.code).not.toBe('CI_NOT_PASSED')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — AI gate blocked
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — AI_GATE_BLOCKED', () => {
  it('classifies via checks.aiGatePassed === false', () => {
    const result = classifyPaymentFailure({ checks: { aiGatePassed: false } })
    expect(result.code).toBe('AI_GATE_BLOCKED')
    expect(result.retryStrategy).toBe('no_retry')
    expect(result.nextAction).toBe('investigate')
  })

  it('classifies via checks.aiGateDecision === "block"', () => {
    const result = classifyPaymentFailure({ checks: { aiGateDecision: 'block' } })
    expect(result.code).toBe('AI_GATE_BLOCKED')
  })

  it('does not classify when aiGatePassed is true', () => {
    const result = classifyPaymentFailure({ checks: { aiGatePassed: true } })
    expect(result.code).not.toBe('AI_GATE_BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — merge not complete
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — MERGE_NOT_COMPLETE', () => {
  it('classifies via checks.merged === false', () => {
    const result = classifyPaymentFailure({ checks: { merged: false } })
    expect(result.code).toBe('MERGE_NOT_COMPLETE')
    expect(result.retryStrategy).toBe('auto_retry')
    expect(result.nextAction).toBe('retry_automatically')
  })

  it('classifies "pr not merged" error string', () => {
    expect(classifyPaymentFailure({ error: 'PR not merged yet' }).code).toBe('MERGE_NOT_COMPLETE')
  })

  it('classifies "pr to be merged" error string', () => {
    expect(classifyPaymentFailure({ error: 'private_collab_pr mode requires the private repo PR to be merged' }).code).toBe('MERGE_NOT_COMPLETE')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — on-chain failure
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — ONCHAIN_FAILURE', () => {
  it('classifies "contract release failed" error', () => {
    const result = classifyPaymentFailure({ error: 'Contract release failed during execution' })
    expect(result.code).toBe('ONCHAIN_FAILURE')
    expect(result.retryStrategy).toBe('manual_retry')
    expect(result.nextAction).toBe('retry_manually')
  })

  it('classifies "payment failed" error', () => {
    expect(classifyPaymentFailure({ error: 'payment failed: revert' }).code).toBe('ONCHAIN_FAILURE')
  })

  it('classifies "onchain" in error string', () => {
    expect(classifyPaymentFailure({ error: 'onchain transaction reverted' }).code).toBe('ONCHAIN_FAILURE')
  })
})

// ---------------------------------------------------------------------------
// classifyPaymentFailure — unknown / fallback
// ---------------------------------------------------------------------------

describe('classifyPaymentFailure — UNKNOWN_FAILURE fallback', () => {
  it('returns UNKNOWN_FAILURE for an unrecognised error', () => {
    const result = classifyPaymentFailure({ error: 'some completely unrelated error message' })
    expect(result.code).toBe('UNKNOWN_FAILURE')
    expect(result.retryStrategy).toBe('manual_retry')
    expect(result.nextAction).toBe('investigate')
  })

  it('returns UNKNOWN_FAILURE for empty input', () => {
    const result = classifyPaymentFailure({})
    expect(result.code).toBe('UNKNOWN_FAILURE')
  })

  it('returns UNKNOWN_FAILURE when error is undefined', () => {
    expect(classifyPaymentFailure({ error: undefined }).code).toBe('UNKNOWN_FAILURE')
  })

  it('signature check takes precedence over fallback', () => {
    expect(classifyPaymentFailure({ error: 'Some signing error occurred' }).code).toBe('SIGNATURE_FAILURE')
  })
})

// ---------------------------------------------------------------------------
// shouldAutoRetryFailure
// ---------------------------------------------------------------------------

describe('shouldAutoRetryFailure', () => {
  it('returns true for CI_NOT_PASSED with 0 failures', () => {
    const c = classifyPaymentFailure({ checks: { ciPassed: false } })
    expect(shouldAutoRetryFailure(c, 0)).toBe(true)
  })

  it('returns true for CI_NOT_PASSED with 1 failure', () => {
    const c = classifyPaymentFailure({ checks: { ciPassed: false } })
    expect(shouldAutoRetryFailure(c, 1)).toBe(true)
  })

  it('returns false for CI_NOT_PASSED with 2 failures (max exceeded)', () => {
    const c = classifyPaymentFailure({ checks: { ciPassed: false } })
    expect(shouldAutoRetryFailure(c, 2)).toBe(false)
  })

  it('returns true for MERGE_NOT_COMPLETE with 0 failures', () => {
    const c = classifyPaymentFailure({ checks: { merged: false } })
    expect(shouldAutoRetryFailure(c, 0)).toBe(true)
  })

  it('returns false for MERGE_NOT_COMPLETE with 2 failures', () => {
    const c = classifyPaymentFailure({ checks: { merged: false } })
    expect(shouldAutoRetryFailure(c, 2)).toBe(false)
  })

  it('returns false for manual_retry strategy regardless of failureCount', () => {
    const c = classifyPaymentFailure({ error: 'signature error' })
    expect(c.retryStrategy).toBe('manual_retry')
    expect(shouldAutoRetryFailure(c, 0)).toBe(false)
  })

  it('returns false for no_retry strategy', () => {
    const c = classifyPaymentFailure({ checks: { reviewApproved: false } })
    expect(c.retryStrategy).toBe('no_retry')
    expect(shouldAutoRetryFailure(c, 0)).toBe(false)
  })

  it('returns false for UNKNOWN_FAILURE (manual_retry) with 0 failures', () => {
    const c = classifyPaymentFailure({})
    expect(shouldAutoRetryFailure(c, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getRetryScheduleForFailure
// ---------------------------------------------------------------------------

describe('getRetryScheduleForFailure', () => {
  it('returns a schedule with delayMinutes, scheduledAt, and maxAttempts', () => {
    const schedule = getRetryScheduleForFailure('CI_NOT_PASSED')
    expect(typeof schedule.delayMinutes).toBe('number')
    expect(typeof schedule.scheduledAt).toBe('string')
    expect(typeof schedule.maxAttempts).toBe('number')
  })

  it('CI_NOT_PASSED schedule has delayMinutes=10 and maxAttempts=3', () => {
    const schedule = getRetryScheduleForFailure('CI_NOT_PASSED')
    expect(schedule.delayMinutes).toBe(10)
    expect(schedule.maxAttempts).toBe(3)
  })

  it('MERGE_NOT_COMPLETE schedule has delayMinutes=5 and maxAttempts=3', () => {
    const schedule = getRetryScheduleForFailure('MERGE_NOT_COMPLETE')
    expect(schedule.delayMinutes).toBe(5)
    expect(schedule.maxAttempts).toBe(3)
  })

  it('no-retry codes return maxAttempts=0', () => {
    const noRetryCodes: PaymentFailureCode[] = [
      'REVIEW_NOT_APPROVED',
      'AI_GATE_BLOCKED',
      'INSUFFICIENT_ESCROW_BALANCE',
      'ESCROW_VERIFICATION_FAILED',
      'ONCHAIN_FAILURE',
      'SIGNATURE_FAILURE',
      'PAYER_WALLET_MISMATCH',
      'RECIPIENT_IDENTITY_MISMATCH',
      'UNKNOWN_FAILURE'
    ]
    for (const code of noRetryCodes) {
      expect(getRetryScheduleForFailure(code).maxAttempts).toBe(0)
    }
  })

  it('scheduledAt is after the from date', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const schedule = getRetryScheduleForFailure('CI_NOT_PASSED', from)
    expect(new Date(schedule.scheduledAt).getTime()).toBeGreaterThanOrEqual(from.getTime())
  })

  it('scheduledAt matches from + delayMinutes for CI_NOT_PASSED', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const schedule = getRetryScheduleForFailure('CI_NOT_PASSED', from)
    const expected = new Date(from.getTime() + 10 * 60_000).toISOString()
    expect(schedule.scheduledAt).toBe(expected)
  })

  it('uses default from=new Date() when not provided', () => {
    const before = Date.now()
    const schedule = getRetryScheduleForFailure('CI_NOT_PASSED')
    const after = Date.now()
    const scheduledTs = new Date(schedule.scheduledAt).getTime()
    // scheduledAt should be 10 minutes after "now" — just check it's in the future
    expect(scheduledTs).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000)
    expect(scheduledTs).toBeLessThanOrEqual(after + 10 * 60_000 + 1000)
  })
})
