import { NextResponse } from 'next/server'
import { loadRepoConfigs, saveRepoConfigs } from '@/lib/storage'
import { RepoConfig } from '@/lib/types'
import { requireRoles } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff'])
  if (!auth.ok) return auth.response
  return NextResponse.json(loadRepoConfigs())
}

export async function POST(req: Request) {
  const auth = requireRoles(req, ['admin', 'reviewer', 'finance', 'staff'])
  if (!auth.ok) return auth.response

  const body = await req.json()
  const action = body?.action || 'create'
  const configs = loadRepoConfigs()

  if (action === 'create') {
    if (!body?.owner || !body?.repo) return NextResponse.json({ error: '缺少 owner/repo' }, { status: 400 })
    const now = new Date().toISOString()
    const config: RepoConfig = {
      id: uuidv4(),
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
    configs.push(config)
    saveRepoConfigs(configs)
    return NextResponse.json(config)
  }

  if (action === 'update') {
    const id = String(body?.id || '')
    const target = configs.find((c) => c.id === id)
    if (!target) return NextResponse.json({ error: 'repo config 不存在' }, { status: 404 })
    if (body.owner) target.owner = String(body.owner).trim()
    if (body.repo) target.repo = String(body.repo).trim()
    if (body.defaultBranch) target.defaultBranch = String(body.defaultBranch).trim()
    if (body.tokenRef !== undefined) target.tokenRef = body.tokenRef ? String(body.tokenRef).trim() : undefined
    if (body.enabled !== undefined) target.enabled = Boolean(body.enabled)
    if (body.syncIntervalSec !== undefined) target.syncIntervalSec = Number(body.syncIntervalSec) || undefined
    target.updatedAt = new Date().toISOString()
    saveRepoConfigs(configs)
    return NextResponse.json(target)
  }

  if (action === 'delete') {
    const id = String(body?.id || '')
    const next = configs.filter((c) => c.id !== id)
    saveRepoConfigs(next)
    return NextResponse.json({ success: true })
  }

  if (action === 'test') {
    const id = String(body?.id || '')
    const target = configs.find((c) => c.id === id)
    if (!target) return NextResponse.json({ error: 'repo config 不存在' }, { status: 404 })
    const token = process.env.GITHUB_TOKEN
    if (!token) return NextResponse.json({ error: '未配置 GITHUB_TOKEN' }, { status: 400 })

    const repoRes = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    })
    if (!repoRes.ok) {
      return NextResponse.json({ success: false, error: `仓库不可访问: ${repoRes.status}` }, { status: 400 })
    }

    const branchRes = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/branches/${encodeURIComponent(target.defaultBranch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        }
      }
    )
    if (!branchRes.ok) {
      return NextResponse.json({ success: false, error: `分支不可访问: ${branchRes.status}` }, { status: 400 })
    }
    return NextResponse.json({ success: true, detail: '连接测试通过（仓库与分支可访问）' })
  }

  return NextResponse.json({ error: '不支持的 action' }, { status: 400 })
}
