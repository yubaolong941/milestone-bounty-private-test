import { NextResponse } from 'next/server'
import { loadInternalMemberBindings, loadRepoConfigs, loadTaskBounties, saveTaskBounties } from '@/lib/storage'
import { TaskBounty } from '@/lib/types'
import { fetchMeegleIssuesFromMcp, verifySimpleWebhookSecret } from '@/lib/integrations'
import { v4 as uuidv4 } from 'uuid'

function upsertFromIssue(input: { issueId: string; title?: string; description?: string; labels?: string[]; assignee?: string }) {
  const issueId = input.issueId
  const labels: string[] = input.labels || []
  if (!issueId) return { success: true, ignored: true }
  const isExternalTask = labels.includes('external-task') || labels.some((x) => /^bounty:/i.test(x)) || labels.includes('auto-payout:on')

  const binding = input.assignee
    ? loadInternalMemberBindings().find((x) => x.enabled && x.meegleAssignee === input.assignee)
    : undefined
  const repoConfig = binding?.repoConfigId ? loadRepoConfigs().find((r) => r.id === binding.repoConfigId) : undefined

  const tasks = loadTaskBounties()
  const existed = tasks.find((t) => t.id.startsWith(`meegle-${issueId}`))
  if (existed) {
    existed.title = input.title || existed.title
    existed.description = input.description || existed.description
    existed.labels = labels.length ? labels : existed.labels
    existed.source = isExternalTask ? 'external' : 'internal'
    existed.meegleIssueId = issueId
    existed.meegleAssignee = input.assignee || existed.meegleAssignee
    existed.internalGithubLogin = binding?.githubLogin || existed.internalGithubLogin
    if (binding?.repoConfigId) existed.repoConfigId = binding.repoConfigId
    if (binding?.repo) existed.repo = binding.repo
    else if (repoConfig) existed.repo = `${repoConfig.owner}/${repoConfig.repo}`
    if (!isExternalTask) {
      existed.rewardAmount = 0
      existed.developerWallet = ''
    }
    existed.updatedAt = new Date().toISOString()
    saveTaskBounties(tasks)
    return { success: true, updated: true, taskId: existed.id }
  }

  const task: TaskBounty = {
    id: `meegle-${issueId}-${uuidv4().slice(0, 8)}`,
    title: input.title || 'Meegle 需求任务',
    description: input.description || '',
    source: isExternalTask ? 'external' : 'internal',
    rewardAmount: isExternalTask ? 50 : 0,
    rewardToken: 'USDT',
    labels,
    developerName: input.assignee || (isExternalTask ? 'External Dev' : 'Internal Owner'),
    meegleIssueId: issueId,
    meegleAssignee: input.assignee || '',
    internalGithubLogin: binding?.githubLogin,
    repoConfigId: binding?.repoConfigId,
    repo: binding?.repo || (repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : undefined),
    developerWallet: isExternalTask ? '' : '',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  tasks.push(task)
  saveTaskBounties(tasks)
  return { success: true, created: true, taskId: task.id }
}

export async function GET() {
  const { issues, detail } = await fetchMeegleIssuesFromMcp()
  if (!issues.length) return NextResponse.json({ success: false, detail }, { status: 400 })

  let created = 0
  let updated = 0
  for (const issue of issues) {
    const result = upsertFromIssue({
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      labels: issue.labels,
      assignee: issue.assignee
    })
    if ('created' in result && result.created) created += 1
    if ('updated' in result && result.updated) updated += 1
  }
  return NextResponse.json({ success: true, mode: 'mcp', detail, created, updated })
}

export async function POST(req: Request) {
  const body = await req.json()
  if (body?.action === 'syncFromMcp') {
    return GET()
  }

  const secretOk = verifySimpleWebhookSecret(
    req.headers.get('x-meegle-secret'),
    process.env.MEEGLE_WEBHOOK_SECRET
  )
  if (!secretOk) return NextResponse.json({ error: 'meegle webhook 验签失败' }, { status: 401 })
  const issueId = body?.issueId || body?.id
  const result = upsertFromIssue({
    issueId,
    title: body?.title,
    description: body?.description,
    labels: body?.labels || [],
    assignee: body?.assignee
  })
  return NextResponse.json({ ...result, mode: 'webhook' })
}
