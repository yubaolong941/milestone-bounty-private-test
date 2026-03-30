import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { normalizeHumanGithubLogin } from '@/lib/github-identities'
import { TaskBounty } from '@/lib/types'
import { upsertLabel } from '@/lib/claims'
import {
  createGitHubIssueComment,
  formatGitHubVerificationComment
} from '@/lib/integrations'
import { transitionTaskStatus } from '@/lib/operations'
import { syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import { getRepoConfigByIdDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureRecipientWalletNotFrozenMismatch
} from '../helpers'

export async function handleClaim(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  if (session.role !== 'external_contributor' || session.externalAuthType !== 'github_code_bounty') {
    return NextResponse.json({ error: 'Only GitHub bounty users can claim tasks' }, { status: 403 })
  }
  const githubLogin = normalizeHumanGithubLogin(session.githubLogin)
  if (!githubLogin) return NextResponse.json({ error: 'Current session has no GitHub identity' }, { status: 400 })
  if (task.claimedByGithubLogin && task.claimedByGithubLogin !== githubLogin) {
    return NextResponse.json({ error: `This task has already been claimed by @${task.claimedByGithubLogin}` }, { status: 409 })
  }

  task.labels = upsertLabel(task.labels || [], `claim:@${githubLogin}`, /^claim:/i)
  task.claimedByGithubLogin = githubLogin
  task.developerName = githubLogin
  if (session.walletAddress) {
    try {
      await ensureRecipientWalletNotFrozenMismatch(task, session.walletAddress)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 })
    }
    task.labels = upsertLabel(task.labels || [], `wallet:${session.walletAddress}`, /^wallet:/i)
    task.developerWallet = session.walletAddress
  }
  if (task.status === 'open') {
    transitionTaskStatus(task, 'in_progress')
  }
  await saveTaskBountiesDb(tasks)
  await syncSettlementCaseFromTask(task)

  let githubClaimComment: { success: boolean; detail: string } | undefined
  if (task.githubRepoOwner && task.githubRepoName && task.githubIssueNumber) {
    const repoConfig = task.repoConfigId ? await getRepoConfigByIdDb(task.repoConfigId) : undefined
    githubClaimComment = await createGitHubIssueComment(
      task.githubRepoOwner,
      task.githubRepoName,
      task.githubIssueNumber,
      formatGitHubVerificationComment({
        title: 'BountyPay claim registered',
        issueNumber: task.githubIssueNumber,
        summary: `${task.title} has been claimed and assigned to @${task.claimedByGithubLogin}.`,
        changes: [
          `Claim registered in BountyPay`,
          `Designated bounty developer: @${task.claimedByGithubLogin}`,
          'Awaiting PR submission from claimer'
        ],
        rewardAmount: task.rewardAmount,
        rewardToken: task.rewardToken,
        walletAddress: task.developerWallet,
        claimerGithubLogin: task.claimedByGithubLogin,
        agentLabel: 'BountyPay',
        payoutReady: false,
        blockers: ['Waiting for GitHub PR submission']
      }),
      repoConfig?.tokenRef
    )
  }

  return NextResponse.json({ success: true, task, githubClaimComment })
}
