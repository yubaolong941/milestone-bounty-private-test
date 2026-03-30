import { NextResponse } from 'next/server'
import { reviewTaskBounty } from '@/lib/ai'
import {
  createGitHubIssueComment,
  extractTaskIdsFromMessage,
  formatGitHubVerificationComment,
  verifyGitHubWebhookSignature
} from '@/lib/integrations'
import { buildGitHubTaskId, extractLinkedIssueNumbers, GitHubBountyIssue, upsertTaskFromGitHubIssue } from '@/lib/github-bounties'
import { tryAutoPayout } from '@/lib/payout-executor'
import { appendAgentLedgerRecord } from '@/lib/bounty-payout'
import { classifyPaymentFailure } from '@/lib/payment-failures'
import { enqueueAutoRetryForTask } from '@/lib/payment-retry-queue'
import { executeWorkflowEvent, buildWebhookIdempotencyKey } from '@/lib/workflow/events'
import { extractClaimFromLabels, upsertLabel } from '@/lib/claims'
import { normalizeHumanGithubLogin } from '@/lib/github-identities'
import { listTaskBountiesDb, recordIntegrationRunDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'

interface WebhookIssuePayload {
  action?: string
  issue?: {
    id: number
    number: number
    title: string
    body?: string | null
    html_url: string
    state: 'open' | 'closed'
    labels?: Array<{ name?: string }>
    user?: { login?: string }
  }
  repository?: {
    owner?: { login?: string }
    name?: string
  }
}

interface WebhookPullRequestPayload {
  action?: string
  number?: number
  repository?: {
    owner?: { login?: string }
    name?: string
    full_name?: string
  }
  pull_request?: {
    html_url: string
    title?: string
    body?: string | null
    merged?: boolean
    merge_commit_sha?: string | null
    user?: { login?: string }
    merged_by?: { login?: string }
  }
}

interface WebhookIssueCommentPayload {
  action?: string
  issue?: {
    number: number
    pull_request?: unknown
  }
  comment?: {
    body?: string | null
    user?: { login?: string }
  }
  repository?: {
    owner?: { login?: string }
    name?: string
  }
}

function normalizeLabels(labels: Array<{ name?: string }> | undefined): string[] {
  return (labels || []).map((label) => label.name || '').filter(Boolean)
}

async function handleIssueEvent(payload: WebhookIssuePayload) {
  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  const issue = payload.issue
  if (!owner || !repo || !issue) {
    return { success: false, detail: 'Issue webhook payload is incomplete' }
  }

  const result = await upsertTaskFromGitHubIssue({
    owner,
    repo,
    issueNumber: issue.number,
    issueId: issue.id,
    title: issue.title,
    body: issue.body || '',
    labels: normalizeLabels(issue.labels),
    htmlUrl: issue.html_url,
    authorLogin: issue.user?.login,
    state: issue.state
  } satisfies GitHubBountyIssue)

  return {
    success: true,
    detail: result.skipped
      ? `issue #${issue.number} skipped`
      : `issue #${issue.number} synced as task ${result.task.id}`,
    taskId: result.task.id,
    created: result.created,
    skipped: result.skipped
  }
}

async function handleMergedPullRequest(payload: WebhookPullRequestPayload) {
  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  const pr = payload.pull_request
  if (!owner || !repo || !pr || !payload.number) {
    return { success: false, detail: 'pull_request webhook payload is incomplete' }
  }

  const linkText = `${pr.title || ''}\n${pr.body || ''}`
  const linkedIssueNumbers = extractLinkedIssueNumbers(linkText)
  const linkedTaskIds = extractTaskIdsFromMessage(linkText)
  const tasks = await listTaskBountiesDb()
  const candidates = tasks.filter((task) =>
    (
      task.githubRepoOwner === owner
      && task.githubRepoName === repo
      && task.githubIssueNumber
      && linkedIssueNumbers.includes(task.githubIssueNumber)
    )
    || linkedTaskIds.includes(task.id)
    || task.prUrl === pr.html_url
  )

  if (candidates.length === 0) {
    return {
      success: true,
      detail: `Merged PR #${payload.number} did not match any bounty task`,
      linkedIssueNumbers
    }
  }

  const payoutResults: Array<{ taskId: string; success: boolean; detail: string; txHash?: string }> = []

  for (const task of candidates) {
    const prAuthor = normalizeHumanGithubLogin(pr.user?.login)
    const claimedBy = normalizeHumanGithubLogin(extractClaimFromLabels(task.labels || []))

    task.prUrl = pr.html_url
    task.githubPrNumber = payload.number
    task.commitSha = pr.merge_commit_sha || task.commitSha
    task.prAuthorGithubLogin = prAuthor
    if (!claimedBy && prAuthor) {
      task.labels = Array.from(new Set([...(task.labels || []), `claim:@${prAuthor}`]))
      task.claimedByGithubLogin = prAuthor
      task.developerName = prAuthor
    } else if (claimedBy) {
      task.claimedByGithubLogin = claimedBy
      task.developerName = claimedBy
    } else if (prAuthor) {
      task.developerName = prAuthor
    }

    task.status = 'ai_reviewing'
    const review = await reviewTaskBounty(task)
    task.aiScore = review.aiScore
    task.aiCompletionScore = review.meta.completionScore
    task.aiReviewSummary = review.summary
    task.aiPrSuggestions = review.meta.prSuggestions
    task.aiManagerFocus = review.meta.managerFocus
    task.aiModelUsed = review.meta.modelUsed
    task.aiConfidence = review.meta.confidence
    task.aiGateDecision = review.meta.gateDecision
    task.aiCriticFindings = review.meta.criticFindings
    task.lastAutoPayoutError = undefined
    task.lastAutoPayoutChecks = undefined
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()

    const blockers: string[] = []
    if ((task.aiScore || 0) < 85) blockers.push(`AI score ${task.aiScore ?? '-'} is below the auto-payout threshold of 85`)
    if (task.aiGateDecision && task.aiGateDecision !== 'pass') blockers.push(`AI gate=${task.aiGateDecision}`)
    if (task.githubRepoOwner && task.githubRepoName) {
      await createGitHubIssueComment(
        task.githubRepoOwner,
        task.githubRepoName,
        payload.number,
        formatGitHubVerificationComment({
          title: 'Bounty review update',
          issueNumber: task.githubIssueNumber,
          summary: review.summary,
          changes: review.meta.criticFindings,
          rewardAmount: task.rewardAmount,
          rewardToken: task.rewardToken,
          walletAddress: task.developerWallet,
          claimerGithubLogin: task.claimedByGithubLogin,
          agentLabel: 'BountyPay',
          aiScore: review.aiScore,
          aiGateDecision: review.meta.gateDecision,
          ciPassed: task.ciPassed,
          payoutReady: blockers.length === 0,
          blockers
        })
      )
    }

    const payout = await tryAutoPayout(task, {
      mergedOverride: true,
      riskPassed: true,
      source: 'github_webhook',
      idempotencyKey: buildWebhookIdempotencyKey({
        provider: 'github',
        deliveryId: undefined,
        fallbackParts: [task.id, String(payload.number || ''), pr.html_url, pr.merge_commit_sha || '', 'auto-payout']
      })
    })
    if (!payout.success) {
      const failure = classifyPaymentFailure({ error: payout.error, checks: payout.checks })
      await enqueueAutoRetryForTask({
        task,
        classification: failure,
        source: 'github_webhook',
        error: payout.error,
        metadata: {
          checks: payout.checks,
          prNumber: payload.number
        }
      })
      if (task.githubRepoOwner && task.githubRepoName) {
        const failedBlockers = [payout.error || 'Auto-payout conditions not met']
        await createGitHubIssueComment(
          task.githubRepoOwner,
          task.githubRepoName,
          payload.number,
          formatGitHubVerificationComment({
            title: 'Bounty payout blocked',
            issueNumber: task.githubIssueNumber,
            summary: review.summary,
            changes: failedBlockers,
            rewardAmount: task.rewardAmount,
            rewardToken: task.rewardToken,
            walletAddress: task.developerWallet,
            claimerGithubLogin: task.claimedByGithubLogin,
            agentLabel: 'BountyPay',
            aiScore: review.aiScore,
            aiGateDecision: review.meta.gateDecision,
            ciPassed: task.ciPassed,
            reviewApproved: payout.checks?.reviewApproved as boolean | undefined,
            payoutReady: false,
            blockers: failedBlockers
          })
        )
      }
      payoutResults.push({ taskId: task.id, success: false, detail: payout.error || 'Auto-payout conditions not met' })
      continue
    }
    if (payout.shouldRecordLedger) {
      await appendAgentLedgerRecord({
        task,
        payout: {
          success: true,
          txHash: payout.txHash,
          walletBindingId: payout.walletBindingId,
          fundingLockId: payout.fundingLockId,
          checks: payout.checks
        }
      })
    }
    task.nextAutoRetryAt = undefined
    task.autoRetryJobId = undefined
    if (task.githubRepoOwner && task.githubRepoName) {
      await createGitHubIssueComment(
        task.githubRepoOwner,
        task.githubRepoName,
        payload.number,
        formatGitHubVerificationComment({
          title: 'Bounty payout settled',
          issueNumber: task.githubIssueNumber,
          summary: review.summary,
          changes: review.meta.criticFindings,
          rewardAmount: task.rewardAmount,
          rewardToken: task.rewardToken,
          walletAddress: task.developerWallet,
          claimerGithubLogin: task.claimedByGithubLogin,
          agentLabel: 'BountyPay',
          aiScore: review.aiScore,
          aiGateDecision: review.meta.gateDecision,
          ciPassed: task.ciPassed,
          reviewApproved: payout.checks?.reviewApproved as boolean | undefined,
          payoutReady: true,
          txHash: payout.txHash
        })
      )
    }
    payoutResults.push({ taskId: task.id, success: true, detail: 'Auto payout succeeded', txHash: payout.txHash })
  }

  await saveTaskBountiesDb(tasks)

  return {
    success: true,
    detail: `Merged PR #${payload.number} processed ${candidates.length} task(s)`,
    linkedIssueNumbers,
    payoutResults
  }
}

async function handleIssueCommentEvent(payload: WebhookIssueCommentPayload) {
  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  const issueNumber = payload.issue?.number
  const commentBody = payload.comment?.body?.trim() || ''
  const actor = normalizeHumanGithubLogin(payload.comment?.user?.login)

  if (!owner || !repo || !issueNumber || !commentBody || !actor) {
    return { success: false, detail: 'issue_comment webhook payload is incomplete' }
  }

  const taskId = buildGitHubTaskId(owner, repo, issueNumber)
  const tasks = await listTaskBountiesDb()
  const task = tasks.find((item) => item.id === taskId)
  if (!task) {
    return { success: true, detail: `issue_comment did not match task ${taskId}` }
  }

  const lines = commentBody.split('\n').map((line) => line.trim()).filter(Boolean)
  const touched: string[] = []
  for (const line of lines) {
    if (/^\/claim\b/i.test(line)) {
      if (!actor) continue
      task.labels = upsertLabel(task.labels || [], `claim:@${actor}`, /^claim:/i)
      task.claimedByGithubLogin = actor
      task.developerName = actor
      touched.push(`claim:@${actor}`)
      continue
    }
    const walletMatch = line.match(/^\/wallet\s+(0x[a-fA-F0-9]{40})$/i)
    if (walletMatch) {
      task.labels = upsertLabel(task.labels || [], `wallet:${walletMatch[1]}`, /^wallet:/i)
      task.developerWallet = walletMatch[1]
      touched.push(`wallet:${walletMatch[1]}`)
      continue
    }
    if (/^\/ready-for-review\b/i.test(line)) {
      task.status = 'submitted'
      touched.push('status:submitted')
    }
  }

  if (touched.length === 0) {
    return { success: true, detail: `issue_comment had no executable commands for issue #${issueNumber}` }
  }

  task.updatedAt = new Date().toISOString()
  await saveTaskBountiesDb(tasks)
  await createGitHubIssueComment(
    owner,
    repo,
    issueNumber,
    `Commands executed: ${touched.join(', ')}`
  )
  return { success: true, detail: `issue_comment updated task ${task.id}`, touched }
}

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
    await recordIntegrationRunDb('github_issue_sync', 'failure', 'GitHub webhook signature verification failed')
    return NextResponse.json({ success: false, detail: 'Signature verification failed' }, { status: 401 })
  }

  const event = req.headers.get('x-github-event')
  const payload = JSON.parse(rawBody)
  const replayAttempt = req.headers.get('x-workflow-replay-attempt')
  const idempotencyKey = buildWebhookIdempotencyKey({
    provider: 'github',
    deliveryId: req.headers.get('x-github-delivery') || undefined,
    replayAttempt,
    fallbackParts: [event || 'unknown', rawBody]
  })

  try {
    const executed = await executeWorkflowEvent({
      eventType: `github.webhook.${event || 'unknown'}`,
      actorType: 'webhook',
      actorId: req.headers.get('x-github-delivery') || undefined,
      idempotencyKey,
      payload: {
        replayRequest: {
          path: '/api/integrations/github/webhook',
          method: 'POST',
          body: rawBody,
          headers: {
            'x-github-event': event || '',
            'x-hub-signature-256': signature || '',
            'x-github-delivery': req.headers.get('x-github-delivery') || ''
          }
        }
      },
      handler: async () => {
        if (event === 'issues') {
          const result = await handleIssueEvent(payload as WebhookIssuePayload)
          await recordIntegrationRunDb('github_issue_sync', result.success ? 'success' : 'failure', result.detail)
          return result
        }

        if (event === 'pull_request') {
          const prPayload = payload as WebhookPullRequestPayload
          if (prPayload.action === 'closed' && prPayload.pull_request?.merged) {
            const result = await handleMergedPullRequest(prPayload)
            await recordIntegrationRunDb('github_issue_sync', result.success ? 'success' : 'failure', result.detail)
            return result
          }
          return { success: true, detail: `Ignored pull_request action=${prPayload.action}` }
        }

        if (event === 'issue_comment') {
          const result = await handleIssueCommentEvent(payload as WebhookIssueCommentPayload)
          await recordIntegrationRunDb('github_issue_sync', result.success ? 'success' : 'failure', result.detail)
          return result
        }

        return { success: true, detail: `Ignored GitHub event=${event || 'unknown'}` }
      }
    })

    if (executed.duplicate) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        workflowEventId: executed.event.id,
        result: executed.result || executed.event.result || null
      })
    }

    const result = executed.result
    return NextResponse.json({
      ...result,
      workflowEventId: executed.event?.id
    }, { status: result.success ? 200 : 400 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await recordIntegrationRunDb('github_issue_sync', 'failure', detail)
    return NextResponse.json({ success: false, detail }, { status: 500 })
  }
}
