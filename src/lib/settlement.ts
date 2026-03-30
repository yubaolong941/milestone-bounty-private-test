import { execSync } from 'child_process'
import { Contract, JsonRpcProvider, Wallet, parseUnits } from 'ethers'
import { getTreasuryFundingConfig } from '@/lib/treasury-funding'

export interface SettlementTransferResult {
  success: boolean
  txHash?: string
  fromAddress?: string
  provider: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key'
  error?: string
}

interface WalletInfo {
  address?: string
  providerKey?: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key'
  network?: string
  tokenSymbol?: string
  tokenAddress?: string
}

export interface PlatformPayoutWalletConfig {
  enabled: boolean
  provider: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key'
  walletAddress?: string
  network: string
  tokenSymbol: string
  tokenAddress?: string
}

export interface PlatformPayoutWalletHealth {
  ok: boolean
  health: 'ok' | 'degraded' | 'missing'
  provider: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key'
  configuredAddress?: string
  currentAddress?: string
  network: string
  runtimeNetwork?: string
  tokenSymbol: string
  runtimeTokenSymbol?: string
  tokenAddress?: string
  runtimeTokenAddress?: string
  detail: string
  driftReasons: string[]
}

export interface SettlementProvider {
  key: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key'
  getCurrentWalletInfo(): Promise<WalletInfo>
  transfer(params: {
    toAddress: string
    amount: number
    memo: string
    tokenSymbol?: string
    expectedFromAddress?: string
  }): Promise<SettlementTransferResult>
}

function safeJsonParse(raw: string): Record<string, any> | undefined {
  try {
    return JSON.parse(raw) as Record<string, any>
  } catch {
    return undefined
  }
}

function parseWalletAddress(raw: string): string | undefined {
  const parsed = safeJsonParse(raw)
  if (!parsed) return undefined
  if (typeof parsed.address === 'string') return parsed.address
  if (typeof parsed.wallet?.address === 'string') return parsed.wallet.address
  if (typeof parsed.walletAddress === 'string') return parsed.walletAddress
  if (typeof parsed.currentWallet?.address === 'string') return parsed.currentWallet.address
  return undefined
}

function parseTxHash(raw: string): string | undefined {
  const parsed = safeJsonParse(raw)
  if (!parsed) return undefined
  return parsed.txHash || parsed.tx_hash || parsed.hash || parsed.receipt?.transactionHash || parsed.receipt?.hash
}

function runJsonCommand(command: string, timeout = 60000): string {
  return execSync(command, { timeout, encoding: 'utf-8' })
}

function validateExpectedFromAddress(expectedFromAddress: string | undefined, actualAddress: string | undefined) {
  if (!expectedFromAddress) return { ok: true as const }
  if (!actualAddress) {
    return { ok: false as const, error: 'Unable to identify the current platform payout wallet address. Please complete platform wallet setup first.' }
  }
  if (actualAddress.toLowerCase() !== expectedFromAddress.toLowerCase()) {
    return {
      ok: false as const,
      error: `Current platform payout wallet ${actualAddress} does not match the task-configured payout account ${expectedFromAddress}`
    }
  }
  return { ok: true as const }
}

function normalizeAddress(value?: string) {
  return value?.trim().toLowerCase()
}

function getSelectedPayoutProvider() {
  if (process.env.AGENTPAY_DEMO_MODE === 'true' || process.env.WLFI_DEMO_MODE === 'true') {
    return 'mock' as const
  }

  const provider = (process.env.PLATFORM_PAYOUT_PROVIDER || process.env.PAYOUT_PROVIDER || 'agentpay').toLowerCase()
  if (provider === 'evm_private_key') return 'evm_private_key' as const
  if (provider === 'wlfi') return 'wlfi' as const
  if (provider === 'mock') return 'mock' as const
  return 'agentpay' as const
}

function getRuntimeProviderConfig(provider: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key') {
  if (provider === 'evm_private_key') {
    return {
      network: process.env.PLATFORM_PAYOUT_NETWORK || process.env.AGENTPAY_NETWORK || process.env.WLFI_NETWORK || 'bsc',
      tokenSymbol: process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL || process.env.AGENTPAY_TOKEN_SYMBOL || process.env.WLFI_TOKEN_SYMBOL || 'USD1',
      tokenAddress: process.env.PLATFORM_PAYOUT_TOKEN_ADDRESS || process.env.AGENTPAY_TOKEN_ADDRESS || process.env.WLFI_TOKEN_ADDRESS || undefined,
      walletAddress: process.env.PLATFORM_PAYOUT_WALLET_ADDRESS || undefined
    }
  }
  if (provider === 'wlfi') {
    return {
      network: process.env.WLFI_NETWORK || 'base',
      tokenSymbol: process.env.WLFI_TOKEN_SYMBOL || process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_SYMBOL || 'USD1',
      tokenAddress: process.env.WLFI_TOKEN_ADDRESS || process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS || undefined,
      walletAddress: process.env.WLFI_PAYER_ADDRESS || process.env.PLATFORM_PAYOUT_WALLET_ADDRESS || undefined
    }
  }
  if (provider === 'mock') {
    return {
      network: process.env.PLATFORM_PAYOUT_NETWORK || process.env.AGENTPAY_NETWORK || process.env.WLFI_NETWORK || 'base',
      tokenSymbol: process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL || process.env.AGENTPAY_TOKEN_SYMBOL || process.env.WLFI_TOKEN_SYMBOL || 'USD1',
      tokenAddress: process.env.PLATFORM_PAYOUT_TOKEN_ADDRESS || process.env.AGENTPAY_TOKEN_ADDRESS || process.env.WLFI_TOKEN_ADDRESS || undefined,
      walletAddress:
        process.env.AGENTPAY_DEMO_FROM_ADDRESS
        || process.env.WLFI_DEMO_FROM_ADDRESS
        || process.env.PLATFORM_PAYOUT_WALLET_ADDRESS
        || process.env.AGENTPAY_PAYER_ADDRESS
        || process.env.WLFI_PAYER_ADDRESS
        || undefined
    }
  }
  return {
    network: process.env.AGENTPAY_NETWORK || 'bsc',
    tokenSymbol: process.env.AGENTPAY_TOKEN_SYMBOL || process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_SYMBOL || 'USD1',
    tokenAddress: process.env.AGENTPAY_TOKEN_ADDRESS || process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_ADDRESS || undefined,
    walletAddress: process.env.AGENTPAY_PAYER_ADDRESS || process.env.PLATFORM_PAYOUT_WALLET_ADDRESS || undefined
  }
}

export function getPlatformPayoutWalletConfig(): PlatformPayoutWalletConfig {
  const treasuryConfig = getTreasuryFundingConfig()
  const provider = getSelectedPayoutProvider()
  const runtimeConfig = getRuntimeProviderConfig(provider)
  const walletAddress = process.env.PLATFORM_PAYOUT_WALLET_ADDRESS?.trim()
    || runtimeConfig.walletAddress?.trim()
    || treasuryConfig.treasuryAddress?.trim()

  return {
    enabled: Boolean(walletAddress && (process.env.PLATFORM_PAYOUT_NETWORK || runtimeConfig.network) && (process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL || runtimeConfig.tokenSymbol)),
    provider,
    walletAddress,
    network: process.env.PLATFORM_PAYOUT_NETWORK?.trim()
      || treasuryConfig.network
      || runtimeConfig.network
      || 'base',
    tokenSymbol: process.env.PLATFORM_PAYOUT_TOKEN_SYMBOL?.trim().toUpperCase()
      || treasuryConfig.tokenSymbol
      || runtimeConfig.tokenSymbol?.trim().toUpperCase()
      || 'USD1',
    tokenAddress: process.env.PLATFORM_PAYOUT_TOKEN_ADDRESS?.trim()
      || treasuryConfig.tokenAddress?.trim()
      || runtimeConfig.tokenAddress?.trim()
  }
}

function buildPayoutWalletHealthDetail(health: PlatformPayoutWalletHealth) {
  if (health.ok) {
    return `Platform payout wallet is ready: provider=${health.provider} address=${health.configuredAddress} network=${health.network} token=${health.tokenSymbol}`
  }
  if (health.driftReasons.length === 0) {
    return 'Platform payout wallet configuration is missing. Please provide provider / wallet / network / token.'
  }
  return `Platform payout wallet has configuration drift: ${health.driftReasons.join('; ')}`
}

function getEvmPayoutPrivateKey() {
  return process.env.PLATFORM_PAYOUT_PRIVATE_KEY?.trim()
    || process.env.EVM_PAYOUT_PRIVATE_KEY?.trim()
    || undefined
}

function getEvmPayoutRpcUrl() {
  return process.env.PLATFORM_PAYOUT_RPC_URL?.trim()
    || process.env.PLATFORM_BOUNTY_TREASURY_RPC_URL?.trim()
    || process.env.BOUNTY_ESCROW_RPC_URL?.trim()
    || undefined
}

function getEvmPayoutTokenDecimals() {
  return Number(
    process.env.PLATFORM_PAYOUT_TOKEN_DECIMALS
    || process.env.PLATFORM_BOUNTY_TREASURY_TOKEN_DECIMALS
    || process.env.BOUNTY_ESCROW_TOKEN_DECIMALS
    || '18'
  )
}

function buildMockProvider(): SettlementProvider {
  return {
    key: 'mock',
    async getCurrentWalletInfo() {
      const runtime = getRuntimeProviderConfig('mock')
      return {
        address:
          process.env.AGENTPAY_DEMO_FROM_ADDRESS
          || process.env.AGENTPAY_PAYER_ADDRESS
          || process.env.WLFI_DEMO_FROM_ADDRESS
          || process.env.WLFI_PAYER_ADDRESS,
        providerKey: 'mock',
        network: runtime.network,
        tokenSymbol: runtime.tokenSymbol,
        tokenAddress: runtime.tokenAddress
      }
    },
    async transfer(params) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      const fromAddress =
        process.env.AGENTPAY_DEMO_FROM_ADDRESS
        || process.env.AGENTPAY_PAYER_ADDRESS
        || process.env.WLFI_DEMO_FROM_ADDRESS
        || process.env.WLFI_PAYER_ADDRESS
        || params.expectedFromAddress
      const validated = validateExpectedFromAddress(params.expectedFromAddress, fromAddress)
      if (!validated.ok) return { success: false, error: validated.error, provider: 'mock' }
      const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      return { success: true, txHash, fromAddress, provider: 'mock' }
    }
  }
}

function buildWlfiProvider(): SettlementProvider {
  const wlfiBin = process.env.WLFI_HOME ? `${process.env.WLFI_HOME}/bin/wlfi-agent` : 'wlfi-agent'

  return {
    key: 'wlfi',
    async getCurrentWalletInfo() {
      try {
        const result = runJsonCommand(`${wlfiBin} wallet --json`, 30000)
        const runtime = getRuntimeProviderConfig('wlfi')
        return {
          address: parseWalletAddress(result),
          providerKey: 'wlfi',
          network: runtime.network,
          tokenSymbol: runtime.tokenSymbol,
          tokenAddress: runtime.tokenAddress
        }
      } catch {
        return {}
      }
    },
    async transfer(params) {
      try {
        const walletInfo = await this.getCurrentWalletInfo()
        const validated = validateExpectedFromAddress(params.expectedFromAddress, walletInfo.address)
        if (!validated.ok) return { success: false, error: validated.error, provider: 'wlfi' }

        const network = process.env.WLFI_NETWORK || 'base'
        const token = process.env.WLFI_TOKEN_ADDRESS || ''
        const cmd = token
          ? `${wlfiBin} transfer --network "${network}" --token "${token}" --to "${params.toAddress}" --amount "${params.amount}" --broadcast --json`
          : `${wlfiBin} transfer-native --network "${network}" --to "${params.toAddress}" --amount "${params.amount}" --broadcast --json`
        const result = runJsonCommand(cmd)
        return {
          success: true,
          txHash: parseTxHash(result),
          fromAddress: walletInfo.address,
          provider: 'wlfi'
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), provider: 'wlfi' }
      }
    }
  }
}

function buildEvmPrivateKeyProvider(): SettlementProvider {
  return {
    key: 'evm_private_key',
    async getCurrentWalletInfo() {
      const runtime = getRuntimeProviderConfig('evm_private_key')
      const privateKey = getEvmPayoutPrivateKey()
      if (!privateKey) {
        return {
          providerKey: 'evm_private_key',
          network: runtime.network,
          tokenSymbol: runtime.tokenSymbol,
          tokenAddress: runtime.tokenAddress
        }
      }
      try {
        const wallet = new Wallet(privateKey)
        return {
          address: wallet.address,
          providerKey: 'evm_private_key',
          network: runtime.network,
          tokenSymbol: runtime.tokenSymbol,
          tokenAddress: runtime.tokenAddress
        }
      } catch {
        return {
          providerKey: 'evm_private_key',
          network: runtime.network,
          tokenSymbol: runtime.tokenSymbol,
          tokenAddress: runtime.tokenAddress
        }
      }
    },
    async transfer(params) {
      try {
        const runtime = getRuntimeProviderConfig('evm_private_key')
        const privateKey = getEvmPayoutPrivateKey()
        if (!privateKey) {
          return { success: false, error: 'Missing PLATFORM_PAYOUT_PRIVATE_KEY configuration', provider: 'evm_private_key' }
        }
        const rpcUrl = getEvmPayoutRpcUrl()
        if (!rpcUrl) {
          return { success: false, error: 'Missing PLATFORM_PAYOUT_RPC_URL configuration', provider: 'evm_private_key' }
        }

        const provider = new JsonRpcProvider(rpcUrl)
        const signer = new Wallet(privateKey, provider)
        const validated = validateExpectedFromAddress(params.expectedFromAddress, signer.address)
        if (!validated.ok) return { success: false, error: validated.error, provider: 'evm_private_key' }

        if (runtime.tokenAddress) {
          const token = new Contract(
            runtime.tokenAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
          )
          const decimals = getEvmPayoutTokenDecimals()
          const tx = await token.transfer(params.toAddress, parseUnits(String(params.amount), decimals))
          return {
            success: true,
            txHash: tx.hash,
            fromAddress: signer.address,
            provider: 'evm_private_key'
          }
        }

        const tx = await signer.sendTransaction({
          to: params.toAddress,
          value: parseUnits(String(params.amount), 18)
        })
        return {
          success: true,
          txHash: tx.hash,
          fromAddress: signer.address,
          provider: 'evm_private_key'
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), provider: 'evm_private_key' }
      }
    }
  }
}

function buildAgentPayProvider(): SettlementProvider {
  const agentpayBin = process.env.AGENTPAY_BIN || 'agentpay'

  return {
    key: 'agentpay',
    async getCurrentWalletInfo() {
      const runtime = getRuntimeProviderConfig('agentpay')
      const commands = [
        `${agentpayBin} wallet --json`,
        `${agentpayBin} status --json`,
        `${agentpayBin} config show --json`
      ]
      for (const cmd of commands) {
        try {
          const result = runJsonCommand(cmd, 30000)
          const address = parseWalletAddress(result)
          if (address) return {
            address,
            providerKey: 'agentpay',
            network: runtime.network,
            tokenSymbol: runtime.tokenSymbol,
            tokenAddress: runtime.tokenAddress
          }
        } catch {
          continue
        }
      }
      return {}
    },
    async transfer(params) {
      try {
        const walletInfo = await this.getCurrentWalletInfo()
        const validated = validateExpectedFromAddress(params.expectedFromAddress, walletInfo.address)
        if (!validated.ok) return { success: false, error: validated.error, provider: 'agentpay' }

        const network = process.env.AGENTPAY_NETWORK || 'bsc'
        const token = process.env.AGENTPAY_TOKEN_ADDRESS || process.env.WLFI_TOKEN_ADDRESS || ''
        const cmd = token
          ? `${agentpayBin} transfer --network "${network}" --token "${token}" --to "${params.toAddress}" --amount "${params.amount}" --broadcast --json`
          : `${agentpayBin} transfer-native --network "${network}" --to "${params.toAddress}" --amount "${params.amount}" --broadcast --json`
        const result = runJsonCommand(cmd)
        return {
          success: true,
          txHash: parseTxHash(result),
          fromAddress: walletInfo.address,
          provider: 'agentpay'
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), provider: 'agentpay' }
      }
    }
  }
}

export function getSettlementProvider(): SettlementProvider {
  if (getSelectedPayoutProvider() === 'mock') {
    return buildMockProvider()
  }

  const provider = getSelectedPayoutProvider()
  if (provider === 'evm_private_key') return buildEvmPrivateKeyProvider()
  if (provider === 'wlfi') return buildWlfiProvider()
  return buildAgentPayProvider()
}

export async function getCurrentWalletInfo() {
  return getSettlementProvider().getCurrentWalletInfo()
}

export async function inspectPlatformPayoutWallet(): Promise<PlatformPayoutWalletHealth> {
  const config = getPlatformPayoutWalletConfig()
  const currentWallet = await getCurrentWalletInfo()
  const runtimeConfig = getRuntimeProviderConfig(config.provider)
  const driftReasons: string[] = []

  if (!config.walletAddress) driftReasons.push('Missing PLATFORM_PAYOUT_WALLET_ADDRESS configuration')
  if (!config.network) driftReasons.push('Missing PLATFORM_PAYOUT_NETWORK configuration')
  if (!config.tokenSymbol) driftReasons.push('Missing PLATFORM_PAYOUT_TOKEN_SYMBOL configuration')
  if (config.provider === 'evm_private_key' && !getEvmPayoutPrivateKey()) {
    driftReasons.push('Missing PLATFORM_PAYOUT_PRIVATE_KEY configuration')
  }

  if (config.walletAddress && currentWallet.address && normalizeAddress(currentWallet.address) !== normalizeAddress(config.walletAddress)) {
    driftReasons.push(`Current runtime wallet ${currentWallet.address || '-'} does not match platform payout wallet ${config.walletAddress || '-'}`)
  }
  if ((currentWallet.providerKey || config.provider) !== config.provider) {
    driftReasons.push(`Current provider ${currentWallet.providerKey || '-'} does not match configured provider ${config.provider}`)
  }
  if (config.network && (currentWallet.network || runtimeConfig.network) !== config.network) {
    driftReasons.push(`Current network ${currentWallet.network || runtimeConfig.network || '-'} does not match configured network ${config.network}`)
  }
  if (config.tokenSymbol && (currentWallet.tokenSymbol || runtimeConfig.tokenSymbol || '').toUpperCase() !== config.tokenSymbol.toUpperCase()) {
    driftReasons.push(`Current tokenSymbol ${(currentWallet.tokenSymbol || runtimeConfig.tokenSymbol || '-').toUpperCase()} does not match configured tokenSymbol ${config.tokenSymbol}`)
  }
  if (config.tokenAddress && normalizeAddress(currentWallet.tokenAddress || runtimeConfig.tokenAddress) !== normalizeAddress(config.tokenAddress)) {
    driftReasons.push(`Current tokenAddress ${currentWallet.tokenAddress || runtimeConfig.tokenAddress || '-'} does not match configured tokenAddress ${config.tokenAddress}`)
  }

  const health: PlatformPayoutWalletHealth = {
    ok: config.enabled && driftReasons.length === 0,
    health: !config.enabled ? 'missing' : driftReasons.length > 0 ? 'degraded' : 'ok',
    provider: config.provider,
    configuredAddress: config.walletAddress,
    currentAddress: currentWallet.address,
    network: config.network,
    runtimeNetwork: currentWallet.network || runtimeConfig.network,
    tokenSymbol: config.tokenSymbol,
    runtimeTokenSymbol: currentWallet.tokenSymbol || runtimeConfig.tokenSymbol,
    tokenAddress: config.tokenAddress,
    runtimeTokenAddress: currentWallet.tokenAddress || runtimeConfig.tokenAddress,
    detail: '',
    driftReasons
  }
  health.detail = buildPayoutWalletHealthDetail(health)
  return health
}

export async function assertPlatformPayoutWalletReady() {
  const health = await inspectPlatformPayoutWallet()
  if (!health.ok) {
    throw new Error(health.detail)
  }
  return health
}

export async function transferWithConfiguredProvider(
  toAddress: string,
  amount: number,
  memo: string,
  options?: {
    tokenSymbol?: string
    expectedFromAddress?: string
  }
) {
  await assertPlatformPayoutWalletReady()
  return getSettlementProvider().transfer({
    toAddress,
    amount,
    memo,
    tokenSymbol: options?.tokenSymbol,
    expectedFromAddress: options?.expectedFromAddress
  })
}

// Backward-compatible export for legacy callers.
export const transferWithWLFI = transferWithConfiguredProvider
