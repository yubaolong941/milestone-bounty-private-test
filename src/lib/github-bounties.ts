import { createHash } from 'crypto'
import { listTaskBountiesDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'
import { buildRequirementBindingSnapshotAsync, syncRequirementBindingFromTaskAsync } from '@/lib/repositories/requirement-binding-repository'
import { normalizeHumanGithubLogin } from '@/lib/github-identities'
import { TaskBounty } from './types'
import {
  extractClaimFromLabels,
  extractRewardFromLabels,
  extractRewardTokenFromLabels,
  extractWalletFromLabels
} from './claims'

export interface GitHubBountyIssue {
  companyId?: string
  owner: string
  repo: string
  issueNumber: number
  issueId: number
  title: string
  body: string
  labels: string[]
  htmlUrl: string
  authorLogin?: string
  state?: 'open' | 'closed'
}

interface ParsedIssueBodyMetadata {
  rewardAmount?: number
  rewardToken?: string
  wallet?: string
  claim?: string
  autoPayout?: boolean
  requirementId?: string
  requirementDocUrl?: string
  meegleRef?: string
}

const REQUIREMENT_ID_PATTERN = /\bREQ-\d{8}-\d{3}\b/i

function findBodyField(body: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`^${escaped}\\s*:\\s*([^\\n]*)$`, 'im'),
    new RegExp(`^-\\s*${escaped}\\s*:\\s*([^\\n]*)$`, 'im'),
    new RegExp(`^###\\s*${escaped}\\s*$\\n+([^#\\n][\\s\\S]*?)(?=\\n###{1,6}\\s|$)`, 'im')
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match) return match[1]?.trim() ?? ''
  }
  return null
}

export function extractStructuredMetadataFromBody(body: string): ParsedIssueBodyMetadata {
  const rewardRaw = findBodyField(body, 'Bounty') || findBodyField(body, 'Reward')
  const rewardTokenRaw = findBodyField(body, 'RewardToken') || findBodyField(body, 'Reward Token')
  const walletRaw = findBodyField(body, 'Wallet')
  const claimRaw = findBodyField(body, 'Claim')
  const autoPayoutRaw = findBodyField(body, 'Auto payout') || findBodyField(body, 'AutoPayout')
  const requirementIdRaw = findBodyField(body, 'Requirement ID')
  const requirementDocRaw = findBodyField(body, 'Lark Doc')
  const meegleRaw = findBodyField(body, 'Meegle')

  return {
    rewardAmount: rewardRaw?.match(/\$?(\d+)/)?.[1] ? Number(rewardRaw.match(/\$?(\d+)/)?.[1]) : undefined,
    rewardToken: rewardTokenRaw?.trim() ? rewardTokenRaw.trim().toUpperCase() : undefined,
    wallet: walletRaw?.match(/0x[a-fA-F0-9]{40}/)?.[0],
    claim: claimRaw?.trim().match(/^@?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)$/)?.[1]?.toLowerCase(),
    autoPayout: autoPayoutRaw ? /^(true|yes|on|enable|enabled)$/i.test(autoPayoutRaw) : undefined,
    requirementId: requirementIdRaw?.match(REQUIREMENT_ID_PATTERN)?.[0]?.toUpperCase(),
    requirementDocUrl: requirementDocRaw?.match(/https?:\/\/\S+/)?.[0],
    meegleRef: meegleRaw?.trim()
  }
}

export function hasBountyLabels(labels: string[]): boolean {
  return labels.some((label) =>
    /^bounty:/i.test(label)
    || /^wallet:/i.test(label)
    || /^claim:/i.test(label)
    || label === 'auto-payout:on'
    || label === 'external-task'
  )
}

export function buildGitHubTaskId(owner: string, repo: string, issueNumber: number): string {
  const normalized = `${owner}/${repo}#${issueNumber}`.toLowerCase()
  return `gh-${createHash('sha1').update(normalized).digest('hex').slice(0, 33)}`
}

export function extractLinkedIssueNumbers(text: string): number[] {
  const matches = text.match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi) || []
  const numbers = matches
    .map((part) => Number(part.match(/#(\d+)/)?.[1] || ''))
    .filter((value) => Number.isFinite(value) && value > 0)
  return Array.from(new Set(numbers))
}

function inferTitleFallback(issue: GitHubBountyIssue): string {
  return issue.title || `GitHub Bounty #${issue.issueNumber}`
}

export async function upsertTaskFromGitHubIssue(issue: GitHubBountyIssue): Promise<{
  success: boolean
  task: TaskBounty
  created: boolean
  cancelled?: boolean
  skipped?: boolean
}> {
  const tasks = await listTaskBountiesDb()
  const taskId = buildGitHubTaskId(issue.owner, issue.repo, issue.issueNumber)
  const existing = tasks.find((task) =>
    task.id === taskId
    || (task.githubIssueId && task.githubIssueId === String(issue.issueId))
    || (
      task.githubRepoOwner === issue.owner
      && task.githubRepoName === issue.repo
      && task.githubIssueNumber === issue.issueNumber
    )
  )
  const bodyMeta = extractStructuredMetadataFromBody(issue.body || '')
  const nextLabels = [...issue.labels]
  if (bodyMeta.rewardAmount && !nextLabels.some((label) => /^bounty:/i.test(label))) nextLabels.push(`bounty:$${bodyMeta.rewardAmount}`)
  if (bodyMeta.rewardToken && !nextLabels.some((label) => /^rewardToken:/i.test(label))) nextLabels.push(`rewardToken:${bodyMeta.rewardToken}`)
  if (bodyMeta.wallet && !nextLabels.some((label) => /^wallet:/i.test(label))) nextLabels.push(`wallet:${bodyMeta.wallet}`)
  if (bodyMeta.claim && !nextLabels.some((label) => /^claim:/i.test(label))) nextLabels.push(`claim:@${bodyMeta.claim}`)
  if (bodyMeta.autoPayout && !nextLabels.includes('auto-payout:on')) nextLabels.push('auto-payout:on')
  const rewardAmount = extractRewardFromLabels(nextLabels) || bodyMeta.rewardAmount || 0
  const wallet = extractWalletFromLabels(nextLabels) || bodyMeta.wallet || ''
  const claim = normalizeHumanGithubLogin(extractClaimFromLabels(nextLabels) || bodyMeta.claim)
  const isBounty = hasBountyLabels(nextLabels) || rewardAmount > 0
  const now = new Date().toISOString()
  const shouldSyncIssue = true
  const normalizedAuthorLogin = normalizeHumanGithubLogin(issue.authorLogin)
  const inferredDeveloperName = claim
    ? claim
    : isBounty
      ? (existing?.developerName || 'Unclaimed Bounty')
      : (issue.authorLogin || existing?.developerName || 'unclaimed')
  const inferredClaimedByGithubLogin = claim
    ? claim.toLowerCase()
    : isBounty
      ? existing?.claimedByGithubLogin
      : (normalizedAuthorLogin || existing?.claimedByGithubLogin)

  const baseTask: TaskBounty = {
    id: existing?.id || taskId,
    companyId: issue.companyId || existing?.companyId,
    title: inferTitleFallback(issue),
    description: issue.body || '',
    requirementId: bodyMeta.requirementId || issue.title.match(REQUIREMENT_ID_PATTERN)?.[0]?.toUpperCase(),
    requirementDocUrl: bodyMeta.requirementDocUrl,
    requirementDocTitle: inferTitleFallback(issue),
    source: 'external',
    rewardAmount,
    rewardToken: extractRewardTokenFromLabels(nextLabels) || bodyMeta.rewardToken || 'USD1',
    labels: Array.from(new Set([
      ...nextLabels,
      'external-task',
      ...(isBounty ? ['github-bounty'] : ['github-issue'])
    ])),
    repo: `${issue.owner}/${issue.repo}`,
    repoVisibility: 'public',
    deliveryMode: 'public_mirror_pr',
    mirrorRepoUrl: issue.htmlUrl,
    developerName: inferredDeveloperName,
    claimedByGithubLogin: inferredClaimedByGithubLogin,
    developerWallet: wallet,
    githubRepoOwner: issue.owner,
    githubRepoName: issue.repo,
    githubIssueNumber: issue.issueNumber,
    githubIssueId: String(issue.issueId),
    githubIssueUrl: issue.htmlUrl,
    meegleIssueId: bodyMeta.meegleRef,
    status: issue.state === 'closed' ? 'cancelled' : 'open',
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }

  if (!existing && !shouldSyncIssue) {
    return { success: true, task: baseTask, created: false, cancelled: true, skipped: true }
  }

  if (existing) {
    const previousStatus = existing.status
    const existingBinding = await buildRequirementBindingSnapshotAsync(existing)
    Object.assign(existing, {
      ...baseTask,
      requirementId: baseTask.requirementId || existingBinding.requirementId || existing.requirementId,
      requirementDocUrl: baseTask.requirementDocUrl || existingBinding.larkDocUrl || existing.requirementDocUrl,
      requirementDocTitle: baseTask.requirementDocTitle || existingBinding.larkDocTitle || existing.requirementDocTitle,
      prUrl: existing.prUrl,
      commitSha: existing.commitSha,
      aiScore: existing.aiScore,
      aiReviewSummary: existing.aiReviewSummary,
      aiModelUsed: existing.aiModelUsed,
      aiConfidence: existing.aiConfidence,
      aiGateDecision: existing.aiGateDecision,
      aiCriticFindings: existing.aiCriticFindings,
      ciPassed: existing.ciPassed,
      txHash: existing.txHash,
      paidAt: existing.paidAt
    })
    if (previousStatus && !['open', 'cancelled'].includes(previousStatus)) {
      existing.status = previousStatus
    }
    if (!shouldSyncIssue && previousStatus !== 'paid') {
      existing.status = 'cancelled'
    }
    await syncRequirementBindingFromTaskAsync(existing)
    await saveTaskBountiesDb(tasks)
    return { success: true, task: existing, created: false, cancelled: !shouldSyncIssue }
  }

  tasks.push(baseTask)
  await syncRequirementBindingFromTaskAsync(baseTask)
  await saveTaskBountiesDb(tasks)
  return { success: true, task: baseTask, created: true, cancelled: !shouldSyncIssue }
}
