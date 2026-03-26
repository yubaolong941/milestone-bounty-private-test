import { NextResponse } from 'next/server'
import { loadTaskBounties, saveTaskBounties, loadRepoConfigs, loadPayments, savePayments } from '@/lib/storage'
import { extractTaskIdsFromMessage, updateMeegleIssueStatusByMcp } from '@/lib/integrations'
import { tryAutoPayout } from '@/app/api/tasks/route'
import { v4 as uuidv4 } from 'uuid'

interface GitHubCommit {
  sha: string
  author?: { login?: string } | null
  commit?: {
    message?: string
  }
}

function extractClaimFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^claim:@?([a-zA-Z0-9-]+)$/i)
    if (match) return match[1].toLowerCase()
  }
  return null
}

async function syncFromInternalRepo() {
  const fallbackRepo = process.env.GITHUB_INTERNAL_REPO_FULL_NAME
  const token = process.env.GITHUB_TOKEN
  const perPage = Number(process.env.GITHUB_SYNC_COMMITS_PER_PAGE || '30')

  const repoConfigs = loadRepoConfigs().filter((r) => r.enabled)
  const targets = repoConfigs.length > 0
    ? repoConfigs.map((r) => ({ id: r.id, repo: `${r.owner}/${r.repo}`, branch: r.defaultBranch || 'main' }))
    : (fallbackRepo ? [{ id: 'env-fallback', repo: fallbackRepo, branch: process.env.GITHUB_INTERNAL_REPO_BRANCH || 'main' }] : [])

  if (!targets.length) return { success: false, detail: '未配置仓库（repo config 或 GITHUB_INTERNAL_REPO_FULL_NAME）', updated: 0 }
  if (!token) return { success: false, detail: '未配置 GITHUB_TOKEN', updated: 0 }

  const tasks = loadTaskBounties()
  const updates = new Set<string>()
  let scannedCommits = 0

  for (const target of targets) {
    const [owner, repoName] = target.repo.split('/')
    if (!owner || !repoName) continue

    const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits?sha=${encodeURIComponent(target.branch)}&per_page=${Math.max(1, Math.min(perPage, 100))}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    })
    if (!res.ok) continue
    const commits = (await res.json()) as GitHubCommit[]
    scannedCommits += commits.length

    for (const c of commits) {
      const message = c.commit?.message || ''
      const taskIds = extractTaskIdsFromMessage(message)
      for (const taskId of taskIds) {
        const task = tasks.find((t) => t.id === taskId)
        if (!task) continue
        if (task.repoConfigId && task.repoConfigId !== target.id) continue
        if (task.internalGithubLogin && c.author?.login && task.internalGithubLogin !== c.author.login) continue
        if (task.source === 'external' && c.author?.login) {
          const author = c.author.login.toLowerCase()
          const claimedBy = extractClaimFromLabels(task.labels || [])
          if (claimedBy && claimedBy !== author) {
            task.status = 'awaiting_acceptance'
            task.aiCriticFindings = Array.from(new Set([...(task.aiCriticFindings || []), `认领人@${claimedBy}与提交人@${author}不一致`]))
            task.updatedAt = new Date().toISOString()
            updates.add(task.id)
            continue
          }
          // First valid author claims task if no explicit claim exists.
          if (!claimedBy) {
            task.labels = Array.from(new Set([...(task.labels || []), `claim:@${author}`]))
            task.claimedByGithubLogin = author
          }
          task.developerName = author
          if (task.status === 'open') task.status = 'in_progress'
        }
        task.backportStatus = 'done'
        task.backportCommitSha = c.sha
        if (task.source === 'internal') {
          task.status = 'in_progress'
          task.pendingMeegleStatus = 'in_progress'
        }
        task.updatedAt = new Date().toISOString()
        updates.add(task.id)
      }
    }

    for (const task of tasks) {
      if (!task.commitSha) continue
      if (task.repoConfigId && task.repoConfigId !== target.id) continue
      if (commits.some((c) => c.sha === task.commitSha)) {
        if (task.deliveryMode === 'public_mirror_pr') {
          task.backportStatus = 'done'
          task.backportCommitSha = task.commitSha
        }
        if (task.source === 'internal') {
          task.status = 'in_progress'
          task.pendingMeegleStatus = 'in_progress'
        }
        task.updatedAt = new Date().toISOString()
        updates.add(task.id)
      }
    }

    for (const c of commits) {
      const message = (c.commit?.message || '').toLowerCase()
      if (!/(close|done|finish|resolved)/.test(message)) continue
      for (const task of tasks) {
        if (task.source !== 'internal') continue
        if (task.repoConfigId && task.repoConfigId !== target.id) continue
        if (!task.meegleIssueId) continue
        if (!message.includes(task.meegleIssueId.toLowerCase())) continue
        if (task.internalGithubLogin && c.author?.login && task.internalGithubLogin !== c.author.login) continue
        task.commitSha = c.sha
        task.status = 'submitted'
        task.pendingMeegleStatus = 'resolved'
        task.updatedAt = new Date().toISOString()
        updates.add(task.id)
      }
    }
  }

  const flowCandidates = tasks.filter((t) => t.source === 'internal' && t.pendingMeegleStatus && t.meegleIssueId)
  const writebackResults: Array<{ taskId: string; issueId: string; toStatus: string; success: boolean; detail: string }> = []
  for (const task of flowCandidates) {
    const result = await updateMeegleIssueStatusByMcp(task.meegleIssueId!, task.pendingMeegleStatus!)
    writebackResults.push({
      taskId: task.id,
      issueId: task.meegleIssueId!,
      toStatus: task.pendingMeegleStatus!,
      success: result.success,
      detail: result.detail
    })
    if (result.success) {
      task.pendingMeegleStatus = undefined
      task.updatedAt = new Date().toISOString()
      updates.add(task.id)
    }
  }

  // Auto payout on GitHub merge/sync: no manual trigger required.
  const autoPayoutResults: Array<{ taskId: string; success: boolean; detail: string; txHash?: string }> = []
  const payments = loadPayments()
  for (const task of tasks) {
    if (task.source !== 'external') continue
    if (task.status === 'paid') continue
    const labels = task.labels || []
    if (!labels.includes('auto-payout:on')) continue
    if (!labels.some((x) => /^bounty:\$/i.test(x))) continue
    if (!labels.some((x) => /^wallet:0x[a-fA-F0-9]{6,}$/i.test(x))) continue
    const payout = await tryAutoPayout(task, { mergedOverride: undefined, riskPassed: true })
    if (!payout.success) {
      autoPayoutResults.push({ taskId: task.id, success: false, detail: payout.error || '自动支付条件未满足' })
      continue
    }
    payments.push({
      id: uuidv4(),
      projectId: 'task-bounty',
      projectName: '需求悬赏',
      reportId: task.id,
      reportTitle: task.title,
      moduleType: 'bounty_task',
      amount: task.rewardAmount,
      toAddress: task.developerWallet,
      toName: task.developerName,
      txHash: payout.txHash!,
      memo: `[TaskBounty][GitHub Sync AutoPay] ${task.title}`,
      timestamp: new Date().toISOString()
    })
    autoPayoutResults.push({ taskId: task.id, success: true, detail: '自动打款成功', txHash: payout.txHash })
    updates.add(task.id)
  }

  if (autoPayoutResults.some((x) => x.success)) {
    savePayments(payments)
  }

  if (updates.size > 0) saveTaskBounties(tasks)

  return {
    success: true,
    detail: `GitHub sync 完成，扫描 ${targets.length} 个仓库 / ${scannedCommits} 个 commits`,
    updated: updates.size,
    flowCandidates: flowCandidates.map((t) => ({ taskId: t.id, meegleIssueId: t.meegleIssueId, toStatus: t.pendingMeegleStatus })),
    writebackResults,
    autoPayoutResults
  }
}

export async function GET() {
  const result = await syncFromInternalRepo()
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}

export async function POST() {
  return GET()
}
