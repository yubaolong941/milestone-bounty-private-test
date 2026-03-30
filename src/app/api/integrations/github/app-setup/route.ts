import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSessionFromRequest, getCompanyContext } from '@/lib/auth'
import { getInstallationAccessToken } from '@/lib/integrations'
import { upsertRepoConfigDb, listRepoConfigsDb } from '@/lib/runtime-data-db'
import { insertAuditLog } from '@/lib/access-control-db'
import type { RepoConfig } from '@/lib/types'

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
  const url = new URL(req.url)
  const installationId = url.searchParams.get('installation_id')
  const setupAction = url.searchParams.get('setup_action')
  const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  const redirectTarget = `${appBaseUrl}/staff?layer=operations&ops=setup&github_app=installed`

  if (!installationId) {
    return NextResponse.redirect(`${appBaseUrl}/staff?layer=operations&ops=setup&github_app=error&detail=missing_installation_id`)
  }

  const session = getSessionFromRequest(req)
  if (!session) {
    return NextResponse.redirect(`${appBaseUrl}/login?next=/staff&github_app=auth_required`)
  }

  const companyContext = await getCompanyContext(session)
  const companyId = companyContext?.company.id
  if (!companyId) {
    return NextResponse.redirect(`${appBaseUrl}/staff?layer=operations&ops=setup&github_app=error&detail=no_company`)
  }

  try {
    const tokenResult = await getInstallationAccessToken(installationId)
    if (!tokenResult) {
      return NextResponse.redirect(`${appBaseUrl}/staff?layer=operations&ops=setup&github_app=error&detail=token_failed`)
    }

    // List repos accessible to this installation
    const reposRes = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    if (!reposRes.ok) {
      return NextResponse.redirect(`${appBaseUrl}/staff?layer=operations&ops=setup&github_app=error&detail=repos_fetch_failed`)
    }

    const reposData = await reposRes.json() as { repositories?: GitHubRepo[] }
    const repos = reposData.repositories || []

    // Get existing repo configs for this company to avoid duplicates
    const existingResult = await listRepoConfigsDb({ companyId })
    const existing = Array.isArray(existingResult) ? existingResult : existingResult.items
    const existingKeys = new Set(existing.map((r: RepoConfig) => `${r.owner}/${r.repo}`))

    let imported = 0
    for (const repo of repos) {
      const key = `${repo.owner.login}/${repo.name}`
      if (existingKeys.has(key)) continue

      const config: RepoConfig = {
        id: uuidv4(),
        companyId,
        provider: 'github',
        owner: repo.owner.login,
        repo: repo.name,
        defaultBranch: repo.default_branch || 'main',
        tokenRef: `ghapp:${installationId}`,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      await upsertRepoConfigDb(config)
      imported++
    }

    await insertAuditLog({
      companyId,
      actorUserId: session.userId,
      actorRole: session.role || 'staff',
      action: 'repo_config.github_app_install',
      targetType: 'integration',
      targetId: `ghapp:${installationId}`,
      summary: `GitHub App installed: imported ${imported} repo(s) from ${repos.length} accessible`,
      metadata: {
        installationId,
        setupAction,
        totalRepos: repos.length,
        importedRepos: imported,
        skippedDuplicates: repos.length - imported
      }
    })

    return NextResponse.redirect(redirectTarget)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown'
    return NextResponse.redirect(`${appBaseUrl}/staff?layer=operations&ops=setup&github_app=error&detail=${encodeURIComponent(detail)}`)
  }
}
