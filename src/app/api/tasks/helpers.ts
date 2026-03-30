import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  getActorRoleLabel,
  getCompanyContext,
  hasCompanyCapability,
  isPlatformAdmin,
  SessionUser
} from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import {
  extractWalletFromLabels
} from '@/lib/claims'
import {
  buildRequirementBindingSnapshot,
  buildRequirementSummaryCandidate,
  extractAcceptanceCriteriaCandidate
} from '@/lib/repositories/requirement-binding-repository'
import {
  deactivateOtherCompanyWallets,
  insertAuditLog,
  insertCompanyWallet,
  listCompanyWallets,
  updateCompanyFields,
  updateCompanyWallet
} from '@/lib/access-control-db'
import { getSettlementCaseByTaskId } from '@/lib/repositories/settlement-case-repository'
import { transitionTaskStatus } from '@/lib/operations'

export type CompanyContext = Awaited<ReturnType<typeof getCompanyContext>>

export async function resolveCompanyPayout(body: Record<string, unknown>, companyId?: string) {
  const companyWallets = (await listCompanyWallets(companyId)).filter((item) => item.active)
  const explicitId = body.companyWalletId ? String(body.companyWalletId) : ''
  const explicitName = body.companyName ? String(body.companyName).trim() : ''
  const explicitAddress = body.payerWalletAddress ? String(body.payerWalletAddress).trim() : ''

  const matched = explicitId
    ? companyWallets.find((item) => item.id === explicitId)
    : explicitName
      ? companyWallets.find((item) => item.companyName === explicitName)
      : explicitAddress
        ? companyWallets.find((item) => item.walletAddress.toLowerCase() === explicitAddress.toLowerCase())
        : undefined

  return matched
    || companyWallets.find((item) => item.id === process.env.DEFAULT_COMPANY_WALLET_ID)
    || companyWallets[0]
}

export async function ensureCompanyWalletFromFunding(input: {
  session: SessionUser
  companyId: string
  companyName: string
  fundingAddress?: string
  network: string
  tokenSymbol: string
  tokenAddress?: string
}) {
  const normalizedFundingAddress = input.fundingAddress?.trim().toLowerCase()
  if (!normalizedFundingAddress) return undefined
  const fundingAddress = input.fundingAddress!.trim()

  const existingWallets = await listCompanyWallets(input.companyId)
  const matched = existingWallets.find((item) => item.walletAddress.toLowerCase() === normalizedFundingAddress)
  const now = new Date().toISOString()

  if (matched) {
    const updated = await updateCompanyWallet(matched.id, {
      companyId: input.companyId,
      companyName: input.companyName,
      walletAddress: fundingAddress,
      network: input.network,
      tokenSymbol: input.tokenSymbol,
      tokenAddress: input.tokenAddress,
      active: true,
      verificationMethod: matched.verificationMethod || 'manual',
      verifiedByUserId: input.session.userId,
      verifiedByGithubLogin: input.session.githubLogin,
      verifiedAt: now,
      lastUsedAt: now
    })
    await deactivateOtherCompanyWallets(input.companyId, matched.id)
    await updateCompanyFields(input.companyId, { activeWalletId: matched.id })
    await insertAuditLog({
      companyId: input.companyId,
      actorUserId: input.session.userId,
      actorRole: getActorRoleLabel({ session: input.session }),
      action: 'company_wallet.auto_activate_from_funding',
      targetType: 'company_wallet',
      targetId: matched.id,
      summary: `Auto-activated company wallet ${input.fundingAddress} from platform funding`,
      metadata: {
        walletAddress: fundingAddress,
        network: input.network,
        tokenSymbol: input.tokenSymbol
      },
      createdAt: now
    })
    return updated || matched
  }

  const inserted = await insertCompanyWallet({
    id: uuidv4(),
    companyId: input.companyId,
    companyName: input.companyName,
    walletLabel: 'Auto-bound from treasury funding',
    walletAddress: fundingAddress,
    network: input.network,
    tokenSymbol: input.tokenSymbol,
    tokenAddress: input.tokenAddress,
    active: true,
    verificationMethod: 'manual',
    verifiedSignatureAddress: undefined,
    verifiedByUserId: input.session.userId,
    verifiedByGithubLogin: input.session.githubLogin,
    verifiedAt: now,
    lastUsedAt: now
  })
  await deactivateOtherCompanyWallets(input.companyId, inserted!.id)
  await updateCompanyFields(input.companyId, { activeWalletId: inserted!.id })
  await insertAuditLog({
    companyId: input.companyId,
    actorUserId: input.session.userId,
    actorRole: getActorRoleLabel({ session: input.session }),
    action: 'company_wallet.auto_bind_from_funding',
    targetType: 'company_wallet',
    targetId: inserted!.id,
    summary: `Auto-bound company wallet ${input.fundingAddress} from platform funding`,
    metadata: {
      walletAddress: fundingAddress,
      network: input.network,
      tokenSymbol: input.tokenSymbol
    },
    createdAt: now
  })
  return inserted
}

export async function ensureTaskCapability(
  session: SessionUser,
  task: TaskBounty,
  capability: 'task.create' | 'task.review' | 'payment.approve'
) {
  if (isPlatformAdmin(session)) return { ok: true as const, context: null }
  const context = await getCompanyContext(session, task.companyId || session.activeCompanyId)
  if (!context || !hasCompanyCapability(context.membership?.role, capability)) {
    return { ok: false as const, response: NextResponse.json({ error: `Missing permission: ${capability}` }, { status: 403 }) }
  }
  return { ok: true as const, context }
}

export function inferTaskSource(task: TaskBounty): 'internal' | 'external' {
  if (task.source) return task.source
  const labels = task.labels || []
  return labels.includes('external-task') || labels.some((x) => /^bounty:/i.test(x)) ? 'external' : 'internal'
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export function removeLabelsByPattern(labels: string[] | undefined, pattern: RegExp) {
  return (labels || []).filter((label) => !pattern.test(label))
}

export function sameWalletAddress(left?: string, right?: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

export function resolveRecipientWalletSource(task: TaskBounty, walletAddress?: string): 'session_wallet' | 'claim_label' | 'identity_binding' | 'task_snapshot' {
  if (!walletAddress) return 'task_snapshot'
  const normalized = walletAddress.toLowerCase()
  if (task.developerWallet && task.developerWallet.toLowerCase() === normalized) return 'session_wallet'
  const labelWallet = extractWalletFromLabels(task.labels || [])
  if (labelWallet && labelWallet.toLowerCase() === normalized) return 'claim_label'
  return 'task_snapshot'
}

export async function ensureRecipientWalletNotFrozenMismatch(task: TaskBounty, nextWalletAddress?: string) {
  const settlement = await getSettlementCaseByTaskId(task.id)
  if (!settlement?.recipientWalletFrozenAt || !settlement.recipientWalletAddress || !nextWalletAddress) {
    return settlement
  }
  if (!sameWalletAddress(settlement.recipientWalletAddress, nextWalletAddress)) {
    throw new Error(`Recipient wallet is frozen as ${settlement.recipientWalletAddress} and cannot be changed to ${nextWalletAddress}`)
  }
  return settlement
}

export function isValidLarkDocUrl(url: string | undefined): boolean {
  return Boolean(url && /https?:\/\/[^\s]+(?:larksuite\.com|feishu\.cn|feishu\.com)/i.test(url))
}

export function ensureMinimumAcceptanceCriteria(input: string[] | undefined, taskTitle: string): string[] {
  const normalized = Array.from(
    new Set(
      (input || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
  const fallback = [
    `Complete the core functionality of "${taskTitle}" per the requirement document and provide a reproducible demo.`,
    'Key workflows must be verifiable; include necessary run steps, screenshots, or log evidence.',
    'Deliverables must satisfy the acceptance criteria and be ready for review and merge in the target repository.'
  ]
  for (const item of fallback) {
    if (normalized.length >= 3) break
    if (!normalized.includes(item)) normalized.push(item)
  }
  return normalized.slice(0, 5)
}

export function buildGitHubIssueTitle(task: TaskBounty): string {
  const binding = buildRequirementBindingSnapshot(task)
  const requirementId = normalizeOptionalString(binding.requirementId)
  if (requirementId && !task.title.includes(requirementId)) {
    return `[${requirementId}] ${task.title}`
  }
  return task.title
}

export function buildGitHubBountyIssueBody(task: TaskBounty, input: {
  rewardAmount: number
  rewardToken: string
  claimGithubLogin?: string
  walletAddress?: string
}) {
  const binding = buildRequirementBindingSnapshot(task)
  const acceptanceCriteria = binding.acceptanceCriteriaSnapshot.length
    ? binding.acceptanceCriteriaSnapshot
    : extractAcceptanceCriteriaCandidate(task.description)
  const sections = [
    '## Summary',
    binding.summarySnapshot || buildRequirementSummaryCandidate(task),
    '',
    '## Reference Context',
    `- Reference Doc: ${binding.larkDocUrl || 'Optional, pending'}`,
    `- Requirement ID: ${binding.requirementId || 'Pending'}`,
    `- Doc Title: ${binding.larkDocTitle || binding.title || task.title}`,
    '',
    '## Acceptance Criteria',
    ...(acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((item) => `- [ ] ${item}`)
      : ['- [ ] Refer to the requirement summary, acceptance criteria, and reference materials recorded on the platform']),
    '',
    '## Status Source',
    `- Meegle: ${binding.meegleUrl || binding.meegleIssueId || 'Pending link'}`,
    '',
    '## Bounty Metadata',
    `- Bounty: $${input.rewardAmount}`,
    `- RewardToken: ${input.rewardToken}`,
    `- Claim: ${input.claimGithubLogin ? `@${input.claimGithubLogin}` : ''}`,
    `- Wallet: ${input.walletAddress || ''}`,
    '- Auto payout: yes',
    '',
    '## Platform Trace'
  ]

  if (task.id) {
    sections.push(`- PlatformTaskId: ${task.id}`)
  }
  return sections.join('\n')
}

export function normalizeTaskForClaiming(task: TaskBounty) {
  if (
    task.source === 'external'
    && !task.claimedByGithubLogin
    && !task.prUrl
    && !task.commitSha
    && !task.txHash
    && !['open', 'cancelled', 'paid', 'disputed'].includes(task.status)
  ) {
    transitionTaskStatus(task, 'open', { manualReviewRequired: false })
    task.manualReviewReason = undefined
    task.manualReviewDecision = undefined
    task.manualReviewedAt = undefined
    task.manualReviewedByUserId = undefined
    task.lastAutoPayoutError = undefined
    task.lastAutoPayoutFailureCode = undefined
    task.lastAutoPayoutRetryStrategy = undefined
    task.lastAutoPayoutChecks = undefined
    task.paymentFailureCount = undefined
    task.lastPaymentAttemptAt = undefined
    return true
  }
  return false
}
