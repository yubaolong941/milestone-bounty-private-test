import { NextResponse } from 'next/server'
import {
  getActorRoleLabel,
  getCompanyContext,
  SessionUser
} from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import { generateRequirementRefinement, reviewTaskRequirementClarity } from '@/lib/ai'
import {
  upsertLabel
} from '@/lib/claims'
import { lockTaskRewardWithEscrow } from '@/lib/bounty-payout'
import { findBindingByGithubLogin } from '@/lib/identity-registry'
import { normalizeHumanGithubLogin } from '@/lib/github-identities'
import {
  createGitHubIssue,
  parseGitHubRepoRef
} from '@/lib/integrations'
import { getTreasuryFundingConfig, verifyTreasuryFundingTransaction } from '@/lib/treasury-funding'
import { transitionTaskStatus } from '@/lib/operations'
import {
  buildRequirementSummaryCandidate,
  extractAcceptanceCriteriaCandidate,
  extractLarkDocUrlCandidate,
  extractRequirementIdCandidate,
  generateRequirementIdCandidate,
  syncRequirementBindingFromTaskAsync
} from '@/lib/repositories/requirement-binding-repository'
import {
  markSettlementFundingReserved,
  markSettlementFundingLocked
} from '@/lib/repositories/settlement-case-repository'
import { allocateTreasuryFundingToTask, recordTreasuryFunding } from '@/lib/repositories/treasury-funding-repository'
import {
  insertAuditLog
} from '@/lib/access-control-db'
import { getRepoConfigByIdDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  buildGitHubBountyIssueBody,
  buildGitHubIssueTitle,
  ensureCompanyWalletFromFunding,
  ensureMinimumAcceptanceCriteria,
  ensureTaskCapability,
  isValidLarkDocUrl,
  normalizeOptionalString,
  removeLabelsByPattern,
  resolveCompanyPayout
} from '../helpers'

export async function handlePromote(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  const permission = await ensureTaskCapability(session, task, 'task.create')
  if (!permission.ok) {
    return permission.response
  }
  try {
    const nextDescription = String(body.description || body.requirementDescription || task.description || '').trim()
    if (nextDescription) task.description = nextDescription
    const nextRequirementDocUrl = normalizeOptionalString(body.requirementDocUrl) || task.requirementDocUrl || extractLarkDocUrlCandidate(nextDescription)
    if (nextRequirementDocUrl && !isValidLarkDocUrl(nextRequirementDocUrl)) {
      return NextResponse.json({ error: 'Invalid Lark requirement document URL. Please provide a valid Feishu/Lark document URL.' }, { status: 400 })
    }
    const nextRequirementId = normalizeOptionalString(body.requirementId)?.toUpperCase()
      || task.requirementId
      || extractRequirementIdCandidate(task.title, nextDescription, body.requirementDocTitle as string)
      || generateRequirementIdCandidate(tasks)
    const nextRequirementDocTitle = nextRequirementDocUrl
      ? (normalizeOptionalString(body.requirementDocTitle) || task.requirementDocTitle || task.title)
      : undefined
    const acceptanceCriteriaCandidate = Array.isArray(body.acceptanceCriteria)
      ? (body.acceptanceCriteria as unknown[]).map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : extractAcceptanceCriteriaCandidate(nextDescription)
    const acceptanceCriteriaSnapshot = ensureMinimumAcceptanceCriteria(acceptanceCriteriaCandidate, task.title)
    const repoConfigId = body.repoConfigId ? String(body.repoConfigId) : undefined
    const repoConfig = repoConfigId ? await getRepoConfigByIdDb(repoConfigId) : undefined
    if (repoConfigId && !repoConfig) {
      return NextResponse.json({ error: 'repoConfigId does not exist' }, { status: 400 })
    }

    const clarity = await reviewTaskRequirementClarity(task.title, task.description, {
      taskId: task.id,
      repo: repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : ((body.repo as string) || task.repo || ''),
      branch: repoConfig?.defaultBranch || 'main',
      repoVisibility: body.repoVisibility === 'private' ? 'private' : 'public',
      deliveryMode: body.deliveryMode === 'private_collab_pr' || body.deliveryMode === 'patch_bundle'
        ? body.deliveryMode as 'private_collab_pr' | 'patch_bundle'
        : 'public_mirror_pr',
      requirementDocUrl: nextRequirementDocUrl,
      requirementDocTitle: nextRequirementDocTitle,
      acceptanceCriteria: acceptanceCriteriaSnapshot,
      requirementSummary: buildRequirementSummaryCandidate({
        description: nextDescription
      })
    })

    task.requirementClarityScore = clarity.score
    task.requirementClaritySummary = clarity.summary
    task.requirementModelUsed = clarity.meta.modelUsed
    task.requirementConfidence = clarity.meta.confidence
    task.requirementGateDecision = clarity.meta.gateDecision
    task.requirementCriticFindings = clarity.meta.criticFindings
    task.requirementEvidenceRefs = clarity.meta.evidenceRefs
    task.requirementClarityStatus = clarity.clear ? 'clear' : 'needs_refinement'
    task.requirementId = nextRequirementId
    task.requirementDocUrl = nextRequirementDocUrl
    task.requirementDocTitle = nextRequirementDocTitle
    task.requirementSummarySnapshot = buildRequirementSummaryCandidate({
      ...task,
      requirementClaritySummary: clarity.summary
    })
    task.acceptanceCriteriaSnapshot = acceptanceCriteriaSnapshot

    if (!clarity.clear) {
      const refinement = await generateRequirementRefinement({
        title: task.title,
        description: task.description,
        requirementDocUrl: nextRequirementDocUrl,
        requirementDocTitle: nextRequirementDocTitle,
        claritySummary: clarity.summary,
        criticFindings: clarity.meta.criticFindings
      })
      await syncRequirementBindingFromTaskAsync(task)
      task.updatedAt = new Date().toISOString()
      await saveTaskBountiesDb(tasks)
      return NextResponse.json({
        success: false,
        error: 'Requirement needs clarification. AI has generated refinement suggestions. Review and confirm before re-publishing.',
        requirementClarity: clarity,
        requirementRefinement: refinement,
        task
      }, { status: 400 })
    }

    const rewardAmount = Number(body.rewardAmount || 50)
    const rewardToken = String(body.rewardToken || 'USD1').trim().toUpperCase()
    const fundingTxHash = String(body.fundingTxHash || '').trim()
    const treasuryConfig = getTreasuryFundingConfig()
    let labels = Array.from(new Set([
      ...removeLabelsByPattern(task.labels, /^bounty:|^rewardToken:|^claim:|^wallet:/i),
      'external-task',
      `bounty:$${rewardAmount}`,
      `rewardToken:${rewardToken}`
    ]))
    if (body.autoPayout !== false) {
      labels = Array.from(new Set([...labels, 'auto-payout:on']))
    }

    const rawClaimGithubLogin = String(body.claimGithubLogin || '').trim()
    const claimGithubLogin = normalizeHumanGithubLogin(rawClaimGithubLogin)
    if (rawClaimGithubLogin && !claimGithubLogin) {
      return NextResponse.json({ error: 'claimGithubLogin must be a human GitHub login, not a bot account' }, { status: 400 })
    }
    const explicitWalletAddress = String(body.walletAddress || '').trim()
    const bindingWalletAddress = claimGithubLogin ? (await findBindingByGithubLogin(claimGithubLogin))?.walletAddress : undefined
    const walletAddress = explicitWalletAddress || bindingWalletAddress || ''
    task.claimedByGithubLogin = undefined
    task.developerWallet = ''
    task.developerName = 'Unclaimed Bounty'
    if (walletAddress) {
      labels = upsertLabel(labels, `wallet:${walletAddress}`, /^wallet:/i)
      task.developerWallet = walletAddress
    }
    if (claimGithubLogin) {
      labels = upsertLabel(labels, `claim:@${claimGithubLogin}`, /^claim:/i)
      task.claimedByGithubLogin = claimGithubLogin
      task.developerName = claimGithubLogin
    }

    task.source = 'external'
    transitionTaskStatus(task, 'open', { manualReviewRequired: false, reason: 'Task published as external bounty' })
    task.currentClaimId = undefined
    task.companyId = task.companyId || (body.companyId as string) || session.activeCompanyId
    const companyContext = await getCompanyContext(session, task.companyId || session.activeCompanyId)
    task.companyName = task.companyName || (body.companyName as string) || companyContext?.company.name

    if (!fundingTxHash) {
      return NextResponse.json({ error: 'Platform funding must be completed and a fundingTxHash must be provided before publishing an external bounty' }, { status: 400 })
    }
    if (!treasuryConfig.enabled) {
      return NextResponse.json({
        error: `Platform treasury address is not configured. Please set up a company receiving address for the ${treasuryConfig.network.toUpperCase()} network first.`
      }, { status: 400 })
    }
    if (rewardToken !== treasuryConfig.tokenSymbol) {
      return NextResponse.json({
        error: `Platform funding currently only supports ${treasuryConfig.tokenSymbol} on the ${treasuryConfig.network.toUpperCase()} network`
      }, { status: 400 })
    }

    const explicitFundingWalletAddress = normalizeOptionalString(body.payerWalletAddress) || normalizeOptionalString(body.fundingWalletAddress)
    let companyWallet = await resolveCompanyPayout({
      ...body,
      payerWalletAddress: explicitFundingWalletAddress || body.payerWalletAddress
    }, task.companyId || session.activeCompanyId)
    const fundingVerification = await verifyTreasuryFundingTransaction({
      txHash: fundingTxHash,
      expectedFromAddress: explicitFundingWalletAddress || companyWallet?.walletAddress,
      expectedAmount: rewardAmount,
      expectedTokenSymbol: rewardToken
    })
    if (!fundingVerification.ok) {
      return NextResponse.json({ error: fundingVerification.error || 'Platform funding verification failed' }, { status: 400 })
    }

    if (!task.companyId) {
      return NextResponse.json({ error: 'Missing companyId; unable to bind company payout wallet' }, { status: 400 })
    }

    companyWallet = await ensureCompanyWalletFromFunding({
      session,
      companyId: task.companyId,
      companyName: task.companyName || companyContext?.company.name || 'Company',
      fundingAddress: fundingVerification.fromAddress || explicitFundingWalletAddress,
      network: fundingVerification.network || treasuryConfig.network,
      tokenSymbol: rewardToken,
      tokenAddress: fundingVerification.tokenAddress || treasuryConfig.tokenAddress
    }) || companyWallet

    if (!companyWallet) {
      return NextResponse.json({ error: 'Platform funding verified, but auto-binding the company payout wallet failed. Please retry or manually bind on the company wallet page.' }, { status: 400 })
    }

    task.rewardAmount = rewardAmount
    task.rewardToken = rewardToken
    task.labels = labels
    task.repoConfigId = repoConfigId
    task.repo = repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : ((body.repo as string) || task.repo || '')
    task.repoVisibility = body.repoVisibility === 'private' ? 'private' : 'public'
    task.deliveryMode = body.deliveryMode === 'private_collab_pr' || body.deliveryMode === 'patch_bundle'
      ? body.deliveryMode as 'private_collab_pr' | 'patch_bundle'
      : 'public_mirror_pr'
    task.mirrorRepoUrl = (body.mirrorRepoUrl as string) || task.mirrorRepoUrl || ''
    task.payerCompanyWalletId = companyWallet.id
    task.payerCompanyName = companyWallet.companyName
    task.payerWalletAddress = companyWallet.walletAddress
    task.treasuryFundingStatus = 'confirmed'
    task.treasuryFundingTxHash = fundingVerification.txHash
    task.treasuryFundingVerifiedAt = fundingVerification.verifiedAt
    task.treasuryFundingNetwork = fundingVerification.network
    task.treasuryFundingAddress = fundingVerification.treasuryAddress
    task.treasuryFundingAmount = rewardAmount
    task.treasuryFundingToken = rewardToken
    const lockResult = await lockTaskRewardWithEscrow({
      task,
      rewardAmount,
      rewardToken,
      companyWalletId: companyWallet.id,
      payerCompanyName: companyWallet.companyName,
      payerWalletAddress: companyWallet.walletAddress,
      fundingTxHash: fundingVerification.txHash || fundingTxHash,
      actorUserId: session.userId
    })
    if (!lockResult.success) {
      return NextResponse.json({ error: lockResult.error || 'Bounty escrow lock failed; unable to publish bounty', lock: lockResult.lock }, { status: 400 })
    }
    task.prUrl = undefined
    task.commitSha = undefined
    task.prAuthorGithubLogin = undefined
    task.githubPrNumber = undefined
    task.githubReviewApproved = undefined
    task.githubReviewDecision = undefined
    task.githubReviewStates = undefined
    task.githubCheckSummary = undefined
    task.ciPassed = undefined
    task.aiScore = undefined
    task.aiCompletionScore = undefined
    task.aiReviewSummary = undefined
    task.aiPrSuggestions = undefined
    task.aiManagerFocus = undefined
    task.aiConfidence = undefined
    task.aiGateDecision = undefined
    task.aiCriticFindings = undefined
    task.manualReviewRequired = false
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
    task.txHash = undefined
    task.paidAt = undefined
    await insertAuditLog({
      companyId: task.companyId,
      actorUserId: session.userId,
      actorRole: getActorRoleLabel({ session, membershipRole: companyContext?.membership?.role }),
      action: 'treasury_funding.applied_to_task',
      targetType: 'treasury_funding',
      targetId: fundingVerification.txHash || fundingTxHash,
      summary: `Platform funding ${fundingVerification.txHash || fundingTxHash} linked to task ${task.title}`,
      metadata: {
        companyName: task.companyName,
        txHash: fundingVerification.txHash || fundingTxHash,
        amount: rewardAmount,
        tokenSymbol: rewardToken,
        network: fundingVerification.network || treasuryConfig.network,
        fromAddress: fundingVerification.fromAddress || companyWallet.walletAddress,
        toAddress: fundingVerification.treasuryAddress || treasuryConfig.treasuryAddress,
        taskId: task.id,
        taskTitle: task.title,
        source: 'task_publish'
      },
      createdAt: new Date().toISOString()
    })
    await recordTreasuryFunding({
      id: `treasury-${fundingVerification.txHash || fundingTxHash}`,
      companyId: task.companyId,
      companyName: task.companyName,
      txHash: fundingVerification.txHash || fundingTxHash,
      amount: rewardAmount,
      tokenSymbol: rewardToken,
      network: fundingVerification.network || treasuryConfig.network,
      fromAddress: fundingVerification.fromAddress || companyWallet.walletAddress,
      toAddress: fundingVerification.treasuryAddress || treasuryConfig.treasuryAddress,
      source: 'task_publish',
      verifiedAt: fundingVerification.verifiedAt,
      recordedByUserId: session.userId,
      metadata: {
        latestTaskId: task.id,
        latestTaskTitle: task.title,
        flow: 'task_promote'
      }
    })
    await allocateTreasuryFundingToTask({
      txHash: fundingVerification.txHash || fundingTxHash,
      taskId: task.id,
      taskTitle: task.title,
      amount: rewardAmount,
      metadata: {
        latestTaskId: task.id,
        latestTaskTitle: task.title
      }
    })
    if (body.publishToGithub === true) {
      const repoRef = repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : ((body.repo as string) || task.repo || '')
      const parsedRepo = parseGitHubRepoRef(String(repoRef || ''))
      if (!parsedRepo) {
        return NextResponse.json({ error: 'Failed to publish to GitHub: missing a valid repository (owner/repo or GitHub URL)' }, { status: 400 })
      }

      const issueBody = buildGitHubBountyIssueBody(task, {
        rewardAmount,
        rewardToken,
        claimGithubLogin,
        walletAddress
      })
      const issueResult = await createGitHubIssue({
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        title: buildGitHubIssueTitle(task),
        body: issueBody,
        labels,
        tokenRef: repoConfig?.tokenRef
      })
      if (!issueResult.success) {
        return NextResponse.json({ error: `Failed to publish to GitHub: ${issueResult.detail}` }, { status: 400 })
      }

      task.githubRepoOwner = parsedRepo.owner
      task.githubRepoName = parsedRepo.repo
      task.githubIssueNumber = issueResult.issue.issueNumber
      task.githubIssueId = String(issueResult.issue.issueId)
      task.githubIssueUrl = issueResult.issue.htmlUrl
    }

    task.updatedAt = new Date().toISOString()
    await syncRequirementBindingFromTaskAsync(task)
    await saveTaskBountiesDb(tasks)
    await markSettlementFundingReserved(task, {
      treasuryFundingTxHash: fundingVerification.txHash || fundingTxHash,
      allocatedAmount: rewardAmount,
      fundingReservedAt: fundingVerification.verifiedAt
    })
    await markSettlementFundingLocked(task)
    return NextResponse.json({ success: true, task, requirementClarity: clarity })
  } catch (error) {
    return NextResponse.json({
      error: `Failed to publish external bounty: ${error instanceof Error ? error.message : String(error)}`
    }, { status: 500 })
  }
}

