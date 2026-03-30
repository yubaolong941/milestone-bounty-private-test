import { NextResponse } from 'next/server'
import { getCompanyContext, requireAnyCompanyCapability } from '@/lib/auth'
import { hasAnyCompanyCapability, isPlatformAdmin } from '@/lib/permissions'
import { parsePaginationParams } from '@/lib/pagination'
import { InternalMemberBinding } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'
import {
  deleteInternalMemberBindingDb,
  getInternalMemberBindingByIdDb,
  getRepoConfigByIdDb,
  listInternalMemberBindingsDb,
  upsertInternalMemberBindingDb
} from '@/lib/runtime-data-db'

export async function GET(req: Request) {
  const auth = await requireAnyCompanyCapability(req, ['integration.manage', 'repo.manage', 'company.read'])
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const companyContext = await getCompanyContext(auth.session)
  if (companyContext && !isPlatformAdmin(auth.session) && !hasAnyCompanyCapability(companyContext.membership?.role, ['integration.manage', 'repo.manage', 'company.read'])) {
    return NextResponse.json({ error: 'Not authorized to view member mappings' }, { status: 403 })
  }
  const items = await listInternalMemberBindingsDb({
    companyId: companyContext?.company.id || auth.session.activeCompanyId,
    pagination: pagination || undefined
  })
  return NextResponse.json(pagination ? {
    items,
    pagination: { page: pagination.page, pageSize: pagination.pageSize }
  } : items)
}

export async function POST(req: Request) {
  const auth = await requireAnyCompanyCapability(req, ['integration.manage'])
  if (!auth.ok) return auth.response
  const body = await req.json()
  const action = body?.action || 'create'
  const companyContext = await getCompanyContext(auth.session, body?.companyId ? String(body.companyId) : auth.session.activeCompanyId)
  const companyId = isPlatformAdmin(auth.session)
    ? (body?.companyId ? String(body.companyId) : auth.session.activeCompanyId)
    : companyContext?.company.id

  if (action === 'create') {
    const meegleAssignee = String(body?.meegleAssignee || '').trim()
    const githubLogin = String(body?.githubLogin || '').trim()
    const repoConfigId = body?.repoConfigId ? String(body.repoConfigId) : undefined
    if (!meegleAssignee || !githubLogin) return NextResponse.json({ error: 'Missing meegleAssignee/githubLogin' }, { status: 400 })
    if (!companyId) return NextResponse.json({ error: 'Please select a company context before creating a binding' }, { status: 400 })
    if (repoConfigId && !await getRepoConfigByIdDb(repoConfigId)) {
      return NextResponse.json({ error: 'repoConfigId does not exist' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const item: InternalMemberBinding = {
      id: uuidv4(),
      companyId,
      meegleAssignee,
      githubLogin,
      repoConfigId,
      repo: body?.repo ? String(body.repo).trim() : undefined,
      enabled: body?.enabled !== false,
      createdAt: now,
      updatedAt: now
    }
    await upsertInternalMemberBindingDb(item)
    return NextResponse.json(item)
  }

  if (action === 'update') {
    const id = String(body?.id || '')
    const item = await getInternalMemberBindingByIdDb(id)
    if (!item) return NextResponse.json({ error: 'Binding not found' }, { status: 404 })
    if (companyId && item.companyId && item.companyId !== companyId && !isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Not authorized to modify another company\'s binding' }, { status: 403 })
    }
    if (body?.meegleAssignee) item.meegleAssignee = String(body.meegleAssignee).trim()
    if (body?.githubLogin) item.githubLogin = String(body.githubLogin).trim()
    if (body?.repoConfigId !== undefined) item.repoConfigId = body.repoConfigId ? String(body.repoConfigId) : undefined
    if (body?.repo !== undefined) item.repo = body.repo ? String(body.repo).trim() : undefined
    if (body?.enabled !== undefined) item.enabled = Boolean(body.enabled)
    if (body?.companyId !== undefined && isPlatformAdmin(auth.session)) item.companyId = body.companyId ? String(body.companyId) : undefined
    item.updatedAt = new Date().toISOString()
    await upsertInternalMemberBindingDb(item)
    return NextResponse.json(item)
  }

  if (action === 'delete') {
    const id = String(body?.id || '')
    const item = await getInternalMemberBindingByIdDb(id)
    if (!item) return NextResponse.json({ error: 'Binding not found' }, { status: 404 })
    if (companyId && item.companyId && item.companyId !== companyId && !isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Not authorized to delete another company\'s binding' }, { status: 403 })
    }
    await deleteInternalMemberBindingDb(id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
