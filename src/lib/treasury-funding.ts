import { Interface, JsonRpcProvider, formatUnits, getAddress, id, parseUnits, zeroPadValue } from 'ethers'

const ERC20_TRANSFER_IFACE = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)'
])

export interface TreasuryFundingConfig {
  enabled: boolean
  treasuryAddress?: string
  rpcUrl?: string
  network: string
  tokenAddress?: string
  tokenSymbol: string
  tokenDecimals: number
}

export interface TreasuryFundingVerificationResult {
  ok: boolean
  txHash?: string
  network?: string
  treasuryAddress?: string
  tokenAddress?: string
  tokenSymbol?: string
  fromAddress?: string
  amountRaw?: string
  amountFormatted?: string
  verifiedAt?: string
  error?: string
}

function normalizeAddress(value?: string) {
  if (!value) return undefined
  try {
    return getAddress(value)
  } catch {
    return undefined
  }
}

function resolveStaticNetwork(network?: string) {
  const normalized = String(network || '').trim().toLowerCase()
  if (normalized === 'bsc' || normalized === 'binance-smart-chain') {
    return { name: 'bsc', chainId: 56 }
  }
  if (normalized === 'bsc_testnet') {
    return { name: 'bsc_testnet', chainId: 97 }
  }
  if (normalized === 'base') {
    return { name: 'base', chainId: 8453 }
  }
  if (normalized === 'base_sepolia') {
    return { name: 'base_sepolia', chainId: 84532 }
  }
  if (normalized === 'ethereum' || normalized === 'mainnet') {
    return { name: 'mainnet', chainId: 1 }
  }
  return undefined
}

export function getTreasuryFundingConfig(): TreasuryFundingConfig {
  const treasuryAddress = process.env.PLATFORM_BOUNTY_TREASURY_ADDRESS?.trim()
  const rpcUrl = process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL?.trim() || process.env.BOUNTY_ESCROW_RPC_URL?.trim()
  const tokenAddress = process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS?.trim()
    || process.env.BOUNTY_ESCROW_TOKEN_ADDRESS?.trim()
    || process.env.AGENTPAY_TOKEN_ADDRESS?.trim()
    || process.env.WLFI_TOKEN_ADDRESS?.trim()

  return {
    enabled: Boolean(treasuryAddress && rpcUrl && tokenAddress),
    treasuryAddress,
    rpcUrl,
    network: process.env.PLATFORM_BOUNTY_TREASURY_NETWORK?.trim()
      || process.env.BOUNTY_ESCROW_CHAIN_NAME?.trim()
      || process.env.AGENTPAY_NETWORK?.trim()
      || 'bsc',
    tokenAddress,
    tokenSymbol: process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_SYMBOL?.trim().toUpperCase()
      || process.env.AGENTPAY_TOKEN_SYMBOL?.trim().toUpperCase()
      || process.env.WLFI_TOKEN_SYMBOL?.trim().toUpperCase()
      || 'USD1',
    tokenDecimals: Number(
      process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_DECIMALS
      || process.env.BOUNTY_ESCROW_TOKEN_DECIMALS
      || '18'
    )
  }
}

export async function verifyTreasuryFundingTransaction(input: {
  txHash: string
  expectedFromAddress?: string
  expectedAmount: number
  expectedTokenSymbol?: string
}) {
  const config = getTreasuryFundingConfig()
  if (!config.enabled || !config.rpcUrl || !config.treasuryAddress || !config.tokenAddress) {
    return {
      ok: false,
      error: 'Platform deposit address is not configured. Cannot verify funding transaction.'
    } satisfies TreasuryFundingVerificationResult
  }

  const txHash = String(input.txHash || '').trim()
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return {
      ok: false,
      error: 'Funding transaction hash format is invalid'
    } satisfies TreasuryFundingVerificationResult
  }

  try {
    const staticNetwork = resolveStaticNetwork(config.network)
    const provider = staticNetwork
      ? new JsonRpcProvider(config.rpcUrl, staticNetwork, { staticNetwork: true })
      : new JsonRpcProvider(config.rpcUrl)
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) {
      return { ok: false, error: 'Transaction not yet found on-chain. Please try again later.' } satisfies TreasuryFundingVerificationResult
    }
    if (receipt.status !== 1) {
      return { ok: false, error: 'On-chain transaction execution failed and cannot be used as a valid funding proof.' } satisfies TreasuryFundingVerificationResult
    }

    const expectedTo = normalizeAddress(config.treasuryAddress)
    const expectedFrom = normalizeAddress(input.expectedFromAddress)
    const expectedToken = normalizeAddress(config.tokenAddress)
    const expectedAmountRaw = parseUnits(String(input.expectedAmount), config.tokenDecimals)
    const transferTopic = id('Transfer(address,address,uint256)')
    const paddedTreasury = expectedTo ? zeroPadValue(expectedTo, 32).toLowerCase() : undefined

    const matchingLog = receipt.logs.find((log) => {
      if (!expectedToken || log.address.toLowerCase() !== expectedToken.toLowerCase()) return false
      if (log.topics[0] !== transferTopic) return false
      if (!paddedTreasury || log.topics[2]?.toLowerCase() !== paddedTreasury) return false
      return true
    })

    if (!matchingLog) {
      return {
        ok: false,
        error: `No ${config.tokenSymbol} transfer to platform address ${config.treasuryAddress} was found`
      } satisfies TreasuryFundingVerificationResult
    }

    const parsed = ERC20_TRANSFER_IFACE.parseLog({
      topics: matchingLog.topics,
      data: matchingLog.data
    })
    if (!parsed) {
      return {
        ok: false,
        error: 'Unable to parse ERC20 Transfer log from funding transaction'
      } satisfies TreasuryFundingVerificationResult
    }
    const fromAddress = normalizeAddress(String(parsed.args.from))
    const amountRaw = parsed.args.value.toString()

    if (expectedFrom && fromAddress?.toLowerCase() !== expectedFrom.toLowerCase()) {
      return {
        ok: false,
        error: `Funding sender does not match company wallet (expected ${input.expectedFromAddress}, actual ${fromAddress})`
      } satisfies TreasuryFundingVerificationResult
    }

    if (BigInt(amountRaw) < expectedAmountRaw) {
      return {
        ok: false,
        error: `Funding amount insufficient (expected ${input.expectedAmount} ${config.tokenSymbol}, actual ${formatUnits(amountRaw, config.tokenDecimals)} ${config.tokenSymbol})`
      } satisfies TreasuryFundingVerificationResult
    }

    return {
      ok: true,
      txHash,
      network: config.network,
      treasuryAddress: expectedTo,
      tokenAddress: expectedToken,
      tokenSymbol: input.expectedTokenSymbol || config.tokenSymbol,
      fromAddress,
      amountRaw,
      amountFormatted: formatUnits(amountRaw, config.tokenDecimals),
      verifiedAt: new Date().toISOString()
    } satisfies TreasuryFundingVerificationResult
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const compact = String(message || '')
    const friendly = /timeout|TIMEOUT|failed to detect network|network and cannot start up/i.test(compact)
      ? `Platform funding verification failed: RPC node is temporarily unavailable or timed out (${config.network.toUpperCase()}). Please try again later or update PLATFORM_BOUNTY_TREASURY_RPC_URL.`
      : compact
    return {
      ok: false,
      error: friendly
    } satisfies TreasuryFundingVerificationResult
  }
}
