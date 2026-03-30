import { NextResponse } from 'next/server'
import {
  getCompanyContext,
  isPlatformAdmin,
  requireRoles
} from '@/lib/auth'
import {
  listTaskBountiesDb,
  getTaskBountyByIdDb,
  saveTaskBountiesDb
} from '@/lib/runtime-data-db'
import { paginateArray, parsePaginationParams } from '@/lib/pagination'
import { syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import {
  inferTaskSource,
  normalizeTaskForClaiming,
  sameWalletAddress
} from './helpers'
import { handleCreate } from './actions/create'
import { handlePromote } from './actions/promote'
import { handleClaim } from './actions/claim'
import { handleLockReward } from './actions/lock-reward'
import { handleSubmit } from './actions/submit'
import { handleAutoPayout } from './actions/auto-payout'
import { handleManualReviewApprove } from './actions/manual-review-approve'
import { handleFinanceApprove } from './actions/finance-approve'
import { handleManualReviewReject } from './actions/manual-review-reject'
import { handleExecutePayout } from './actions/execute-payout'
import { handleRetryPayout } from './actions/retry-payout'
import { parseBody } from '@/lib/validation'
import { taskActionSchemas } from './schemas'

function listClaimableExternalTasks(
  tasks: Awaited<ReturnType<typeof listTaskBountiesDb>>,
  session: {
    githubLogin?: string
    walletAddress?: string
  }
) {
  const githubLogin = session.githubLogin?.toLowerCase()
  return tasks.filter((task) =>
    task.source === 'external'
    && Boolean(task.githubIssueUrl || task.repo)
    && (
      !task.claimedByGithubLogin
      || task.claimedByGithubLogin === githubLogin
      || task.developerName?.toLowerCase() === githubLogin
      || sameWalletAddress(task.developerWallet, session.walletAddress)
    )
  )
}

export async function GET(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff', 'external_contributor'])
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const view = url.searchParams.get('view')
  const tasks = (await listTaskBountiesDb()).map((task) => ({ ...task, source: inferTaskSource(task) }))
  const normalized = tasks.some((task) => normalizeTaskForClaiming(task))
  if (normalized) {
    await saveTaskBountiesDb(tasks)
    await Promise.all(tasks.map((task) => syncSettlementCaseFromTask(task)))
  }
  if (view === 'claimable_external') {
    const visible = listClaimableExternalTasks(tasks, auth.session)
    return NextResponse.json(pagination ? paginateArray(visible, pagination) : visible)
  }
  if (auth.session.role === 'external_contributor') {
    if (auth.session.externalAuthType === 'github_code_bounty') {
      const visible = listClaimableExternalTasks(tasks, auth.session)
      return NextResponse.json(pagination ? paginateArray(visible, pagination) : visible)
    }

    const mine = tasks.filter((t) =>
      t.externalUserId === auth.session.userId
      || (auth.session.githubLogin && t.developerName === auth.session.githubLogin)
      || sameWalletAddress(t.developerWallet, auth.session.walletAddress)
    )
    return NextResponse.json(pagination ? paginateArray(mine, pagination) : mine)
  }
  if (isPlatformAdmin(auth.session)) return NextResponse.json(pagination ? paginateArray(tasks, pagination) : tasks)
  const companyContext = await getCompanyContext(auth.session)
  if (!companyContext) {
    return NextResponse.json({ error: 'Please select a valid company context first' }, { status: 400 })
  }
  const filtered = tasks.filter((task) => !task.companyId || task.companyId === companyContext.company.id)
  return NextResponse.json(pagination ? paginateArray(filtered, pagination) : filtered)
}

export async function POST(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff', 'external_contributor'])
  if (!auth.ok) return auth.response
  const body = await req.json().catch(() => ({}))
  const action = body.action || 'create'

  // Validate body against the per-action schema when one exists
  const actionSchema = taskActionSchemas[action]
  if (actionSchema) {
    const validation = parseBody(actionSchema, body)
    if (!validation.success) return validation.response
  }

  if (auth.session.role === 'external_contributor' && !['submit', 'claim'].includes(action)) {
    return NextResponse.json({ error: 'External contributors can only claim or submit delivery information' }, { status: 403 })
  }

  // 'create' does not require an existing task
  if (action === 'create') {
    return handleCreate(body, auth.session, null)
  }

  // All other actions require an existing task
  const tasks = await listTaskBountiesDb()
  const task = tasks.find((t) => t.id === body.taskId) || await getTaskBountyByIdDb(String(body.taskId || ''))
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // promoteToExternal has its own internal permission check
  if (action === 'promoteToExternal') {
    if (task.source !== 'internal') {
      return NextResponse.json({ error: 'This task is already an external bounty' }, { status: 400 })
    }
    return handlePromote(body, auth.session, null, task, tasks)
  }

  // External contributor access gate for remaining actions
  if (auth.session.role === 'external_contributor') {
    const canAccess = task.externalUserId === auth.session.userId
      || (auth.session.githubLogin && task.developerName === auth.session.githubLogin)
      || (!task.claimedByGithubLogin && auth.session.externalAuthType === 'github_code_bounty')
      || (auth.session.walletAddress && task.developerWallet.toLowerCase() === auth.session.walletAddress.toLowerCase())
    if (!canAccess) return NextResponse.json({ error: 'You can only submit your own tasks' }, { status: 403 })
  }

  const companyContext = await getCompanyContext(auth.session, task.companyId || auth.session.activeCompanyId)

  const handlers: Record<string, Function> = {
    claim: handleClaim,
    lockReward: handleLockReward,
    submit: handleSubmit,
    autoPayout: handleAutoPayout,
    manualReviewApprove: handleManualReviewApprove,
    financeApprove: handleFinanceApprove,
    manualReviewReject: handleManualReviewReject,
    executePayout: handleExecutePayout,
    retryPayout: handleRetryPayout
  }

  const handler = handlers[action]
  if (!handler) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  return handler(body, auth.session, companyContext, task, tasks)
}
