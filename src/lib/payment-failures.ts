import { PaymentFailureCode, PaymentRetryStrategy } from '@/lib/types'

export interface PaymentFailureClassification {
  code: PaymentFailureCode
  retryStrategy: PaymentRetryStrategy
  nextAction: 'retry_automatically' | 'retry_manually' | 'fix_review' | 'fix_escrow' | 'investigate'
}

export function classifyPaymentFailure(input: {
  error?: string
  checks?: Record<string, unknown>
}): PaymentFailureClassification {
  const error = String(input.error || '')
  const checks = input.checks || {}

  if (error.toLowerCase().includes('signature') || error.toLowerCase().includes('signing')) {
    return { code: 'SIGNATURE_FAILURE', retryStrategy: 'manual_retry', nextAction: 'retry_manually' }
  }
  if (error.toLowerCase().includes('escrow balance insufficient') || error.toLowerCase().includes('budget insufficient') || error.toLowerCase().includes('locked budget is insufficient')) {
    return { code: 'INSUFFICIENT_ESCROW_BALANCE', retryStrategy: 'no_retry', nextAction: 'fix_escrow' }
  }
  if (error.toLowerCase().includes('on-chain escrow') || error.toLowerCase().includes('on-chain reward lock') || error.toLowerCase().includes('escrow verification')) {
    return { code: 'ESCROW_VERIFICATION_FAILED', retryStrategy: 'manual_retry', nextAction: 'fix_escrow' }
  }
  if ((error.toLowerCase().includes('payout wallet') || error.toLowerCase().includes('payout account') || error.toLowerCase().includes('platform payout')) && (error.toLowerCase().includes('does not match') || error.toLowerCase().includes('mismatch'))) {
    return { code: 'PAYER_WALLET_MISMATCH', retryStrategy: 'manual_retry', nextAction: 'investigate' }
  }
  if (error.toLowerCase().includes('claimer') || error.toLowerCase().includes('pr author does not match claimer')) {
    return { code: 'RECIPIENT_IDENTITY_MISMATCH', retryStrategy: 'no_retry', nextAction: 'investigate' }
  }
  if (error.includes('review approval') || checks.reviewApproved === false) {
    return { code: 'REVIEW_NOT_APPROVED', retryStrategy: 'no_retry', nextAction: 'fix_review' }
  }
  if (checks.ciPassed === false) {
    return { code: 'CI_NOT_PASSED', retryStrategy: 'auto_retry', nextAction: 'retry_automatically' }
  }
  if (checks.aiGatePassed === false || String(checks.aiGateDecision || '') === 'block') {
    return { code: 'AI_GATE_BLOCKED', retryStrategy: 'no_retry', nextAction: 'investigate' }
  }
  if (checks.merged === false || error.toLowerCase().includes('pr is merged') || error.toLowerCase().includes('pr not merged') || error.toLowerCase().includes('pr to be merged')) {
    return { code: 'MERGE_NOT_COMPLETE', retryStrategy: 'auto_retry', nextAction: 'retry_automatically' }
  }
  if (error.toLowerCase().includes('contract release failed') || error.toLowerCase().includes('payment failed') || error.toLowerCase().includes('onchain')) {
    return { code: 'ONCHAIN_FAILURE', retryStrategy: 'manual_retry', nextAction: 'retry_manually' }
  }

  return { code: 'UNKNOWN_FAILURE', retryStrategy: 'manual_retry', nextAction: 'investigate' }
}

export function shouldAutoRetryFailure(classification: PaymentFailureClassification, failureCount: number) {
  if (classification.retryStrategy !== 'auto_retry') return false
  return failureCount < 2
}
