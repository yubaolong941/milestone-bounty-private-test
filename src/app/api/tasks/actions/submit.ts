import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { normalizeHumanGithubLogin } from '@/lib/github-identities'
import { TaskBounty } from '@/lib/types'
import { reviewTaskBounty } from '@/lib/ai'
import { extractClaimFromLabels, upsertLabel } from '@/lib/claims'
import {
  createGitHubIssueComment,
  fetchGitHubPullRequestVerification,
  formatGitHubVerificationComment
} from '@/lib/integrations'
import {
  auditTaskTransition,
  notifyTaskIssue,
  transitionTaskStatus
} from '@/lib/operations'
import { syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import { saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureRecipientWalletNotFrozenMismatch
} from '../helpers'

export async function handleSubmit(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  if (session.role === 'external_contributor' && session.externalAuthType === 'github_code_bounty') {
    try {
      await ensureRecipientWalletNotFrozenMismatch(task, session.walletAddress)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 })
    }
    if (!session.walletAddress) {
      return NextResponse.json({ error: 'Please complete GitHub identity and wallet binding in the external portal before submitting a code bounty delivery' }, { status: 400 })
    }
    const githubLogin = normalizeHumanGithubLogin(session.githubLogin)
    const claimedBy = normalizeHumanGithubLogin(extractClaimFromLabels(task.labels || []))
    if (claimedBy && githubLogin && claimedBy !== githubLogin) {
      return NextResponse.json({ error: `This task has been claimed by @${claimedBy}; your account is not authorized to submit` }, { status: 403 })
    }
    if (!claimedBy && githubLogin) {
      task.labels = Array.from(new Set([...(task.labels || []), `claim:@${githubLogin}`]))
      task.claimedByGithubLogin = githubLogin
      task.developerName = githubLogin
    }
    task.labels = upsertLabel(task.labels || [], `wallet:${session.walletAddress}`, /^wallet:/i)
    if (!task.developerWallet) {
      task.developerWallet = session.walletAddress
    }
  }

  const nextPrUrl = body.prUrl || task.prUrl
  const nextCommitSha = body.commitSha || task.commitSha
  if (task.repoVisibility === 'public') {
    if (!nextPrUrl || !/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(nextPrUrl as string)) {
      return NextResponse.json({ error: 'Submissions to a public repository must include a GitHub PR link (/pull/)' }, { status: 400 })
    }
  }
  if (task.repoVisibility === 'private') {
    if (!nextCommitSha) {
      return NextResponse.json({ error: 'Submissions to a private repository must include a commit SHA (PR link is optional)' }, { status: 400 })
    }
  }

  task.prUrl = nextPrUrl as string | undefined
  task.commitSha = nextCommitSha as string | undefined
  task.prAuthorGithubLogin = session.githubLogin?.toLowerCase() || task.prAuthorGithubLogin
  if (nextPrUrl) {
    const verification = await fetchGitHubPullRequestVerification(nextPrUrl as string)
    task.prAuthorGithubLogin = verification.prAuthor || task.prAuthorGithubLogin
    task.githubReviewApproved = verification.reviewApproved
    task.githubReviewDecision = verification.reviewDecision
    task.githubReviewStates = verification.reviewStates
    task.githubCheckSummary = verification.checkSummary
    task.ciPassed = verification.ciPassed
    task.commitSha = verification.mergeCommitSha || (nextCommitSha as string | undefined)
  } else {
    task.ciPassed = false
    task.githubReviewApproved = false
    task.githubReviewDecision = 'missing-pr-url'
    task.githubReviewStates = []
    task.githubCheckSummary = 'Missing prUrl; unable to read GitHub checks'
  }
  transitionTaskStatus(task, 'ai_reviewing')
  const { aiScore, summary, inferPopup, meta } = await reviewTaskBounty(task)
  task.aiScore = aiScore
  task.aiCompletionScore = meta.completionScore
  task.aiReviewSummary = summary
  task.aiPrSuggestions = meta.prSuggestions
  task.aiManagerFocus = meta.managerFocus
  task.aiModelUsed = meta.modelUsed
  task.aiConfidence = meta.confidence
  task.aiGateDecision = meta.gateDecision
  task.aiCriticFindings = meta.criticFindings
  task.lastAutoPayoutError = undefined
  task.lastAutoPayoutChecks = undefined
  if (task.ciPassed !== true || (task.aiScore || 0) < 85 || task.aiGateDecision === 'block') {
    transitionTaskStatus(task, 'awaiting_manual_review', {
      manualReviewRequired: true,
      reason: 'AI or CI did not meet auto-approval conditions; manual review required'
    })
    await notifyTaskIssue({
      task,
      severity: 'warning',
      category: 'manual_review',
      title: 'Task entered manual review',
      message: `${task.title} entered the manual review queue because AI/CI conditions were not met`,
      actionUrl: '/staff'
    })
  } else {
    transitionTaskStatus(task, 'awaiting_acceptance', {
      manualReviewRequired: false
    })
  }
  await saveTaskBountiesDb(tasks)
  await syncSettlementCaseFromTask(task)
  await auditTaskTransition(task, session, 'Delivery submitted and initial AI review completed', {
    aiScore,
    aiGateDecision: meta.gateDecision,
    ciPassed: task.ciPassed
  })

  if (task.prUrl && task.githubRepoOwner && task.githubRepoName) {
    const blockers: string[] = []
    if (task.ciPassed !== true) blockers.push('GitHub checks did not all pass')
    if ((task.aiScore || 0) < 85) blockers.push(`AI score ${task.aiScore ?? '-'} is below the auto-payout threshold of 85`)
    if (task.aiGateDecision && task.aiGateDecision !== 'pass') blockers.push(`AI gate=${task.aiGateDecision}`)
    await createGitHubIssueComment(
      task.githubRepoOwner,
      task.githubRepoName,
      task.githubPrNumber || Number(task.prUrl.match(/\/pull\/(\d+)/)?.[1] || '0'),
      formatGitHubVerificationComment({
        title: 'Bounty review update',
        issueNumber: task.githubIssueNumber,
        summary,
        changes: task.aiCriticFindings,
        rewardAmount: task.rewardAmount,
        rewardToken: task.rewardToken,
        walletAddress: task.developerWallet,
        claimerGithubLogin: task.claimedByGithubLogin,
        agentLabel: 'BountyPay',
        aiScore,
        aiGateDecision: meta.gateDecision,
        ciPassed: task.ciPassed,
        payoutReady: blockers.length === 0,
        blockers
      })
    )
  }

  return NextResponse.json({ success: true, task, inferPopup })
}
