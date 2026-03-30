import {
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  formatUnits,
  getAddress,
  id,
  parseUnits
} from 'ethers'
import { BountyFundingLock, TaskBounty } from '@/lib/types'

const DEFAULT_ESCROW_ABI = [
  'function lockReward(bytes32 taskKey,address payer,address token,uint256 amount,address intendedRecipient) returns (bytes32 lockId)',
  'function releaseReward(bytes32 lockId,address recipient) returns (bool)',
  'function getRewardLock(bytes32 lockId) view returns (address payer,address token,uint256 amount,address recipient,bool released,bool cancelled)'
]

export interface EscrowConfig {
  enabled: boolean
  contractAddress?: string
  rpcUrl?: string
  tokenAddress?: string
  tokenDecimals: number
  chainName: string
  operatorPrivateKey?: string
  abi: string[]
}

export interface LockOnchainResult {
  success: boolean
  lockId?: string
  txHash?: string
  contractAddress?: string
  payerAddress?: string
  amountRaw?: string
  error?: string
}

export interface VerifyOnchainLockResult {
  ok: boolean
  payer?: string
  token?: string
  amountRaw?: string
  amountFormatted?: string
  recipient?: string
  released?: boolean
  cancelled?: boolean
  verifiedAt?: string
  error?: string
}

export interface ReleaseOnchainResult {
  success: boolean
  txHash?: string
  recipient?: string
  error?: string
}

function getEscrowAbi(): string[] {
  const raw = process.env.BOUNTY_ESCROW_ABI_JSON?.trim()
  if (!raw) return DEFAULT_ESCROW_ABI
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed as string[]
  } catch {
    return DEFAULT_ESCROW_ABI
  }
  return DEFAULT_ESCROW_ABI
}

export function getEscrowConfig(): EscrowConfig {
  const contractAddress = process.env.BOUNTY_ESCROW_CONTRACT_ADDRESS?.trim()
  const rpcUrl = process.env.BOUNTY_ESCROW_RPC_URL?.trim()
  const tokenAddress = process.env.BOUNTY_ESCROW_TOKEN_ADDRESS?.trim() || process.env.AGENTPAY_TOKEN_ADDRESS?.trim() || process.env.WLFI_TOKEN_ADDRESS?.trim()
  const operatorPrivateKey = process.env.BOUNTY_ESCROW_OPERATOR_PRIVATE_KEY?.trim()
  return {
    enabled: Boolean(contractAddress && rpcUrl && tokenAddress && operatorPrivateKey),
    contractAddress,
    rpcUrl,
    tokenAddress,
    tokenDecimals: Number(process.env.BOUNTY_ESCROW_TOKEN_DECIMALS || '18'),
    chainName: process.env.BOUNTY_ESCROW_CHAIN_NAME || process.env.AGENTPAY_NETWORK || 'bsc',
    operatorPrivateKey,
    abi: getEscrowAbi()
  }
}

function getEscrowContract() {
  const config = getEscrowConfig()
  if (!config.enabled || !config.contractAddress || !config.rpcUrl || !config.operatorPrivateKey) {
    throw new Error('Escrow contract is not fully configured')
  }
  const provider = new JsonRpcProvider(config.rpcUrl)
  const signer = new Wallet(config.operatorPrivateKey, provider)
  const contract = new Contract(config.contractAddress, config.abi, signer)
  return { config, provider, signer, contract }
}

function normalizeAddress(value: string | undefined) {
  if (!value) return undefined
  try {
    return getAddress(value)
  } catch {
    return undefined
  }
}

export function buildTaskEscrowKey(task: TaskBounty) {
  return id(`task-bounty:${task.id}`)
}

export async function lockRewardOnChain(input: {
  task: TaskBounty
  rewardAmount: number
  rewardToken: string
  payerWalletAddress?: string
  recipientAddress?: string
}) {
  try {
    const { config, signer, contract } = getEscrowContract()
    const payerAddress = normalizeAddress(input.payerWalletAddress) || signer.address
    if (normalizeAddress(input.payerWalletAddress) && normalizeAddress(input.payerWalletAddress) !== signer.address) {
      return {
        success: false,
        error: `Escrow operator ${signer.address} does not match company payout wallet ${input.payerWalletAddress}`
      } satisfies LockOnchainResult
    }

    const taskKey = buildTaskEscrowKey(input.task)
    const amountRaw = parseUnits(String(input.rewardAmount), config.tokenDecimals)
    const recipient = normalizeAddress(input.recipientAddress) || ZeroAddress
    const tx = await contract.lockReward(taskKey, payerAddress, config.tokenAddress, amountRaw, recipient)
    const receipt = await tx.wait()

    let lockId = taskKey
    try {
      const result = await contract.getFunction('lockReward').staticCall(taskKey, payerAddress, config.tokenAddress, amountRaw, recipient)
      if (typeof result === 'string') lockId = result
    } catch {
      lockId = taskKey
    }

    return {
      success: true,
      lockId,
      txHash: receipt?.hash || tx.hash,
      contractAddress: config.contractAddress,
      payerAddress,
      amountRaw: amountRaw.toString()
    } satisfies LockOnchainResult
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies LockOnchainResult
  }
}

export async function verifyRewardLockOnChain(lock: BountyFundingLock) {
  try {
    const { config, contract } = getEscrowContract()
    const lockId = lock.onchainLockId || lock.id
    const result = await contract.getRewardLock(lockId)
    const payer = normalizeAddress(result[0])
    const token = normalizeAddress(result[1])
    const amountRaw = result[2]?.toString?.() || '0'
    const recipient = normalizeAddress(result[3])
    const released = Boolean(result[4])
    const cancelled = Boolean(result[5])
    const verifiedAt = new Date().toISOString()

    if (token && config.tokenAddress && token.toLowerCase() !== config.tokenAddress.toLowerCase()) {
      return { ok: false, error: `Escrow token mismatch (expected ${config.tokenAddress}, actual ${token})` } satisfies VerifyOnchainLockResult
    }

    return {
      ok: true,
      payer,
      token,
      amountRaw,
      amountFormatted: formatUnits(amountRaw, config.tokenDecimals),
      recipient,
      released,
      cancelled,
      verifiedAt
    } satisfies VerifyOnchainLockResult
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies VerifyOnchainLockResult
  }
}

export async function releaseRewardOnChain(input: {
  lockId: string
  recipientAddress: string
}) {
  try {
    const { contract } = getEscrowContract()
    const recipient = normalizeAddress(input.recipientAddress)
    if (!recipient) {
      return { success: false, error: 'recipientAddress is invalid' } satisfies ReleaseOnchainResult
    }
    const tx = await contract.releaseReward(input.lockId, recipient)
    const receipt = await tx.wait()
    return {
      success: true,
      txHash: receipt?.hash || tx.hash,
      recipient
    } satisfies ReleaseOnchainResult
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies ReleaseOnchainResult
  }
}
