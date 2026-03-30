import { JsonRpcProvider } from 'ethers'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { getTreasuryFundingConfig, verifyTreasuryFundingTransaction } from '@/lib/treasury-funding'

// ---------------------------------------------------------------------------
// getTreasuryFundingConfig — pure env-var-driven function
// ---------------------------------------------------------------------------

describe('getTreasuryFundingConfig — shape', () => {
  it('returns required fields with correct types', () => {
    const config = getTreasuryFundingConfig()
    expect(typeof config.enabled).toBe('boolean')
    expect(typeof config.network).toBe('string')
    expect(typeof config.tokenSymbol).toBe('string')
    expect(typeof config.tokenDecimals).toBe('number')
  })

  it('tokenSymbol is uppercased', () => {
    const config = getTreasuryFundingConfig()
    expect(config.tokenSymbol).toBe(config.tokenSymbol.toUpperCase())
  })

  it('defaults to tokenDecimals = 18 when no env var set', () => {
    const saved = process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_DECIMALS
    delete process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_DECIMALS
    delete process.env.BOUNTY_ESCROW_TOKEN_DECIMALS
    const config = getTreasuryFundingConfig()
    expect(config.tokenDecimals).toBe(18)
    if (saved !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_DECIMALS = saved
  })

  it('defaults to tokenSymbol USD1 when no env var is set', () => {
    const overrides = [
      'PLATFORM_BOUNTY_TREASURY_TOKEN_SYMBOL',
      'AGENTPAY_TOKEN_SYMBOL',
      'WLFI_TOKEN_SYMBOL'
    ]
    const savedVals: Record<string, string | undefined> = {}
    for (const k of overrides) { savedVals[k] = process.env[k]; delete process.env[k] }
    expect(getTreasuryFundingConfig().tokenSymbol).toBe('USD1')
    for (const k of overrides) {
      if (savedVals[k] !== undefined) process.env[k] = savedVals[k]
    }
  })

  it('defaults to network bsc when no network env var set', () => {
    const overrides = ['PLATFORM_BOUNTY_TREASURY_NETWORK', 'BOUNTY_ESCROW_CHAIN_NAME', 'AGENTPAY_NETWORK']
    const savedVals: Record<string, string | undefined> = {}
    for (const k of overrides) { savedVals[k] = process.env[k]; delete process.env[k] }
    expect(getTreasuryFundingConfig().network).toBe('bsc')
    for (const k of overrides) {
      if (savedVals[k] !== undefined) process.env[k] = savedVals[k]
    }
  })

  it('enabled is false when any of treasuryAddress / rpcUrl / tokenAddress is missing', () => {
    // In the test environment these are almost certainly unset
    const requiredKeys = [
      'PLATFORM_BOUNTY_TREASURY_ADDRESS',
      'PLATFORM_BOUNTY_TREASURY_RPC_URL',
      'BOUNTY_ESCROW_RPC_URL',
      'PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS',
      'BOUNTY_ESCROW_TOKEN_ADDRESS',
      'AGENTPAY_TOKEN_ADDRESS',
      'WLFI_TOKEN_ADDRESS'
    ]
    const savedVals: Record<string, string | undefined> = {}
    for (const k of requiredKeys) { savedVals[k] = process.env[k]; delete process.env[k] }
    expect(getTreasuryFundingConfig().enabled).toBe(false)
    for (const k of requiredKeys) {
      if (savedVals[k] !== undefined) process.env[k] = savedVals[k]
    }
  })

  it('enabled is true when treasuryAddress, rpcUrl and tokenAddress are all set', () => {
    const savedAddress = process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS
    const savedRpc = process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL
    const savedToken = process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS

    process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS = '0x' + 'a'.repeat(40)
    process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL = 'https://rpc.example.com'
    process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS = '0x' + 'b'.repeat(40)

    expect(getTreasuryFundingConfig().enabled).toBe(true)

    if (savedAddress !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS = savedAddress
    else delete process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS
    if (savedRpc !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL = savedRpc
    else delete process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL
    if (savedToken !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS = savedToken
    else delete process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS
  })
})

describe('getTreasuryFundingConfig — network env var resolution', () => {
  afterEach(() => {
    delete process.env.PLATFORM_BOUNTY_TREASURY_NETWORK
    delete process.env.BOUNTY_ESCROW_CHAIN_NAME
    delete process.env.AGENTPAY_NETWORK
  })

  it('uses PLATFORM_BOUNTY_TREASURY_NETWORK when set', () => {
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'base'
    expect(getTreasuryFundingConfig().network).toBe('base')
  })

  it('falls back to BOUNTY_ESCROW_CHAIN_NAME', () => {
    delete process.env.PLATFORM_BOUNTY_TREASURY_NETWORK
    process.env.BOUNTY_ESCROW_CHAIN_NAME = 'bsc_testnet'
    expect(getTreasuryFundingConfig().network).toBe('bsc_testnet')
  })

  it('falls back to AGENTPAY_NETWORK', () => {
    delete process.env.PLATFORM_BOUNTY_TREASURY_NETWORK
    delete process.env.BOUNTY_ESCROW_CHAIN_NAME
    process.env.AGENTPAY_NETWORK = 'ethereum'
    expect(getTreasuryFundingConfig().network).toBe('ethereum')
  })
})

// ---------------------------------------------------------------------------
// verifyTreasuryFundingTransaction — tx hash format validation
// (Only the pre-network checks are tested here — no real RPC calls)
// ---------------------------------------------------------------------------

describe('verifyTreasuryFundingTransaction — tx hash format', () => {
  it('returns error for an empty tx hash', async () => {
    const result = await verifyTreasuryFundingTransaction({
      txHash: '',
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
    // Could be "not configured" or "invalid format" depending on env
    expect(result.error).toBeTruthy()
  })

  it('returns error for a tx hash that is too short', async () => {
    const result = await verifyTreasuryFundingTransaction({
      txHash: '0xabc',
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
  })

  it('returns error for a tx hash without 0x prefix', async () => {
    const result = await verifyTreasuryFundingTransaction({
      txHash: 'a'.repeat(64),
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
  })

  it('returns error for a tx hash with non-hex characters', async () => {
    const result = await verifyTreasuryFundingTransaction({
      txHash: '0x' + 'g'.repeat(64),
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
  })

  it('returns error for a tx hash that is too long (65 hex chars)', async () => {
    const result = await verifyTreasuryFundingTransaction({
      txHash: '0x' + 'a'.repeat(65),
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
  })

  it('returns error for a tx hash with uppercase 0X prefix', async () => {
    const result = await verifyTreasuryFundingTransaction({
      txHash: '0X' + 'a'.repeat(64),
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
  })

  it('rejects when config is not enabled (no treasury env vars set)', async () => {
    // Clear treasury env vars so config.enabled = false
    const keysToUnset = [
      'PLATFORM_BOUNTY_TREASURY_ADDRESS',
      'PLATFORM_BOUNTY_TREASURY_RPC_URL',
      'BOUNTY_ESCROW_RPC_URL',
      'PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS',
      'BOUNTY_ESCROW_TOKEN_ADDRESS',
      'AGENTPAY_TOKEN_ADDRESS',
      'WLFI_TOKEN_ADDRESS'
    ]
    const saved: Record<string, string | undefined> = {}
    for (const k of keysToUnset) { saved[k] = process.env[k]; delete process.env[k] }

    const validTxHash = '0x' + 'a'.repeat(64)
    const result = await verifyTreasuryFundingTransaction({
      txHash: validTxHash,
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not configured/i)

    for (const k of keysToUnset) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
    }
  })

  it('returns ok: false immediately for invalid format even when config would be enabled', async () => {
    // Set up valid config
    const savedAddress = process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS
    const savedRpc = process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL
    const savedToken = process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS
    process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS = '0x' + 'a'.repeat(40)
    process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL = 'https://rpc.example.com'
    process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS = '0x' + 'b'.repeat(40)

    const result = await verifyTreasuryFundingTransaction({
      txHash: 'not-a-valid-hash',
      expectedAmount: 100
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)

    if (savedAddress !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS = savedAddress
    else delete process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS
    if (savedRpc !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL = savedRpc
    else delete process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL
    if (savedToken !== undefined) process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS = savedToken
    else delete process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS
  })

  it('a correctly formatted 64-hex-char 0x-prefixed hash passes format check', async () => {
    // When config is not enabled it short-circuits with "not configured" — that
    // still returns ok: false but confirms the format check was passed (no format error).
    const keysToUnset = [
      'PLATFORM_BOUNTY_TREASURY_ADDRESS',
      'PLATFORM_BOUNTY_TREASURY_RPC_URL',
      'BOUNTY_ESCROW_RPC_URL',
      'PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS',
      'BOUNTY_ESCROW_TOKEN_ADDRESS',
      'AGENTPAY_TOKEN_ADDRESS',
      'WLFI_TOKEN_ADDRESS'
    ]
    const saved: Record<string, string | undefined> = {}
    for (const k of keysToUnset) { saved[k] = process.env[k]; delete process.env[k] }

    const validTxHash = '0x' + 'a'.repeat(64)
    const result = await verifyTreasuryFundingTransaction({
      txHash: validTxHash,
      expectedAmount: 100
    })
    // Should fail due to config not enabled — not due to format
    expect(result.ok).toBe(false)
    expect(result.error).not.toMatch(/format/i)

    for (const k of keysToUnset) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
    }
  })
})

describe('verifyTreasuryFundingTransaction — provider failures', () => {
  const validTxHash = '0x' + 'a'.repeat(64)
  const keys = [
    'PLATFORM_BOUNTY_TREASURY_ADDRESS',
    'PLATFORM_BOUNTY_TREASURY_RPC_URL',
    'PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS',
    'PLATFORM_BOUNTY_TREASURY_NETWORK'
  ] as const
  const saved: Record<string, string | undefined> = {}

  afterEach(() => {
    vi.restoreAllMocks()
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('returns a retryable error when the transaction receipt is not yet found', async () => {
    for (const key of keys) saved[key] = process.env[key]
    process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS = '0x' + '1'.repeat(40)
    process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL = 'https://rpc.example.com'
    process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS = '0x' + '2'.repeat(40)
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'bsc'

    vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValueOnce(null as never)

    await expect(verifyTreasuryFundingTransaction({
      txHash: validTxHash,
      expectedAmount: 1
    })).resolves.toMatchObject({
      ok: false,
      error: 'Transaction not yet found on-chain. Please try again later.'
    })
  })

  it('returns a friendly timeout error when rpc access fails', async () => {
    for (const key of keys) saved[key] = process.env[key]
    process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS = '0x' + '1'.repeat(40)
    process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL = 'https://rpc.example.com'
    process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS = '0x' + '2'.repeat(40)
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'bsc'

    vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockRejectedValueOnce(new Error('timeout while waiting for rpc'))

    const result = await verifyTreasuryFundingTransaction({
      txHash: validTxHash,
      expectedAmount: 1
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('RPC node is temporarily unavailable or timed out (BSC)')
  })
})

// ---------------------------------------------------------------------------
// resolveStaticNetwork — tested indirectly via getTreasuryFundingConfig
// (the network value is stored in the config and the provider uses it)
// ---------------------------------------------------------------------------

describe('treasury network name resolution', () => {
  afterEach(() => {
    delete process.env.PLATFORM_BOUNTY_TREASURY_NETWORK
  })

  it('bsc network is preserved as-is', () => {
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'bsc'
    expect(getTreasuryFundingConfig().network).toBe('bsc')
  })

  it('base network is preserved as-is', () => {
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'base'
    expect(getTreasuryFundingConfig().network).toBe('base')
  })

  it('base_sepolia is preserved as-is', () => {
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'base_sepolia'
    expect(getTreasuryFundingConfig().network).toBe('base_sepolia')
  })

  it('ethereum is preserved as-is', () => {
    process.env.PLATFORM_BOUNTY_TREASURY_NETWORK = 'ethereum'
    expect(getTreasuryFundingConfig().network).toBe('ethereum')
  })
})
