import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { getInstallationAccessToken } from '@/lib/integrations'

export const dynamic = 'force-dynamic'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  default_branch: string
  owner: { login: string }
  private: boolean
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const installationId = url.searchParams.get('installationId')
  if (!installationId) {
    return NextResponse.json({ error: 'Missing installationId' }, { status: 400 })
  }

  const tokenResult = await getInstallationAccessToken(installationId)
  if (!tokenResult) {
    return NextResponse.json({ error: 'Failed to get installation token. Check GITHUB_APP_ID and private key.' }, { status: 500 })
  }

  const res = await fetch('https://api.github.com/installation/repositories?per_page=100', {
    headers: {
      Authorization: `Bearer ${tokenResult.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (!res.ok) {
    return NextResponse.json({ error: `GitHub API error: ${res.status}` }, { status: 502 })
  }

  const data = await res.json() as { repositories?: GitHubRepo[]; total_count?: number }
  const repos = (data.repositories || []).map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    owner: repo.owner.login,
    private: repo.private
  }))

  return NextResponse.json({ repos, total: data.total_count || repos.length })
}
