import { NextResponse } from 'next/server'
import { requireAnyCompanyCapability } from '@/lib/auth'
import { resolveGitHubRequestHeaders } from '@/lib/integrations'

export async function GET(req: Request) {
  const auth = await requireAnyCompanyCapability(req, ['repo.manage'])
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const installationId = (url.searchParams.get('installationId') || '').trim()
  const perPage = Math.min(Math.max(parseInt(url.searchParams.get('per_page') || '100', 10) || 100, 1), 100)
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1)
  if (!installationId) return NextResponse.json({ error: 'installationId is required' }, { status: 400 })

  const headers = await resolveGitHubRequestHeaders(`ghapp:${installationId}`)
  if (!headers) return NextResponse.json({ error: 'GitHub App is not configured' }, { status: 400 })

  const res = await fetch(`https://api.github.com/installation/repositories?per_page=${perPage}&page=${page}`, { headers, cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json({ error: `GitHub API failed: ${res.status}${text ? ` ${text}` : ''}` }, { status: 400 })
  }
  const json = await res.json() as { repositories?: Array<{ full_name?: string; name?: string; owner?: { login?: string }; default_branch?: string }> }
  const items = (json.repositories || []).map((r) => ({ owner: String(r.owner?.login || ''), repo: String(r.name || ''), defaultBranch: r.default_branch || 'main' }))
  return NextResponse.json({ items })
}
