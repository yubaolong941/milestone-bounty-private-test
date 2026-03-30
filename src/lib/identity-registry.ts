import { randomBytes } from 'crypto'
import { verifyMessage } from 'ethers'
import { v4 as uuidv4 } from 'uuid'
import { SessionUser } from '@/lib/auth'
import { WalletActorRole, WalletIdentityBinding } from '@/lib/types'
import {
  findWalletIdentityBindingByGithubLoginDb,
  findWalletIdentityBindingByWalletAddressDb,
  listWalletIdentityBindingsDb,
  upsertWalletIdentityBindingDb
} from '@/lib/runtime-data-db'

export const WALLET_LOGIN_NONCE_COOKIE = 'bp_wallet_login_nonce'
export const WALLET_BIND_NONCE_COOKIE = 'bp_wallet_bind_nonce'

function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase()
}

export function isEvmWalletAddress(walletAddress: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(walletAddress.trim())
}

export function buildWalletChallengeMessage(input: {
  purpose: 'wallet_login' | 'bind_wallet'
  walletAddress: string
  userId?: string
}) {
  const nonce = randomBytes(16).toString('hex')
  const issuedAt = new Date().toISOString()
  const header = input.purpose === 'bind_wallet'
    ? 'BountyPay Wallet Binding'
    : 'BountyPay Wallet Login'
  const lines = [
    header,
    `Address: ${input.walletAddress}`
  ]
  if (input.userId) lines.push(`UserId: ${input.userId}`)
  lines.push(`Nonce: ${nonce}`, `IssuedAt: ${issuedAt}`)
  return {
    nonce,
    issuedAt,
    message: lines.join('\n')
  }
}

export function verifyWalletSignature(input: {
  walletAddress: string
  message: string
  signature: string
}) {
  const walletAddress = input.walletAddress.trim()
  if (!isEvmWalletAddress(walletAddress)) {
    return { ok: false as const, error: 'Wallet address format is invalid' }
  }

  try {
    const recovered = verifyMessage(input.message, input.signature)
    if (normalizeWalletAddress(recovered) !== normalizeWalletAddress(walletAddress)) {
      return { ok: false as const, error: 'Signature address does not match wallet address' }
    }
    return { ok: true as const, recovered }
  } catch {
    return { ok: false as const, error: 'Signature verification failed' }
  }
}

export async function upsertWalletIdentityBinding(input: {
  actorRole: WalletActorRole
  githubLogin?: string
  walletAddress: string
  externalUserId?: string
  authSource: WalletIdentityBinding['authSource']
}) {
  const now = new Date().toISOString()
  const normalizedGithubLogin = input.githubLogin?.trim().replace(/^@/, '').toLowerCase()
  const normalizedWallet = normalizeWalletAddress(input.walletAddress)
  const existing = (normalizedGithubLogin
    ? await findWalletIdentityBindingByGithubLoginDb(normalizedGithubLogin, input.actorRole)
    : null) || await findWalletIdentityBindingByWalletAddressDb(normalizedWallet, input.actorRole)

  const next: WalletIdentityBinding = existing || {
    id: uuidv4(),
    actorRole: input.actorRole,
    githubLogin: normalizedGithubLogin,
    walletAddress: input.walletAddress,
    externalUserId: input.externalUserId,
    authSource: input.authSource,
    status: 'active',
    verifiedAt: now,
    createdAt: now,
    updatedAt: now
  }

  next.actorRole = input.actorRole
  next.githubLogin = normalizedGithubLogin
  next.walletAddress = input.walletAddress
  next.externalUserId = input.externalUserId
  next.authSource = input.authSource
  next.status = 'active'
  next.verifiedAt = now
  next.updatedAt = now

  await upsertWalletIdentityBindingDb(next)
  return next
}

export async function findBindingByGithubLogin(githubLogin: string | undefined, actorRole: WalletActorRole = 'bounty_claimer') {
  return (await findWalletIdentityBindingByGithubLoginDb(githubLogin, actorRole)) || undefined
}

export async function findBindingByWalletAddress(walletAddress: string | undefined, actorRole?: WalletActorRole) {
  return (await findWalletIdentityBindingByWalletAddressDb(walletAddress, actorRole)) || undefined
}

export async function createGithubWalletBinding(session: SessionUser, walletAddress: string) {
  return upsertWalletIdentityBinding({
    actorRole: 'bounty_claimer',
    githubLogin: session.githubLogin,
    walletAddress,
    externalUserId: session.userId,
    authSource: 'github_oauth_wallet_signature'
  })
}

export async function getWalletBindingSummary() {
  const items = await listWalletIdentityBindingsDb()
  return {
    total: items.length,
    active: items.filter((item) => item.status === 'active').length
  }
}
