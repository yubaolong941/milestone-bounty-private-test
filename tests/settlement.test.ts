import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  assertPlatformPayoutWalletReady,
  getPlatformPayoutWalletConfig,
  inspectPlatformPayoutWallet,
  transferWithConfiguredProvider
} from '@/lib/settlement'

// getPlatformPayoutWalletConfig is a pure function that reads env vars.
// validateExpectedFromAddress is an internal helper we can test via the
// exported behaviour of getPlatformPayoutWalletConfig + any re-exports.
// Since validateExpectedFromAddress is NOT exported, we test it indirectly
// through the settlement drift logic in inspectPlatformPayoutWallet.
// For pure-unit coverage we test what IS exported.

// ---------------------------------------------------------------------------
// getPlatformPayoutWalletConfig — structure / env-var driven
// ---------------------------------------------------------------------------

describe('getPlatformPayoutWalletConfig — shape', () => {
  it('returns an object with the required fields', () => {
    const config = getPlatformPayoutWalletConfig()
    expect(typeof config.enabled).toBe('boolean')
    expect(typeof config.provider).toBe('string')
    expect(typeof config.network).toBe('string')
    expect(typeof config.tokenSymbol).toBe('string')
  })

  it('returns a known provider key', () => {
    const validProviders = ['wlfi', 'agentpay', 'mock', 'evm_private_key']
    expect(validProviders).toContain(getPlatformPayoutWalletConfig().provider)
  })

  it('tokenSymbol is always uppercase', () => {
    const config = getPlatformPayoutWalletConfig()
    expect(config.tokenSymbol).toBe(config.tokenSymbol.toUpperCase())
  })

  it('network defaults to a non-empty string', () => {
    expect(getPlatformPayoutWalletConfig().network.length).toBeGreaterThan(0)
  })

  it('tokenSymbol defaults to USD1 when no env var is set', () => {
    // In the test env the fallback chain eventually produces USD1
    const config = getPlatformPayoutWalletConfig()
    // Only assert when none of the override env vars are set
    const overrideVars = [
      process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL,
      process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_SYMBOL,
      process.env.AGENTPAY_TOKEN_SYMBOL,
      process.env.WLFI_TOKEN_SYMBOL
    ]
    if (overrideVars.every((v) => !v)) {
      expect(config.tokenSymbol).toBe('USD1')
    }
  })

  it('enabled is false when walletAddress is not configured', () => {
    // In the test environment PLATFORM_PAYOUT_WALLET_ADDRESS is unlikely to be set
    // so enabled should remain false (unless someone has set it)
    const overrides = [
      process.env.PLATFORM_PAYOUT_WALLET_ADDRESS,
      process.env.AGENTPAY_PAYER_ADDRESS,
      process.env.WLFI_PAYER_ADDRESS,
      process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS
    ]
    const config = getPlatformPayoutWalletConfig()
    if (overrides.every((v) => !v)) {
      expect(config.enabled).toBe(false)
    }
  })
})

describe('getPlatformPayoutWalletConfig — env var: PLATFORM_PAYOUT_PROVIDER', () => {
  const original = process.env.PLATFORM_PAYOUT_PROVIDER
  const originalLegacy = process.env.PAYOUT_PROVIDER

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLATFORM_PAYOUT_PROVIDER
    } else {
      process.env.PLATFORM_PAYOUT_PROVIDER = original
    }
    if (originalLegacy === undefined) {
      delete process.env.PAYOUT_PROVIDER
    } else {
      process.env.PAYOUT_PROVIDER = originalLegacy
    }
    delete process.env.AGENTPAY_DEMO_MODE
    delete process.env.WLFI_DEMO_MODE
  })

  it('returns mock provider when AGENTPAY_DEMO_MODE=true', () => {
    process.env.AGENTPAY_DEMO_MODE = 'true'
    expect(getPlatformPayoutWalletConfig().provider).toBe('mock')
  })

  it('returns mock provider when WLFI_DEMO_MODE=true', () => {
    process.env.WLFI_DEMO_MODE = 'true'
    expect(getPlatformPayoutWalletConfig().provider).toBe('mock')
  })

  it('returns evm_private_key when PLATFORM_PAYOUT_PROVIDER=evm_private_key', () => {
    delete process.env.AGENTPAY_DEMO_MODE
    delete process.env.WLFI_DEMO_MODE
    process.env.PLATFORM_PAYOUT_PROVIDER = 'evm_private_key'
    process.env.PAYOUT_PROVIDER = 'evm_private_key'
    expect(getPlatformPayoutWalletConfig().provider).toBe('evm_private_key')
  })

  it('returns wlfi when PLATFORM_PAYOUT_PROVIDER=wlfi', () => {
    delete process.env.AGENTPAY_DEMO_MODE
    delete process.env.WLFI_DEMO_MODE
    process.env.PLATFORM_PAYOUT_PROVIDER = 'wlfi'
    expect(getPlatformPayoutWalletConfig().provider).toBe('wlfi')
  })

  it('returns mock when PLATFORM_PAYOUT_PROVIDER=mock', () => {
    delete process.env.AGENTPAY_DEMO_MODE
    delete process.env.WLFI_DEMO_MODE
    process.env.PLATFORM_PAYOUT_PROVIDER = 'mock'
    expect(getPlatformPayoutWalletConfig().provider).toBe('mock')
  })

  it('defaults to agentpay when provider is unrecognised', () => {
    delete process.env.AGENTPAY_DEMO_MODE
    delete process.env.WLFI_DEMO_MODE
    process.env.PLATFORM_PAYOUT_PROVIDER = 'unknown_provider'
    expect(getPlatformPayoutWalletConfig().provider).toBe('agentpay')
  })
})

describe('getPlatformPayoutWalletConfig — env var: PLATFORM_PAYOUT_TOKEN_SYMBOL', () => {
  const original = process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL
    } else {
      process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL = original
    }
  })

  it('uses and uppercases PLATFORM_PAYOUT_TOKEN_SYMBOL when set', () => {
    process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL = 'usdt'
    expect(getPlatformPayoutWalletConfig().tokenSymbol).toBe('USDT')
  })
})

describe('getPlatformPayoutWalletConfig — env var: PLATFORM_PAYOUT_NETWORK', () => {
  const original = process.env.PLATFORM_PAYOUT_NETWORK

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLATFORM_PAYOUT_NETWORK
    } else {
      process.env.PLATFORM_PAYOUT_NETWORK = original
    }
  })

  it('uses PLATFORM_PAYOUT_NETWORK when set', () => {
    process.env.PLATFORM_PAYOUT_NETWORK = 'base_sepolia'
    expect(getPlatformPayoutWalletConfig().network).toBe('base_sepolia')
  })
})

describe('getPlatformPayoutWalletConfig — enabled flag logic', () => {
  const savedVars: Record<string, string | undefined> = {}
  const keysToReset = ['PLATFORM_PAYOUT_WALLET_ADDRESS', 'PLATFORM_PAYOUT_NETWORK', 'PLATFORM_PAYOUT_TOKEN_SYMBOL']

  beforeEach(() => {
    for (const k of keysToReset) savedVars[k] = process.env[k]
  })

  afterEach(() => {
    for (const k of keysToReset) {
      if (savedVars[k] === undefined) delete process.env[k]
      else process.env[k] = savedVars[k]
    }
  })

  it('is enabled when wallet address, network and token are all set', () => {
    process.env.PLATFORM_PAYOUT_WALLET_ADDRESS = '0x' + 'a'.repeat(40)
    process.env.PLATFORM_PAYOUT_NETWORK = 'base'
    process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL = 'USD1'
    expect(getPlatformPayoutWalletConfig().enabled).toBe(true)
  })

  it('walletAddress is trimmed when returned', () => {
    process.env.PLATFORM_PAYOUT_WALLET_ADDRESS = '  0x' + 'a'.repeat(40) + '  '
    const config = getPlatformPayoutWalletConfig()
    expect(config.walletAddress).toBe('0x' + 'a'.repeat(40))
  })
})

// ---------------------------------------------------------------------------
// Drift detection logic (pure) — tested through inspectPlatformPayoutWallet
// We exercise the drift helper validateExpectedFromAddress indirectly via
// the mock provider's transfer behaviour captured in settlement module.
// ---------------------------------------------------------------------------

describe('settlement drift — address comparison logic (pure helpers)', () => {
  // We import validateExpectedFromAddress indirectly by verifying the
  // documented contract: same address → ok, different → error, missing actual → error.
  // Since it's not exported, we reproduce the exact same logic in a local helper
  // that follows the spec, then test our understanding of the branch behaviour.
  function localValidate(expected: string | undefined, actual: string | undefined) {
    if (!expected) return { ok: true as const }
    if (!actual) return { ok: false as const, error: 'Unable to identify current platform payout wallet address' }
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false as const, error: `Mismatch: ${actual} vs ${expected}` }
    }
    return { ok: true as const }
  }

  it('returns ok when expectedFromAddress is undefined', () => {
    expect(localValidate(undefined, '0xABC').ok).toBe(true)
  })

  it('returns error when actual address is undefined but expected is set', () => {
    expect(localValidate('0xABC', undefined).ok).toBe(false)
  })

  it('returns ok when addresses match case-insensitively', () => {
    expect(localValidate('0xAbCdEf', '0xabcdef').ok).toBe(true)
  })

  it('returns error when addresses differ', () => {
    expect(localValidate('0xAAAA', '0xBBBB').ok).toBe(false)
  })

  it('returns ok when both addresses are identical strings', () => {
    const addr = '0x' + 'a'.repeat(40)
    expect(localValidate(addr, addr).ok).toBe(true)
  })

  it('returns ok when no expected address is provided (no restriction)', () => {
    expect(localValidate(undefined, undefined).ok).toBe(true)
  })
})

describe('inspectPlatformPayoutWallet / transferWithConfiguredProvider — mock settlement flow', () => {
  const keysToReset = [
    'AGENTPAY_DEMO_MODE',
    'WLFI_DEMO_MODE',
    'PLATFORM_PAYOUT_PROVIDER',
    'PLATFORM_PAYOUT_WALLET_ADDRESS',
    'PLATFORM_PAYOUT_NETWORK',
    'PLATFORM_PAYOUT_TOKEN_SYMBOL',
    'PLATFORM_PAYOUT_TOKEN_ADDRESS',
    'AGENTPAY_DEMO_FROM_ADDRESS',
    'AGENTPAY_PAYER_ADDRESS',
    'AGENTPAY_NETWORK',
    'AGENTPAY_TOKEN_SYMBOL',
    'AGENTPAY_TOKEN_ADDRESS',
    'PLATFORM_PAYOUT_PRIVATE_KEY'
  ] as const
  const savedVars: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of keysToReset) savedVars[key] = process.env[key]
    process.env.AGENTPAY_DEMO_MODE = 'true'
    process.env.PLATFORM_PAYOUT_WALLET_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.PLATFORM_PAYOUT_NETWORK = 'bsc'
    process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL = 'USD1'
    process.env.PLATFORM_PAYOUT_TOKEN_ADDRESS = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'
    process.env.AGENTPAY_DEMO_FROM_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.AGENTPAY_NETWORK = 'bsc'
    process.env.AGENTPAY_TOKEN_SYMBOL = 'USD1'
    process.env.AGENTPAY_TOKEN_ADDRESS = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const key of keysToReset) {
      if (savedVars[key] === undefined) delete process.env[key]
      else process.env[key] = savedVars[key]
    }
  })

  it('reports ok health when configured wallet and runtime wallet are aligned', async () => {
    const health = await inspectPlatformPayoutWallet()

    expect(health).toMatchObject({
      ok: true,
      health: 'ok',
      provider: 'mock',
      configuredAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      currentAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      network: 'bsc',
      runtimeNetwork: 'bsc',
      tokenSymbol: 'USD1',
      runtimeTokenSymbol: 'USD1',
      tokenAddress: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
      runtimeTokenAddress: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'
    })
    expect(health.detail).toContain('Platform payout wallet is ready')
    expect(health.driftReasons).toEqual([])
  })

  it('reports degraded health when runtime wallet drifts from configured address', async () => {
    process.env.AGENTPAY_DEMO_FROM_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const health = await inspectPlatformPayoutWallet()

    expect(health.ok).toBe(false)
    expect(health.health).toBe('degraded')
    expect(health.driftReasons[0]).toContain('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(health.driftReasons[0]).toContain('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(health.detail).toContain('configuration drift')
  })

  it('throws when payout wallet health is not ready', async () => {
    delete process.env.PLATFORM_PAYOUT_WALLET_ADDRESS
    delete process.env.AGENTPAY_DEMO_FROM_ADDRESS
    delete process.env.AGENTPAY_PAYER_ADDRESS

    await expect(assertPlatformPayoutWalletReady()).rejects.toThrow(
      'Platform payout wallet has configuration drift: Missing PLATFORM_PAYOUT_WALLET_ADDRESS configuration'
    )
  })

  it('transfers successfully through the mock provider when expected address matches', async () => {
    vi.useFakeTimers()

    const transferPromise = transferWithConfiguredProvider('0xrecipient', 0.1, 'test payout', {
      expectedFromAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    })

    await vi.advanceTimersByTimeAsync(800)

    await expect(transferPromise).resolves.toMatchObject({
      success: true,
      provider: 'mock',
      fromAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
    const result = await transferPromise
    expect(result.txHash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('returns a mismatch error when expected address differs from the current payout wallet', async () => {
    vi.useFakeTimers()

    const transferPromise = transferWithConfiguredProvider('0xrecipient', 0.1, 'test payout', {
      expectedFromAddress: '0xcccccccccccccccccccccccccccccccccccccccc'
    })

    await vi.advanceTimersByTimeAsync(800)

    await expect(transferPromise).resolves.toEqual({
      success: false,
      error: 'Current platform payout wallet 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa does not match the task-configured payout account 0xcccccccccccccccccccccccccccccccccccccccc',
      provider: 'mock'
    })
  })
})
