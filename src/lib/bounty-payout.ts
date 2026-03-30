import { v4 as uuidv4 } from 'uuid'
import { fetchGitHubPullRequestVerification } from '@/lib/integrations'
import { transferWithConfiguredProvider, getCurrentWalletInfo, getPlatformPayoutWalletConfig } from '@/lib/settlement'
import { BountyFundingLock, CompanyWalletConfig, PaymentRecord, TaskBounty } from '@/lib/types'
import {
  getEscrowConfig,
  lockRewardOnChain,
  releaseRewardOnChain,
  verifyRewardLockOnChain
} from '@/lib/escrow'
import {
  extractClaimFromLabels,
  extractRewardFromLabels,
  extractRewardTokenFromLabels,
  extractWalletFromLabels,
  hasAutoPayoutLabel
} from '@/lib/claims'
import { findBindingByGithubLogin, getWalletBindingSummary } from '@/lib/identity-registry'
import { listCompanyWallets } from '@/lib/access-control-db'
import { appendPaymentDb, listPaymentsDb } from '@/lib/runtime-data-db'
import { classifyPaymentFailure } from '@/lib/payment-failures'
import { getSettlementCaseByTaskId } from '@/lib/repositories/settlement-case-repository'
import { getActiveBountyFundingLockForTask, upsertBountyFundingLock } from '@/lib/repositories/bounty-funding-lock-repository'

export async function resolveActiveFundingLock(task: TaskBounty) {
  return getActiveBountyFundingLockForTask(task.id, task.rewardLockId)
}

function isDemoPayoutMode() {
  return process.env.AGENTPAY_DEMO_MODE === 'true' || process.env.WLFI_DEMO_MODE === 'true'
}

function getDemoFallbackPayerAddress() {
  return (
    process.env.AGENTPAY_DEMO_FROM_ADDRESS
    || process.env.AGENTPAY_PAYER_ADDRESS
    || process.env.WLFI_DEMO_FROM_ADDRESS
    || process.env.WLFI_PAYER_ADDRESS
    || '0x1111111111111111111111111111111111111111'
  )
}

function buildVirtualCompanyWallet(task: TaskBounty, walletAddress?: string): CompanyWalletConfig | undefined {
  const resolvedAddress = walletAddress?.trim()
  if (!resolvedAddress) return undefined

  const now = new Date().toISOString()
  return {
    id: task.payerCompanyWalletId || `demo-wallet-${task.companyId || 'global'}`,
    companyId: task.companyId,
    companyName: task.payerCompanyName || task.companyName || 'Demo Treasury',
    walletLabel: 'Demo payout wallet',
    walletAddress: resolvedAddress,
    network: process.env.AGENTPAY_NETWORK || process.env.WLFI_NETWORK || 'base',
    tokenSymbol: task.rewardToken || task.rewardLockedToken || 'USD1',
    tokenAddress: process.env.AGENTPAY_TOKEN_ADDRESS || process.env.WLFI_TOKEN_ADDRESS || undefined,
    active: true,
    verificationMethod: 'manual',
    verifiedByUserId: task.createdByUserId || 'demo-system',
    verifiedByGithubLogin: undefined,
    verifiedAt: now,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now
  }
}

function buildPlatformPayoutWallet(task: TaskBounty, walletAddress?: string): CompanyWalletConfig | undefined {
  const platformConfig = getPlatformPayoutWalletConfig()
  const resolvedAddress = platformConfig.walletAddress?.trim() || walletAddress?.trim()
  if (!resolvedAddress) return undefined

  const now = new Date().toISOString()
  return {
    id: task.payerCompanyWalletId || `platform-payout-${task.companyId || 'global'}`,
    companyId: task.companyId,
    companyName: 'Platform Treasury',
    walletLabel: 'Platform payout wallet',
    walletAddress: resolvedAddress,
    network: platformConfig.network || process.env.AGENTPAY_NETWORK || process.env.WLFI_NETWORK || 'base',
    tokenSymbol: task.rewardToken || task.rewardLockedToken || platformConfig.tokenSymbol || 'USD1',
    tokenAddress: platformConfig.tokenAddress || process.env.AGENTPAY_TOKEN_ADDRESS || process.env.WLFI_TOKEN_ADDRESS || undefined,
    active: true,
    verificationMethod: 'manual',
    verifiedByUserId: task.createdByUserId || 'platform-system',
    verifiedByGithubLogin: undefined,
    verifiedAt: now,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now
  }
}

function buildEscrowFallbackLockId(lock: BountyFundingLock) {
  return lock.onchainLockId || lock.id
}

export async function lockTaskReward(input: {
  task: TaskBounty
  rewardAmount: number
  rewardToken: string
  companyWalletId?: string
  payerCompanyName?: string
  payerWalletAddress?: string
  fundingTxHash?: string
  lockContractAddress?: string
  actorUserId: string
}) {
  const now = new Date().toISOString()
  const existing = await getActiveBountyFundingLockForTask(input.task.id, input.task.rewardLockId)

  const next: BountyFundingLock = existing || {
    id: uuidv4(),
    taskId: input.task.id,
    issueNumber: input.task.githubIssueNumber,
    issueUrl: input.task.githubIssueUrl,
    rewardAmount: input.rewardAmount,
    rewardToken: input.rewardToken,
    payerCompanyWalletId: input.companyWalletId,
    payerCompanyName: input.payerCompanyName,
    payerWalletAddress: input.payerWalletAddress,
    fundingTxHash: input.fundingTxHash,
    lockContractAddress: input.lockContractAddress,
    status: 'locked',
    createdByUserId: input.actorUserId,
    createdAt: now,
    updatedAt: now
  }

  next.rewardAmount = input.rewardAmount
  next.rewardToken = input.rewardToken
  next.payerCompanyWalletId = input.companyWalletId
  next.payerCompanyName = input.payerCompanyName
  next.payerWalletAddress = input.payerWalletAddress
  next.fundingTxHash = input.fundingTxHash
  next.lockContractAddress = input.lockContractAddress
  next.status = 'locked'
  next.updatedAt = now

  await upsertBountyFundingLock(next)

  input.task.rewardLockId = next.id
  input.task.rewardLockStatus = 'locked'
  input.task.rewardLockedAmount = input.rewardAmount
  input.task.rewardLockedToken = input.rewardToken
  input.task.payerCompanyWalletId = input.companyWalletId
  input.task.payerCompanyName = input.payerCompanyName
  input.task.payerWalletAddress = input.payerWalletAddress
  input.task.updatedAt = now

  return next
}

export async function lockTaskRewardWithEscrow(input: Parameters<typeof lockTaskReward>[0]) {
  const config = getEscrowConfig()
  const lock = await lockTaskReward(input)

  if (!config.enabled) {
    return { success: true as const, lock, onchain: false as const }
  }

  const onchain = await lockRewardOnChain({
    task: input.task,
    rewardAmount: input.rewardAmount,
    rewardToken: input.rewardToken,
    payerWalletAddress: input.payerWalletAddress,
    recipientAddress: input.task.developerWallet || undefined
  })

  if (!onchain.success) {
    return { success: false as const, error: onchain.error || 'On-chain reward lock failed', lock }
  }

  lock.fundingTxHash = onchain.txHash
  lock.lockTransactionHash = onchain.txHash
  lock.lockContractAddress = onchain.contractAddress
  lock.onchainLockId = onchain.lockId
  lock.onchainVerifiedAt = new Date().toISOString()

  input.task.rewardLockId = lock.id
  input.task.rewardLockStatus = 'locked'
  input.task.rewardLockedAmount = input.rewardAmount
  input.task.rewardLockedToken = input.rewardToken
  input.task.rewardLockContractAddress = onchain.contractAddress
  input.task.rewardLockTxHash = onchain.txHash
  input.task.rewardLockOnchainVerifiedAt = lock.onchainVerifiedAt

  await upsertBountyFundingLock(lock)

  return { success: true as const, lock, onchain: true as const }
}

export async function evaluateAutoPayout(task: TaskBounty, options: { mergedOverride?: boolean; riskPassed: boolean; allowManualRelease?: boolean }) {
  const fail = (error: string, checks?: Record<string, unknown>) => {
    const classification = classifyPaymentFailure({ error, checks })
    task.lastAutoPayoutError = error
    task.lastAutoPayoutFailureCode = classification.code
    task.lastAutoPayoutRetryStrategy = classification.retryStrategy
    if (checks) task.lastAutoPayoutChecks = checks
    return {
      success: false as const,
      error,
      checks: {
        ...checks,
        failureCode: classification.code,
        retryStrategy: classification.retryStrategy,
        nextAction: classification.nextAction
      }
    }
  }

  const inferredSource = task.source || ((task.labels || []).some((x) => x === 'external-task' || /^bounty:/i.test(x)) ? 'external' : 'internal')
  if (inferredSource !== 'external') {
    return fail('Internal assigned tasks are not eligible for automatic bounty payout')
  }

  const labels = task.labels || []
  const rewardToken = extractRewardTokenFromLabels(labels) || task.rewardToken || task.rewardLockedToken || 'USD1'
  const walletFromLabel = extractWalletFromLabels(labels)
  const claimedBy = extractClaimFromLabels(labels)
  const currentWallet = await getCurrentWalletInfo()
  const companyWallets = (await listCompanyWallets(task.companyId)).filter((item) => item.active)
  const persistedCompanyWallet = task.payerCompanyWalletId
    ? companyWallets.find((item) => item.id === task.payerCompanyWalletId && item.active)
    : task.payerWalletAddress
      ? companyWallets.find((item) => item.walletAddress.toLowerCase() === task.payerWalletAddress?.toLowerCase() && item.active)
      : companyWallets.find((item) => item.id === process.env.DEFAULT_COMPANY_WALLET_ID && item.active) || companyWallets.find((item) => item.active)
  const platformPayoutWallet = buildPlatformPayoutWallet(
    task,
    currentWallet.address || (isDemoPayoutMode() ? getDemoFallbackPayerAddress() : undefined)
  )
  const companyWallet = platformPayoutWallet
    || persistedCompanyWallet
    || (isDemoPayoutMode()
      ? buildVirtualCompanyWallet(task, task.payerWalletAddress || currentWallet.address || getDemoFallbackPayerAddress())
      : undefined)
  const walletBinding = claimedBy ? await findBindingByGithubLogin(claimedBy, 'bounty_claimer') : undefined
  const settlement = await getSettlementCaseByTaskId(task.id)
  const rewardAmount = Number(
    settlement?.allocatedAmount
    || task.rewardLockedAmount
    || task.treasuryFundingAmount
    || task.rewardAmount
    || extractRewardFromLabels(labels)
    || 0
  )
  const frozenRecipientWallet = settlement?.recipientWalletFrozenAt ? settlement.recipientWalletAddress : undefined
  const claimerWallet = frozenRecipientWallet || walletBinding?.walletAddress || walletFromLabel || task.developerWallet
  let prAuthor = task.prAuthorGithubLogin?.toLowerCase() || undefined
  let reviewApproved = false
  let reviewDecision = 'missing'
  let reviewStates: string[] = []
  let checksDetail = 'GitHub checks not yet verified'

  if (!hasAutoPayoutLabel(labels)) return fail('Missing auto-payout:on label')
  if (!rewardAmount) return fail('Missing confirmed bounty amount, cannot execute payout')
  if (!claimerWallet) return fail('Missing final recipient wallet address')
  if (!claimedBy) return fail('Missing claim:@github_login label (unclaimed)')
  if (!companyWallet) return fail('No available platform payout account found. Please verify platform wallet configuration.')
  if (frozenRecipientWallet && walletBinding?.walletAddress && walletBinding.walletAddress.toLowerCase() !== frozenRecipientWallet.toLowerCase()) {
    return fail(`Frozen recipient address ${frozenRecipientWallet} does not match latest bound wallet ${walletBinding.walletAddress}. An explicit change process is required.`)
  }
  let fundingLock = await resolveActiveFundingLock(task)
  if (!fundingLock && (task.treasuryFundingStatus === 'confirmed' || isDemoPayoutMode())) {
    fundingLock = await lockTaskReward({
      task,
      rewardAmount,
      rewardToken,
      companyWalletId: companyWallet.id,
      payerCompanyName: companyWallet.companyName,
      payerWalletAddress: companyWallet.walletAddress,
      fundingTxHash: task.treasuryFundingTxHash || (isDemoPayoutMode() ? `demo-funding-${task.id}` : undefined),
      actorUserId: task.createdByUserId || 'system'
    })
  }
  if (!fundingLock || fundingLock.rewardAmount < rewardAmount || fundingLock.rewardToken !== rewardToken) {
    return fail('Bounty not locked or locked budget is insufficient')
  }

  const escrowConfig = getEscrowConfig()
  if (escrowConfig.enabled) {
    const onchainVerification = await verifyRewardLockOnChain(fundingLock)
    if (!onchainVerification.ok) {
      return fail(`On-chain escrow verification failed: ${onchainVerification.error || 'unknown'}`)
    }
    const onchainAmount = Number(onchainVerification.amountFormatted || '0')
    if (onchainVerification.released) {
      return fail('On-chain reward lock already released. Duplicate payment is not allowed.')
    }
    if (onchainVerification.cancelled) {
      return fail('On-chain reward lock has been cancelled. Payment is not allowed.')
    }
    if (onchainAmount < rewardAmount) {
      return fail(`On-chain escrow balance insufficient (expected ${rewardAmount}, actual ${onchainAmount})`)
    }
    fundingLock.onchainVerifiedAt = onchainVerification.verifiedAt
    task.rewardLockOnchainVerifiedAt = onchainVerification.verifiedAt
    task.rewardLockContractAddress = fundingLock.lockContractAddress
  }
  if ((task.developerName || '').toLowerCase() !== claimedBy) {
    return fail(`Claimer and deliverer do not match (claim:@${claimedBy} vs developer:${task.developerName || '-'})`)
  }

  const aiPassed = (task.aiScore || 0) >= 85
  const aiGatePassed = task.aiGateDecision ? task.aiGateDecision === 'pass' : aiPassed
  const riskPassed = options.riskPassed
  const deliveryMode = task.deliveryMode || 'public_mirror_pr'
  const manualReleaseApproved = Boolean(
    options.allowManualRelease
    && (
      task.manualReviewDecision === 'approved'
      || task.status === 'awaiting_finance_review'
      || task.status === 'payment_failed'
      || task.status === 'accepted'
    )
  )

  let merged = Boolean(options.mergedOverride)
  let mergedDetail = 'Using local override value'

  if (task.prUrl) {
    const verification = await fetchGitHubPullRequestVerification(task.prUrl)
    if (!options.mergedOverride) {
      merged = verification.merged
      mergedDetail = verification.detail
    }
    prAuthor = verification.prAuthor || prAuthor
    reviewApproved = verification.reviewApproved
    reviewDecision = verification.reviewDecision
    reviewStates = verification.reviewStates
    checksDetail = verification.checkSummary
    task.prAuthorGithubLogin = verification.prAuthor || task.prAuthorGithubLogin
    task.githubReviewApproved = verification.reviewApproved
    task.githubReviewDecision = verification.reviewDecision
    task.githubReviewStates = verification.reviewStates
    task.githubCheckSummary = verification.checkSummary
    task.commitSha = verification.mergeCommitSha || task.commitSha
    task.ciPassed = verification.ciPassed
  } else {
    task.ciPassed = false
    task.githubReviewApproved = false
    task.githubReviewDecision = 'missing-pr-url'
    task.githubReviewStates = []
    task.githubCheckSummary = 'Missing prUrl, cannot read GitHub checks'
    checksDetail = 'Missing prUrl, cannot read GitHub checks'
  }

  const ciPassed = task.ciPassed === true
  if (prAuthor && prAuthor !== claimedBy) {
    return fail(`PR author does not match claimer (claim:@${claimedBy} vs prAuthor:@${prAuthor})`, {
      merged,
      mergedDetail,
      ciPassed,
      reviewApproved,
      reviewDecision,
      reviewStates,
      checksDetail
    })
  }
  if (!reviewApproved && deliveryMode !== 'patch_bundle' && !manualReleaseApproved) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return fail('Missing GitHub review approval. Task moved to awaiting manual acceptance.', {
      merged,
      mergedDetail,
      ciPassed,
      reviewApproved,
      reviewDecision,
      reviewStates,
      checksDetail
    })
  }

  if (deliveryMode === 'patch_bundle' && !task.commitSha && !manualReleaseApproved) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return fail('patch_bundle mode is missing commitSha. Internal import is required before payout.')
  }

  if (deliveryMode === 'private_collab_pr' && !merged && !manualReleaseApproved) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return fail('private_collab_pr mode requires the private repo PR to be merged', { merged, mergedDetail })
  }

  if ((!merged || !ciPassed || !aiPassed || !aiGatePassed || !riskPassed) && !manualReleaseApproved) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return fail('Auto-payout conditions not met. Task moved to awaiting manual acceptance.', {
      merged,
      ciPassed,
      aiPassed,
      aiGatePassed,
      riskPassed,
      reviewApproved,
      reviewDecision,
      reviewStates,
      checksDetail,
      mergedDetail,
      aiGateDecision: task.aiGateDecision,
      aiCriticFindings: task.aiCriticFindings
    })
  }

  let txHash: string | undefined
  let provider: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key' | 'escrow' = 'mock'

  if (escrowConfig.enabled) {
    const release = await releaseRewardOnChain({
      lockId: fundingLock.onchainLockId || buildEscrowFallbackLockId(fundingLock),
      recipientAddress: claimerWallet
    })
    if (!release.success) return fail(release.error || 'Contract release failed')
    txHash = release.txHash
    provider = 'escrow'
    fundingLock.releaseTransactionHash = release.txHash
  } else {
    const transfer = await transferWithConfiguredProvider(claimerWallet, rewardAmount, `[TaskBounty] ${task.title} auto bounty payout`, {
      tokenSymbol: rewardToken,
      expectedFromAddress: companyWallet.walletAddress
    })
    if (!transfer.success) return fail(transfer.error || 'Payment failed')
    txHash = transfer.txHash
    provider = transfer.provider
  }

  task.status = 'paid'
  task.rewardAmount = rewardAmount
  task.rewardToken = rewardToken
  task.developerWallet = claimerWallet
  task.payoutWalletBindingId = walletBinding?.id
  task.rewardLockId = fundingLock.id
  task.rewardLockStatus = 'released'
  task.rewardReleaseTxHash = txHash
  task.payerCompanyWalletId = companyWallet.id
  task.payerCompanyName = companyWallet.companyName
  task.payerWalletAddress = companyWallet.walletAddress
  task.payoutProvider = provider
  task.riskDecision = 'pass'
  task.lastAutoPayoutError = undefined
  task.lastAutoPayoutChecks = {
    merged,
    ciPassed,
    aiPassed,
    aiGatePassed,
    riskPassed,
    manualReleaseApproved,
    reviewApproved,
    reviewDecision,
    reviewStates,
    checksDetail,
    budgetChecked: true,
    lockChecked: true,
    claimedBy,
    prAuthor: prAuthor || null
  }
  task.txHash = txHash
  task.paidAt = new Date().toISOString()
  task.updatedAt = new Date().toISOString()

  fundingLock.status = 'released'
  fundingLock.releaseTransactionHash = txHash
  fundingLock.updatedAt = task.updatedAt
  await upsertBountyFundingLock(fundingLock)

  return {
    success: true as const,
    txHash,
    transferProvider: provider,
    walletBindingId: walletBinding?.id,
    fundingLockId: fundingLock.id,
    checks: {
      payerCompanyName: companyWallet.companyName,
      payerWalletAddress: companyWallet.walletAddress,
      currentWalletAddress: currentWallet.address || companyWallet.walletAddress || null,
      merged,
      ciPassed,
      aiPassed,
      aiGatePassed,
      riskPassed,
      manualReleaseApproved,
      reviewApproved,
      reviewDecision,
      reviewStates,
      checksDetail,
      budgetChecked: true,
      lockChecked: true,
      claimedBy,
      prAuthor: prAuthor || null
    }
  }
}

export async function appendAgentLedgerRecord(input: {
  task: TaskBounty
  payout: {
    success: true
    txHash?: string
    walletBindingId?: string
    fundingLockId?: string
    checks?: Record<string, unknown>
  }
}) {
  const paymentsResult = await listPaymentsDb(input.task.companyId)
  const payments = Array.isArray(paymentsResult) ? paymentsResult : paymentsResult.items
  const existing = payments.find((item) =>
    item.reportId === input.task.id
    && item.txHash === input.payout.txHash
  )
  if (existing) return existing

  const payment: PaymentRecord = {
    id: uuidv4(),
    projectId: 'task-bounty',
    projectName: 'AgentLedger',
    reportId: input.task.id,
    reportTitle: input.task.title,
    moduleType: 'bounty_task',
    amount: input.task.rewardAmount,
    rewardToken: input.task.rewardToken,
    toAddress: input.task.developerWallet,
    toName: input.task.developerName,
    fromAddress: input.task.payerWalletAddress,
    fromName: input.task.payerCompanyName,
    txHash: input.payout.txHash!,
    memo: `[TaskBounty] ${input.task.title} auto bounty payout`,
    timestamp: new Date().toISOString(),
    repo: input.task.repo,
    issueNumber: input.task.githubIssueNumber,
    issueUrl: input.task.githubIssueUrl,
    prUrl: input.task.prUrl,
    claimerGithubLogin: input.task.claimedByGithubLogin,
    aiModelUsed: input.task.aiModelUsed,
    walletBindingId: input.payout.walletBindingId,
    fundingLockId: input.payout.fundingLockId,
    verificationSnapshot: input.payout.checks
  }
  await appendPaymentDb(payment)
  return payment
}
