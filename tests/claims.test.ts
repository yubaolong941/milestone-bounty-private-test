import { describe, expect, it } from 'vitest'
import {
  extractRewardFromLabels,
  extractRewardTokenFromLabels,
  extractWalletFromLabels,
  extractClaimFromLabels,
  hasAutoPayoutLabel,
  upsertLabel
} from '@/lib/claims'

// ---------------------------------------------------------------------------
// extractRewardFromLabels
// ---------------------------------------------------------------------------

describe('extractRewardFromLabels', () => {
  it('returns null for an empty label list', () => {
    expect(extractRewardFromLabels([])).toBeNull()
  })

  it('parses an integer bounty label', () => {
    expect(extractRewardFromLabels(['bounty:500'])).toBe(500)
  })

  it('parses a decimal bounty label', () => {
    expect(extractRewardFromLabels(['bounty:99.5'])).toBe(99.5)
  })

  it('parses a label with dollar sign prefix', () => {
    expect(extractRewardFromLabels(['bounty:$200'])).toBe(200)
  })

  it('parses a label with USD1 suffix (case-insensitive)', () => {
    expect(extractRewardFromLabels(['bounty:300USD1'])).toBe(300)
  })

  it('parses a label with USDT suffix', () => {
    expect(extractRewardFromLabels(['bounty:150USDT'])).toBe(150)
  })

  it('parses a label with U suffix', () => {
    expect(extractRewardFromLabels(['bounty:75U'])).toBe(75)
  })

  it('returns the first matching label when multiple bounty labels exist', () => {
    expect(extractRewardFromLabels(['bounty:100', 'bounty:200'])).toBe(100)
  })

  it('ignores non-bounty labels', () => {
    expect(extractRewardFromLabels(['priority:high', 'auto-payout:on'])).toBeNull()
  })

  it('ignores labels with non-numeric amounts', () => {
    expect(extractRewardFromLabels(['bounty:abc'])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractRewardTokenFromLabels
// ---------------------------------------------------------------------------

describe('extractRewardTokenFromLabels', () => {
  it('returns null for an empty list', () => {
    expect(extractRewardTokenFromLabels([])).toBeNull()
  })

  it('extracts a standard rewardToken label', () => {
    expect(extractRewardTokenFromLabels(['rewardToken:USD1'])).toBe('USD1')
  })

  it('uppercases the token symbol', () => {
    expect(extractRewardTokenFromLabels(['rewardToken:usdt'])).toBe('USDT')
  })

  it('allows alphanumeric-dash-underscore token symbols', () => {
    expect(extractRewardTokenFromLabels(['rewardToken:MY_TOKEN-1'])).toBe('MY_TOKEN-1')
  })

  it('returns null when no rewardToken label is present', () => {
    expect(extractRewardTokenFromLabels(['bounty:100', 'auto-payout:on'])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractWalletFromLabels
// ---------------------------------------------------------------------------

describe('extractWalletFromLabels', () => {
  it('returns null for an empty list', () => {
    expect(extractWalletFromLabels([])).toBeNull()
  })

  it('extracts a valid wallet address from label', () => {
    const addr = '0xabcdef1234567890abcdef1234567890abcdef12'
    expect(extractWalletFromLabels([`wallet:${addr}`])).toBe(addr)
  })

  it('returns null when label does not start with wallet:', () => {
    expect(extractWalletFromLabels(['bounty:100', 'auto-payout:on'])).toBeNull()
  })

  it('requires at least 6 hex chars after 0x (exclusive lower bound)', () => {
    // The regex is {6,} so 6 chars is the minimum that matches
    expect(extractWalletFromLabels(['wallet:0xabcdef'])).toBe('0xabcdef')
    // 5 hex chars is below the minimum — should not match
    expect(extractWalletFromLabels(['wallet:0xabcde'])).toBeNull()
    // 4 hex chars — also no match
    expect(extractWalletFromLabels(['wallet:0xabcd'])).toBeNull()
  })

  it('is case-insensitive for hex chars', () => {
    const addr = '0xABCDEF1234567890abcdef1234567890ABCDEF12'
    expect(extractWalletFromLabels([`wallet:${addr}`])).toBe(addr)
  })
})

// ---------------------------------------------------------------------------
// extractClaimFromLabels
// ---------------------------------------------------------------------------

describe('extractClaimFromLabels', () => {
  it('returns null for an empty list', () => {
    expect(extractClaimFromLabels([])).toBeNull()
  })

  it('extracts a github login from claim:@login', () => {
    expect(extractClaimFromLabels(['claim:@alice'])).toBe('alice')
  })

  it('extracts a github login from claim:login (no @)', () => {
    expect(extractClaimFromLabels(['claim:bob'])).toBe('bob')
  })

  it('lowercases the extracted login', () => {
    expect(extractClaimFromLabels(['claim:@Alice123'])).toBe('alice123')
  })

  it('returns null when no claim label is present', () => {
    expect(extractClaimFromLabels(['bounty:100', 'auto-payout:on'])).toBeNull()
  })

  it('ignores labels with invalid characters in the login', () => {
    // underscores and dots are not in [a-zA-Z0-9-], so no match
    expect(extractClaimFromLabels(['claim:@user_name'])).toBeNull()
  })

  it('returns the first matching claim login', () => {
    expect(extractClaimFromLabels(['claim:@first', 'claim:@second'])).toBe('first')
  })
})

// ---------------------------------------------------------------------------
// hasAutoPayoutLabel
// ---------------------------------------------------------------------------

describe('hasAutoPayoutLabel', () => {
  it('returns true when auto-payout:on is present', () => {
    expect(hasAutoPayoutLabel(['auto-payout:on'])).toBe(true)
  })

  it('returns false when auto-payout:on is absent', () => {
    expect(hasAutoPayoutLabel(['bounty:100', 'claim:@alice'])).toBe(false)
  })

  it('returns false for empty list', () => {
    expect(hasAutoPayoutLabel([])).toBe(false)
  })

  it('is case-sensitive — auto-payout:ON is not matched', () => {
    expect(hasAutoPayoutLabel(['auto-payout:ON'])).toBe(false)
  })

  it('returns true when mixed with other labels', () => {
    expect(hasAutoPayoutLabel(['bounty:100', 'auto-payout:on', 'claim:@alice'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// upsertLabel
// ---------------------------------------------------------------------------

describe('upsertLabel', () => {
  it('adds a label when no existing label matches the matcher', () => {
    const result = upsertLabel(['a', 'b'], 'bounty:200', /^bounty:/i)
    expect(result).toContain('bounty:200')
  })

  it('replaces an existing matching label', () => {
    const result = upsertLabel(['bounty:100', 'auto-payout:on'], 'bounty:200', /^bounty:/i)
    expect(result).not.toContain('bounty:100')
    expect(result).toContain('bounty:200')
  })

  it('preserves non-matching labels', () => {
    const result = upsertLabel(['auto-payout:on', 'bounty:100'], 'bounty:200', /^bounty:/i)
    expect(result).toContain('auto-payout:on')
  })

  it('deduplicates the next label if it already exists', () => {
    const result = upsertLabel(['bounty:200'], 'bounty:200', /^bounty:/i)
    expect(result.filter((l) => l === 'bounty:200')).toHaveLength(1)
  })

  it('returns an array', () => {
    expect(Array.isArray(upsertLabel([], 'x', /x/))).toBe(true)
  })
})
