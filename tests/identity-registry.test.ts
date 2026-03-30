import { describe, expect, it } from 'vitest'
import {
  isEvmWalletAddress,
  buildWalletChallengeMessage,
  verifyWalletSignature
} from '@/lib/identity-registry'

// ---------------------------------------------------------------------------
// isEvmWalletAddress
// ---------------------------------------------------------------------------

describe('isEvmWalletAddress — valid addresses', () => {
  it('accepts a standard 42-character 0x address (lowercase)', () => {
    expect(isEvmWalletAddress('0x' + 'a'.repeat(40))).toBe(true)
  })

  it('accepts a standard 42-character 0x address (uppercase)', () => {
    expect(isEvmWalletAddress('0x' + 'A'.repeat(40))).toBe(true)
  })

  it('accepts a mixed-case checksum address', () => {
    expect(isEvmWalletAddress('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(true)
  })

  it('accepts an address with leading/trailing whitespace (trim is applied)', () => {
    expect(isEvmWalletAddress('  0x' + 'a'.repeat(40) + '  ')).toBe(true)
  })

  it('accepts digits in hex range (0-9)', () => {
    expect(isEvmWalletAddress('0x1234567890123456789012345678901234567890')).toBe(true)
  })
})

describe('isEvmWalletAddress — invalid addresses', () => {
  it('rejects an address without 0x prefix', () => {
    expect(isEvmWalletAddress('a'.repeat(40))).toBe(false)
  })

  it('rejects an address that is too short (39 hex chars)', () => {
    expect(isEvmWalletAddress('0x' + 'a'.repeat(39))).toBe(false)
  })

  it('rejects an address that is too long (41 hex chars)', () => {
    expect(isEvmWalletAddress('0x' + 'a'.repeat(41))).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isEvmWalletAddress('')).toBe(false)
  })

  it('rejects an address with non-hex characters', () => {
    expect(isEvmWalletAddress('0x' + 'g'.repeat(40))).toBe(false)
  })

  it('rejects a string that is just "0x" without any hex', () => {
    expect(isEvmWalletAddress('0x')).toBe(false)
  })

  it('rejects a valid address with uppercase 0X prefix', () => {
    // regex expects lower-case 0x
    expect(isEvmWalletAddress('0X' + 'a'.repeat(40))).toBe(false)
  })

  it('rejects null/undefined gracefully when cast to string', () => {
    // Call with an invalid string — library accepts string type
    expect(isEvmWalletAddress('null')).toBe(false)
    expect(isEvmWalletAddress('undefined')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildWalletChallengeMessage
// ---------------------------------------------------------------------------

describe('buildWalletChallengeMessage', () => {
  const walletAddress = '0x' + 'a'.repeat(40)

  it('returns a nonce string', () => {
    const { nonce } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(typeof nonce).toBe('string')
    expect(nonce.length).toBeGreaterThan(0)
  })

  it('returns an issuedAt ISO timestamp', () => {
    const { issuedAt } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(new Date(issuedAt).toISOString()).toBe(issuedAt)
  })

  it('returns a message string', () => {
    const { message } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
  })

  it('includes the wallet address in the message', () => {
    const { message } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(message).toContain(walletAddress)
  })

  it('includes the nonce in the message', () => {
    const result = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(result.message).toContain(result.nonce)
  })

  it('uses "BountyPay Wallet Login" header for wallet_login purpose', () => {
    const { message } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(message).toContain('BountyPay Wallet Login')
  })

  it('uses "BountyPay Wallet Binding" header for bind_wallet purpose', () => {
    const { message } = buildWalletChallengeMessage({ purpose: 'bind_wallet', walletAddress })
    expect(message).toContain('BountyPay Wallet Binding')
  })

  it('includes userId in the message when provided', () => {
    const { message } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress, userId: 'user-42' })
    expect(message).toContain('user-42')
  })

  it('does not include UserId line when userId is omitted', () => {
    const { message } = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(message).not.toContain('UserId:')
  })

  it('produces unique nonces on each call', () => {
    const a = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    const b = buildWalletChallengeMessage({ purpose: 'wallet_login', walletAddress })
    expect(a.nonce).not.toBe(b.nonce)
  })
})

// ---------------------------------------------------------------------------
// verifyWalletSignature — invalid address guard
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — address validation', () => {
  it('returns error when walletAddress is not a valid EVM address', () => {
    const result = verifyWalletSignature({
      walletAddress: 'not-a-wallet',
      message: 'some message',
      signature: '0xdeadbeef'
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/invalid/i)
  })

  it('returns error for an empty wallet address', () => {
    const result = verifyWalletSignature({
      walletAddress: '',
      message: 'some message',
      signature: '0xdeadbeef'
    })
    expect(result.ok).toBe(false)
  })

  it('returns error for a wallet address that is too short', () => {
    const result = verifyWalletSignature({
      walletAddress: '0xabc',
      message: 'some message',
      signature: '0xdeadbeef'
    })
    expect(result.ok).toBe(false)
  })
})

describe('verifyWalletSignature — invalid signature', () => {
  const validAddress = '0x' + 'a'.repeat(40)

  it('returns error for a clearly invalid signature string', () => {
    const result = verifyWalletSignature({
      walletAddress: validAddress,
      message: 'BountyPay Wallet Login\nAddress: ' + validAddress,
      signature: 'not-a-real-sig'
    })
    expect(result.ok).toBe(false)
  })

  it('does not throw even for malformed signature input', () => {
    expect(() =>
      verifyWalletSignature({
        walletAddress: validAddress,
        message: 'hello',
        signature: ''
      })
    ).not.toThrow()
  })

  it('returns ok:false when recovered address mismatches expected wallet', () => {
    // 0x000...000 is a valid EVM address but an invalid signer for any real signature
    const result = verifyWalletSignature({
      walletAddress: '0x' + '0'.repeat(40),
      message: 'some message',
      signature: '0x' + 'f'.repeat(130) // malformed but no crash
    })
    expect(result.ok).toBe(false)
  })
})
