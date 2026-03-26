import { NextResponse } from 'next/server'
import { requireRoles } from '@/lib/auth'
import { loadInternalMemberBindings, saveInternalMemberBindings, loadRepoConfigs } from '@/lib/storage'
import { InternalMemberBinding } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff'])
  if (!auth.ok) return auth.response
  return NextResponse.json(loadInternalMemberBindings())
}

export async function POST(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff'])
  if (!auth.ok) return auth.response
  const body = await req.json()
  const action = body?.action || 'create'
  const bindings = loadInternalMemberBindings()

  if (action === 'create') {
    const meegleAssignee = String(body?.meegleAssignee || '').trim()
    const githubLogin = String(body?.githubLogin || '').trim()
    const repoConfigId = body?.repoConfigId ? String(body.repoConfigId) : undefined
    if (!meegleAssignee || !githubLogin) return NextResponse.json({ error: '缺少 meegleAssignee/githubLogin' }, { status: 400 })
    if (repoConfigId && !loadRepoConfigs().find((r) => r.id === repoConfigId)) {
      return NextResponse.json({ error: 'repoConfigId 不存在' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const item: InternalMemberBinding = {
      id: uuidv4(),
      meegleAssignee,
      githubLogin,
      repoConfigId,
      repo: body?.repo ? String(body.repo).trim() : undefined,
      enabled: body?.enabled !== false,
      createdAt: now,
      updatedAt: now
    }
    bindings.push(item)
    saveInternalMemberBindings(bindings)
    return NextResponse.json(item)
  }

  if (action === 'update') {
    const id = String(body?.id || '')
    const item = bindings.find((x) => x.id === id)
    if (!item) return NextResponse.json({ error: '绑定不存在' }, { status: 404 })
    if (body?.meegleAssignee) item.meegleAssignee = String(body.meegleAssignee).trim()
    if (body?.githubLogin) item.githubLogin = String(body.githubLogin).trim()
    if (body?.repoConfigId !== undefined) item.repoConfigId = body.repoConfigId ? String(body.repoConfigId) : undefined
    if (body?.repo !== undefined) item.repo = body.repo ? String(body.repo).trim() : undefined
    if (body?.enabled !== undefined) item.enabled = Boolean(body.enabled)
    item.updatedAt = new Date().toISOString()
    saveInternalMemberBindings(bindings)
    return NextResponse.json(item)
  }

  if (action === 'delete') {
    const id = String(body?.id || '')
    const next = bindings.filter((x) => x.id !== id)
    saveInternalMemberBindings(next)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '不支持的 action' }, { status: 400 })
}
