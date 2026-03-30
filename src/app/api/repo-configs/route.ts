import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCompanyContext, requireAnyCompanyCapability, requireInternalUser } from '@/lib/auth'
import { resolveGitHubRequestHeaders } from '@/lib/integrations'
import { hasAnyCompanyCapability, isPlatformAdmin } from '@/lib/permissions'
import { deleteRepoConfigDb, getRepoConfigByIdDb, listRepoConfigsDb, recordIntegrationRunDb, upsertRepoConfigDb } from '@/lib/runtime-data-db'
import { parsePaginationParams } from '@/lib/pagination'
import { RepoConfig } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'
import { parseBody } from '@/lib/validation'

const createRepoConfigSchema = z.object({
  action: z.literal('create').optional(),
  owner: z.string().min(1, 'owner is required'),
  repo: z.string().min(1, 'repo is required'),
  companyId: z.string().optional(),
  defaultBranch: z.string().optional(),
  tokenRef: z.string().optional(),
  enabled: z.boolean().optional(),
  syncIntervalSec: z.number().optional()
}).passthrough()

const updateRepoConfigSchema = z.object({
  action: z.literal('update'),
  id: z.string().min(1, 'repo config id is required'),
  owner: z.string().optional(),
  repo: z.string().optional(),
  defaultBranch: z.string().optional(),
  tokenRef: z.string().optional(),
  enabled: z.boolean().optional(),
  syncIntervalSec: z.number().optional(),
  companyId: z.string().optional()
}).passthrough()

const idOnlyRepoConfigSchema = z.object({
  id: z.string().min(1, 'repo config id is required')
}).passthrough()

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const companyContext = await getCompanyContext(auth.session)
  const companyId = isPlatformAdmin(auth.session)
    ? req.headers.get('x-company-id') || auth.session.activeCompanyId
    : companyContext?.company.id
  if (!companyId && !isPlatformAdmin(auth.session)) {
    return NextResponse.json({ error: 'No active company context selected' }, { status: 403 })
  }
  if (companyContext && !isPlatformAdmin(auth.session) && !hasAnyCompanyCapability(companyContext.membership?.role, ['repo.manage', 'company.read'])) {
    return NextResponse.json({ error: 'Not authorized to view repository configurations' }, { status: 403 })
  }
  const items = await listRepoConfigsDb({ companyId, pagination: pagination || undefined })
  return NextResponse.json(pagination ? {
    items,
    pagination: { page: pagination.page, pageSize: pagination.pageSize }
  } : items)
}

export async function POST(req: Request) {
  const auth = await requireAnyCompanyCapability(req, ['repo.manage'])
  if (!auth.ok) return auth.response

  const body = await req.json()
  const action = body?.action || 'create'
  const companyContext = await getCompanyContext(auth.session, body?.companyId ? String(body.companyId) : auth.session.activeCompanyId)
  const companyId = isPlatformAdmin(auth.session)
    ? (body?.companyId ? String(body.companyId) : auth.session.activeCompanyId)
    : companyContext?.company.id

  if (action === 'create') {
    const validation = parseBody(createRepoConfigSchema, body)
    if (!validation.success) return validation.response
    if (!body?.owner || !body?.repo) return NextResponse.json({ error: 'Missing owner/repo' }, { status: 400 })
    if (!companyId) return NextResponse.json({ error: 'Please select a company context before creating a repository configuration' }, { status: 400 })
    const now = new Date().toISOString()
    const config: RepoConfig = {
      id: uuidv4(),
      companyId,
      provider: 'github',
      owner: String(body.owner).trim(),
      repo: String(body.repo).trim(),
      defaultBranch: String(body.defaultBranch || 'main').trim(),
      tokenRef: body.tokenRef ? String(body.tokenRef).trim() : undefined,
      enabled: body.enabled !== false,
      syncIntervalSec: body.syncIntervalSec ? Number(body.syncIntervalSec) : undefined,
      createdAt: now,
      updatedAt: now
    }
    await upsertRepoConfigDb(config)
    return NextResponse.json(config)
  }

  if (action === 'update') {
    const validation = parseBody(updateRepoConfigSchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const target = await getRepoConfigByIdDb(id)
    if (!target) return NextResponse.json({ error: 'Repo config not found' }, { status: 404 })
    if (companyId && target.companyId && target.companyId !== companyId && !isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Not authorized to modify another company\'s repo config' }, { status: 403 })
    }
    if (body.owner) target.owner = String(body.owner).trim()
    if (body.repo) target.repo = String(body.repo).trim()
    if (body.defaultBranch) target.defaultBranch = String(body.defaultBranch).trim()
    if (body.tokenRef !== undefined) target.tokenRef = body.tokenRef ? String(body.tokenRef).trim() : undefined
    if (body.enabled !== undefined) target.enabled = Boolean(body.enabled)
    if (body.syncIntervalSec !== undefined) target.syncIntervalSec = Number(body.syncIntervalSec) || undefined
    if (body.companyId !== undefined && isPlatformAdmin(auth.session)) target.companyId = body.companyId ? String(body.companyId) : undefined
    target.updatedAt = new Date().toISOString()
    await upsertRepoConfigDb(target)
    return NextResponse.json(target)
  }

  if (action === 'delete') {
    const validation = parseBody(idOnlyRepoConfigSchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const target = await getRepoConfigByIdDb(id)
    if (!target) return NextResponse.json({ error: 'Repo config not found' }, { status: 404 })
    if (companyId && target.companyId && target.companyId !== companyId && !isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Not authorized to delete another company\'s repo config' }, { status: 403 })
    }
    await deleteRepoConfigDb(id)
    return NextResponse.json({ success: true })
  }

  if (action === 'test') {
    const validation = parseBody(idOnlyRepoConfigSchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const target = await getRepoConfigByIdDb(id)
    if (!target) return NextResponse.json({ error: 'Repo config not found' }, { status: 404 })
    const headers = await resolveGitHubRequestHeaders(target.tokenRef)
    if (!headers) {
      await recordIntegrationRunDb('github_issue_sync', 'failure', `No GitHub Token configured for tokenRef; cannot verify repository connection: ${target.tokenRef || 'tokenRef not set'}`)
      return NextResponse.json({ error: target.tokenRef ? `No GitHub Token configured for tokenRef: ${target.tokenRef}` : 'Repo config has no tokenRef set; cannot verify repository connection' }, { status: 400 })
    }

    const repoRes = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}`, {
      headers
    })
    if (!repoRes.ok) {
      await recordIntegrationRunDb('github_issue_sync', 'failure', `Repository connection test failed: ${target.owner}/${target.repo} returned ${repoRes.status}`)
      return NextResponse.json({ success: false, error: `Repository is not accessible: ${repoRes.status}` }, { status: 400 })
    }

    const branchRes = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/branches/${encodeURIComponent(target.defaultBranch)}`,
      {
        headers
      }
    )
    if (!branchRes.ok) {
      await recordIntegrationRunDb('github_issue_sync', 'failure', `Branch connection test failed: ${target.owner}/${target.repo}#${target.defaultBranch} returned ${branchRes.status}`)
      return NextResponse.json({ success: false, error: `Branch is not accessible: ${branchRes.status}` }, { status: 400 })
    }
    await recordIntegrationRunDb('github_issue_sync', 'success', `Connection test passed: ${target.owner}/${target.repo}#${target.defaultBranch} is accessible`)
    return NextResponse.json({ success: true, detail: 'Connection test passed (repository and branch are accessible)' })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
