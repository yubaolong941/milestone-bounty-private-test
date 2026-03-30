import { describe, expect, it } from 'vitest'
import { classifyPaymentFailure, shouldAutoRetryFailure } from '@/lib/payment-failures'

describe('classifyPaymentFailure', () => {
  it('maps CI failure checks to auto retry', () => {
    expect(classifyPaymentFailure({ checks: { ciPassed: false } })).toEqual({
      code: 'CI_NOT_PASSED',
      retryStrategy: 'auto_retry',
      nextAction: 'retry_automatically'
    })
  })

  it('prioritizes signature failures from error messages', () => {
    expect(classifyPaymentFailure({ error: 'wallet signature rejected by user' })).toEqual({
      code: 'SIGNATURE_FAILURE',
      retryStrategy: 'manual_retry',
      nextAction: 'retry_manually'
    })
  })

  it('blocks payout when review approval is missing', () => {
    expect(classifyPaymentFailure({ checks: { reviewApproved: false } })).toEqual({
      code: 'REVIEW_NOT_APPROVED',
      retryStrategy: 'no_retry',
      nextAction: 'fix_review'
    })
  })
})

describe('shouldAutoRetryFailure', () => {
  it('allows fewer than two retries for auto retry failures', () => {
    const classification = classifyPaymentFailure({ checks: { ciPassed: false } })
    expect(shouldAutoRetryFailure(classification, 0)).toBe(true)
    expect(shouldAutoRetryFailure(classification, 1)).toBe(true)
    expect(shouldAutoRetryFailure(classification, 2)).toBe(false)
  })

  it('never auto retries manual retry failures', () => {
    const classification = classifyPaymentFailure({ error: 'payment failed: onchain revert' })
    expect(shouldAutoRetryFailure(classification, 0)).toBe(false)
  })
})
