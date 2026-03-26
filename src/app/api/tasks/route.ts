import { NextResponse } from 'next/server'
import { loadTaskBounties, saveTaskBounties, loadPayments, savePayments, loadRepoConfigs } from '@/lib/storage'
import { reviewTaskBounty, reviewTaskRequirementClarity } from '@/lib/ai'
import { transferWithWLFI } from '@/lib/wlfi'
import { TaskBounty } from '@/lib/types'
import { checkGitHubPrMerged } from '@/lib/integrations'
import { requireRoles } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'

function extractRewardFromLabels(labels: string[]): number | null {
  for (const label of labels) {
    const match = label.match(/^bounty:\$?(\d+)(?:USDT|U)?$/i)
    if (match) return Number(match[1])
  }
  return null
}

function extractWalletFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^wallet:(0x[a-fA-F0-9]{6,})$/i)
    if (match) return match[1]
  }
  return null
}

function extractClaimFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^claim:@?([a-zA-Z0-9-]+)$/i)
    if (match) return match[1].toLowerCase()
  }
  return null
}

function upsertLabel(labels: string[], nextLabel: string, matcher: RegExp): string[] {
  const filtered = labels.filter((label) => !matcher.test(label))
  return Array.from(new Set([...filtered, nextLabel]))
}

export async function GET(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff', 'external_contributor'])
  if (!auth.ok) return auth.response

  const tasks = loadTaskBounties().map((task) => {
    if (task.source) return task
    const labels = task.labels || []
    const inferredSource: 'internal' | 'external' =
      labels.includes('external-task') || labels.some((x) => /^bounty:/i.test(x)) ? 'external' : 'internal'
    return { ...task, source: inferredSource }
  })
  if (auth.session.role === 'external_contributor') {
    const mine = tasks.filter((t) =>
      t.externalUserId === auth.session.userId
      || (auth.session.githubLogin && t.developerName === auth.session.githubLogin)
      || (auth.session.walletAddress && t.developerWallet.toLowerCase() === auth.session.walletAddress.toLowerCase())
    )
    return NextResponse.json(mine)
  }
  return NextResponse.json(tasks)
}

export async function POST(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff', 'external_contributor'])
  if (!auth.ok) return auth.response
  const body = await req.json()
  const action = body.action || 'create'

  if (auth.session.role === 'external_contributor' && action !== 'submit') {
    return NextResponse.json({ error: '外部协作者仅可提交交付信息' }, { status: 403 })
  }

  if (action === 'create') {
    const now = new Date().toISOString()
    const labels: string[] = body.labels || []
    const walletFromLabel = extractWalletFromLabels(labels)
    const source: 'internal' | 'external' = 'internal'
    if (body.source === 'external') {
      return NextResponse.json({ error: '外部悬赏任务必须从 Meegle 同步的内部任务转化，不能直接新建' }, { status: 400 })
    }
    const repoConfigId = body.repoConfigId ? String(body.repoConfigId) : undefined
    const repoConfig = repoConfigId ? loadRepoConfigs().find((r) => r.id === repoConfigId) : undefined
    if (repoConfigId && !repoConfig) {
      return NextResponse.json({ error: 'repoConfigId 不存在' }, { status: 400 })
    }

    const task: TaskBounty = {
      id: uuidv4(),
      title: body.title || '未命名需求任务',
      description: body.description || '',
      source,
      rewardAmount: Number(body.rewardAmount || 0),
      rewardToken: body.rewardToken || 'USDT',
      labels,
      repo: repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : (body.repo || ''),
      repoConfigId,
      repoVisibility: undefined,
      deliveryMode: undefined,
      mirrorRepoUrl: undefined,
      backportStatus: undefined,
      developerName: body.developerName || 'Internal Owner',
      externalUserId: undefined,
      developerWallet: walletFromLabel ?? body.developerWallet ?? '',
      status: 'open',
      createdAt: now,
      updatedAt: now
    }

    const tasks = loadTaskBounties()
    tasks.push(task)
    saveTaskBounties(tasks)
    return NextResponse.json(task)
  }

  const tasks = loadTaskBounties()
  const task = tasks.find((t) => t.id === body.taskId)
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  if (action === 'promoteToExternal') {
    if (!['admin', 'reviewer', 'finance', 'staff'].includes(auth.session.role)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    if (!task.id.startsWith('meegle-')) {
      return NextResponse.json({ error: '仅支持从 Meegle 同步任务转外部悬赏' }, { status: 400 })
    }
    if (task.source !== 'internal') {
      return NextResponse.json({ error: '该任务已是外部悬赏' }, { status: 400 })
    }
    const nextDescription = String(body.description || body.requirementDescription || task.description || '').trim()
    if (nextDescription) {
      task.description = nextDescription
    }
    const repoConfigId = body.repoConfigId ? String(body.repoConfigId) : undefined
    const repoConfig = repoConfigId ? loadRepoConfigs().find((r) => r.id === repoConfigId) : undefined
    if (repoConfigId && !repoConfig) {
      return NextResponse.json({ error: 'repoConfigId 不存在' }, { status: 400 })
    }
    const clarity = await reviewTaskRequirementClarity(task.title, task.description, {
      taskId: task.id,
      repo: repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : (body.repo || task.repo || ''),
      branch: repoConfig?.defaultBranch || 'main',
      repoVisibility: body.repoVisibility === 'private' ? 'private' : 'public',
      deliveryMode: body.deliveryMode === 'private_collab_pr' || body.deliveryMode === 'patch_bundle'
        ? body.deliveryMode
        : 'public_mirror_pr'
    })
    task.requirementClarityScore = clarity.score
    task.requirementClaritySummary = clarity.summary
    task.requirementModelUsed = clarity.meta.modelUsed
    task.requirementConfidence = clarity.meta.confidence
    task.requirementGateDecision = clarity.meta.gateDecision
    task.requirementCriticFindings = clarity.meta.criticFindings
    task.requirementEvidenceRefs = clarity.meta.evidenceRefs
    task.requirementClarityStatus = clarity.clear ? 'clear' : 'needs_refinement'
    if (!clarity.clear) {
      task.updatedAt = new Date().toISOString()
      saveTaskBounties(tasks)
      return NextResponse.json({
        success: false,
        error: '需求不够明确，已阻止外部悬赏发布，请先补充需求',
        requirementClarity: clarity,
        task
      }, { status: 400 })
    }

    let labels = Array.from(new Set([...(task.labels || []), 'external-task', `bounty:$${Number(body.rewardAmount || 50)}`]))
    if (body.autoPayout !== false) {
      labels = Array.from(new Set([...labels, 'auto-payout:on']))
    }
    const walletAddress = String(body.walletAddress || '').trim()
    if (walletAddress) {
      labels = upsertLabel(labels, `wallet:${walletAddress}`, /^wallet:/i)
      task.developerWallet = walletAddress
    }
    const claimGithubLogin = String(body.claimGithubLogin || '').trim().replace(/^@/, '').toLowerCase()
    if (claimGithubLogin) {
      labels = upsertLabel(labels, `claim:@${claimGithubLogin}`, /^claim:/i)
      task.claimedByGithubLogin = claimGithubLogin
      task.developerName = claimGithubLogin
    }
    task.source = 'external'
    task.rewardAmount = Number(body.rewardAmount || 50)
    task.rewardToken = body.rewardToken || 'USDT'
    task.labels = labels
    task.repoConfigId = repoConfigId
    task.repo = repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : (body.repo || task.repo || '')
    task.repoVisibility = body.repoVisibility === 'private' ? 'private' : 'public'
    task.deliveryMode = body.deliveryMode === 'private_collab_pr' || body.deliveryMode === 'patch_bundle'
      ? body.deliveryMode
      : 'public_mirror_pr'
    task.mirrorRepoUrl = body.mirrorRepoUrl || task.mirrorRepoUrl || ''
    task.backportStatus = task.deliveryMode === 'public_mirror_pr' ? 'pending' : undefined
    task.updatedAt = new Date().toISOString()
    saveTaskBounties(tasks)
    return NextResponse.json({ success: true, task, requirementClarity: clarity })
  }
  if (auth.session.role === 'external_contributor') {
    const canAccess = task.externalUserId === auth.session.userId
      || (auth.session.githubLogin && task.developerName === auth.session.githubLogin)
      || (auth.session.walletAddress && task.developerWallet.toLowerCase() === auth.session.walletAddress.toLowerCase())
    if (!canAccess) return NextResponse.json({ error: '仅可提交你自己的任务' }, { status: 403 })
  }

  if (action === 'submit') {
    if (auth.session.role === 'external_contributor' && auth.session.externalAuthType === 'github_code_bounty') {
      if (!auth.session.walletAddress) {
        return NextResponse.json({ error: '请先在外部门户绑定钱包地址，再提交代码悬赏交付' }, { status: 400 })
      }
      const githubLogin = auth.session.githubLogin?.toLowerCase()
      const claimedBy = extractClaimFromLabels(task.labels || [])
      if (claimedBy && githubLogin && claimedBy !== githubLogin) {
        return NextResponse.json({ error: `该任务已被 @${claimedBy} 认领，当前账号无权提交` }, { status: 403 })
      }
      if (!claimedBy && githubLogin) {
        task.labels = Array.from(new Set([...(task.labels || []), `claim:@${githubLogin}`]))
        task.claimedByGithubLogin = githubLogin
        task.developerName = githubLogin
      }
      if (!task.developerWallet) {
        task.developerWallet = auth.session.walletAddress
      }
    }
    const nextPrUrl = body.prUrl || task.prUrl
    const nextCommitSha = body.commitSha || task.commitSha
    if (task.repoVisibility === 'public') {
      if (!nextPrUrl || !/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(nextPrUrl)) {
        return NextResponse.json({ error: '公有仓提交必须提供 GitHub PR 链接（/pull/）' }, { status: 400 })
      }
    }
    if (task.repoVisibility === 'private') {
      if (!nextCommitSha) {
        return NextResponse.json({ error: '私有仓提交必须提供 commit SHA（PR 链接可选）' }, { status: 400 })
      }
    }
    task.prUrl = nextPrUrl
    task.commitSha = nextCommitSha
    task.ciPassed = Boolean(body.ciPassed)
    task.status = 'ai_reviewing'
    const { aiScore, summary, inferPopup, meta } = await reviewTaskBounty(task)
    task.aiScore = aiScore
    task.aiReviewSummary = summary
    task.aiModelUsed = meta.modelUsed
    task.aiConfidence = meta.confidence
    task.aiGateDecision = meta.gateDecision
    task.aiCriticFindings = meta.criticFindings
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    saveTaskBounties(tasks)
    return NextResponse.json({ success: true, task, inferPopup })
  }

  if (action === 'autoPayout') {
    if (!['admin', 'reviewer', 'finance', 'staff'].includes(auth.session.role)) {
      return NextResponse.json({ error: '无支付权限' }, { status: 403 })
    }
    const payout = await tryAutoPayout(task, { mergedOverride: body.merged, riskPassed: body.riskPassed !== false })
    saveTaskBounties(tasks)
    if (!payout.success) {
      return NextResponse.json({ success: false, error: payout.error, checks: payout.checks }, { status: 400 })
    }

    const payments = loadPayments()
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
      memo: `[TaskBounty] ${task.title} 自动悬赏`,
      timestamp: new Date().toISOString()
    })
    savePayments(payments)
    return NextResponse.json({ success: true, task, txHash: payout.txHash })
  }

  if (action === 'markBackportDone') {
    if (!['admin', 'reviewer', 'finance', 'staff'].includes(auth.session.role)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    task.backportStatus = 'done'
    task.backportCommitSha = body.backportCommitSha || task.backportCommitSha || ''
    task.updatedAt = new Date().toISOString()
    saveTaskBounties(tasks)
    return NextResponse.json({ success: true, task })
  }

  return NextResponse.json({ error: '不支持的 action' }, { status: 400 })
}

export async function tryAutoPayout(
  task: TaskBounty,
  options: { mergedOverride?: boolean; riskPassed: boolean }
): Promise<{ success: boolean; error?: string; checks?: Record<string, unknown>; txHash?: string }> {
  const inferredSource = task.source || ((task.labels || []).some((x) => x === 'external-task' || /^bounty:/i.test(x)) ? 'external' : 'internal')
  if (inferredSource !== 'external') {
    return { success: false, error: '内部指定任务不走自动悬赏支付' }
  }
  const labels = task.labels || []
  const hasAuto = labels.includes('auto-payout:on')
  const rewardFromLabel = extractRewardFromLabels(labels)
  const walletFromLabel = extractWalletFromLabels(labels)
  const claimedBy = extractClaimFromLabels(labels)
  if (!hasAuto) return { success: false, error: '缺少 auto-payout:on 标签' }
  if (!rewardFromLabel) return { success: false, error: '缺少 bounty:$xx 标签' }
  if (!walletFromLabel) return { success: false, error: '缺少 wallet:0x... 标签' }
  if (!claimedBy) return { success: false, error: '缺少 claim:@github_login 标签（未认领）' }
  if ((task.developerName || '').toLowerCase() !== claimedBy) {
    return { success: false, error: `认领人与交付人不一致（claim:@${claimedBy} vs developer:${task.developerName || '-'})` }
  }

  const ciPassed = task.ciPassed === true
  const aiPassed = (task.aiScore || 0) >= 85
  const aiGatePassed = task.aiGateDecision ? task.aiGateDecision === 'pass' : aiPassed
  const riskPassed = options.riskPassed
  const deliveryMode = task.deliveryMode || 'public_mirror_pr'

  let merged = Boolean(options.mergedOverride)
  let mergedDetail = '使用本地覆盖值'
  if (!options.mergedOverride) {
    if (!task.prUrl) {
      merged = false
      mergedDetail = '缺少 prUrl'
    } else {
      const mergedCheck = await checkGitHubPrMerged(task.prUrl)
      merged = mergedCheck.merged
      mergedDetail = mergedCheck.detail
    }
  }

  if (deliveryMode === 'patch_bundle' && !task.commitSha) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return { success: false, error: 'patch_bundle 模式缺少 commitSha，需内部导入后再支付' }
  }

  if (deliveryMode === 'public_mirror_pr' && task.backportStatus !== 'done') {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return { success: false, error: 'public_mirror_pr 模式要求主仓回灌完成（backportStatus=done）' }
  }

  if (deliveryMode === 'private_collab_pr' && !merged) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return { success: false, error: 'private_collab_pr 模式要求私有仓 PR 已合并', checks: { merged, mergedDetail } }
  }

  if (!merged || !ciPassed || !aiPassed || !aiGatePassed || !riskPassed) {
    task.status = 'awaiting_acceptance'
    task.updatedAt = new Date().toISOString()
    return {
      success: false,
      error: '自动支付条件未满足，已转待人工验收',
      checks: { merged, ciPassed, aiPassed, aiGatePassed, riskPassed, mergedDetail, aiGateDecision: task.aiGateDecision, aiCriticFindings: task.aiCriticFindings }
    }
  }

  const transfer = await transferWithWLFI(walletFromLabel, rewardFromLabel, `[TaskBounty] ${task.title} 自动悬赏`)
  if (!transfer.success) return { success: false, error: transfer.error || '支付失败' }

  task.status = 'paid'
  task.rewardAmount = rewardFromLabel
  task.developerWallet = walletFromLabel
  task.riskDecision = 'pass'
  task.txHash = transfer.txHash
  task.paidAt = new Date().toISOString()
  task.updatedAt = new Date().toISOString()
  return { success: true, txHash: transfer.txHash }
}
