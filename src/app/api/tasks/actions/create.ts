import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  getCompanyContext,
  hasCompanyCapability,
  isPlatformAdmin,
  SessionUser
} from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import {
  extractRewardFromLabels,
  extractRewardTokenFromLabels,
  extractWalletFromLabels
} from '@/lib/claims'
import {
  extractAcceptanceCriteriaCandidate,
  extractLarkDocUrlCandidate,
  extractRequirementIdCandidate,
  generateRequirementIdCandidate,
  syncRequirementBindingFromTaskAsync
} from '@/lib/repositories/requirement-binding-repository'
import { syncSettlementCaseFromTask } from '@/lib/repositories/settlement-case-repository'
import { getRepoConfigByIdDb, listTaskBountiesDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  isValidLarkDocUrl,
  normalizeOptionalString
} from '../helpers'

export async function handleCreate(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext
): Promise<NextResponse> {
  const now = new Date().toISOString()
  const companyContext = await getCompanyContext(session, body.companyId ? String(body.companyId) : session.activeCompanyId)
  if (!companyContext && !isPlatformAdmin(session)) {
    return NextResponse.json({ error: 'Please select a company context before creating a task' }, { status: 400 })
  }
  if (!isPlatformAdmin(session) && !hasCompanyCapability(companyContext?.membership?.role, 'task.create')) {
    return NextResponse.json({ error: 'Current role does not have permission to create tasks' }, { status: 403 })
  }
  const labels: string[] = (body.labels as string[]) || []
  const walletFromLabel = extractWalletFromLabels(labels)
  const rewardFromLabel = extractRewardFromLabels(labels)
  const rewardToken = extractRewardTokenFromLabels(labels) || (body.rewardToken as string) || 'USD1'
  const repoConfigId = body.repoConfigId ? String(body.repoConfigId) : undefined
  const repoConfig = repoConfigId ? await getRepoConfigByIdDb(repoConfigId) : undefined
  if (repoConfigId && !repoConfig) {
    return NextResponse.json({ error: 'repoConfigId does not exist' }, { status: 400 })
  }
  const tasks = await listTaskBountiesDb()
  const requirementDocUrl = normalizeOptionalString(body.requirementDocUrl) || extractLarkDocUrlCandidate(body.description as string)
  if (requirementDocUrl && !isValidLarkDocUrl(requirementDocUrl)) {
    return NextResponse.json({ error: 'requirementDocUrl must be a valid Lark/Feishu document link' }, { status: 400 })
  }
  const requirementId = normalizeOptionalString(body.requirementId)?.toUpperCase()
    || extractRequirementIdCandidate(body.title as string, body.description as string, body.requirementDocTitle as string)
    || generateRequirementIdCandidate(tasks)
  const acceptanceCriteriaSnapshot = Array.isArray(body.acceptanceCriteria)
    ? (body.acceptanceCriteria as unknown[]).map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : extractAcceptanceCriteriaCandidate(String(body.description || ''))

  const task: TaskBounty = {
    id: uuidv4(),
    title: (body.title as string) || 'Untitled Requirement Task',
    description: (body.description as string) || '',
    requirementId: requirementDocUrl ? requirementId : undefined,
    requirementDocUrl,
    requirementDocTitle: requirementDocUrl ? (normalizeOptionalString(body.requirementDocTitle) || (body.title as string) || 'Untitled Requirement Document') : undefined,
    requirementSummarySnapshot: normalizeOptionalString(body.description) || 'Please provide complete requirement background, deliverables, and acceptance criteria.',
    acceptanceCriteriaSnapshot,
    companyId: body.companyId ? String(body.companyId) : companyContext?.company.id,
    companyName: body.companyName ? String(body.companyName) : companyContext?.company.name,
    createdByUserId: session.userId,
    createdByRole: session.activeCompanyRole || session.role,
    source: 'internal',
    rewardAmount: Number(body.rewardAmount || rewardFromLabel || 0),
    rewardToken,
    labels,
    repo: repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : ((body.repo as string) || ''),
    repoConfigId,
    repoVisibility: undefined,
    deliveryMode: undefined,
    mirrorRepoUrl: undefined,
    developerName: (body.developerName as string) || 'Internal Owner',
    externalUserId: undefined,
    developerWallet: walletFromLabel ?? (body.developerWallet as string) ?? '',
    status: 'open',
    createdAt: now,
    updatedAt: now
  }

  tasks.push(task)
  await syncRequirementBindingFromTaskAsync(task)
  await saveTaskBountiesDb(tasks)
  await syncSettlementCaseFromTask(task)
  return NextResponse.json(task)
}
