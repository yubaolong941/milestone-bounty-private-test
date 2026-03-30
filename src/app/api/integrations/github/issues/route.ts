import { NextResponse } from 'next/server'
import { getCompanyContext, requireInternalUser } from '@/lib/auth'
import { resolveGitHubRequestHeaders } from '@/lib/integrations'
import { GitHubBountyIssue, upsertTaskFromGitHubIssue } from '@/lib/github-bounties'
import { listRepoConfigsDb, recordIntegrationRunDb } from '@/lib/runtime-data-db'

interface GitHubIssueApiItem {
  id: number
  number: number
  title: string
  body?: string | null
  html_url: string
  state: 'open' | 'closed'
  labels?: Array<string | { name?: string }>
  user?: { login?: string }
  pull_request?: unknown
}

function normalizeLabels(labels: GitHubIssueApiItem['labels']): string[] {
  if (!Array.isArray(labels)) return []
  return labels
    .map((label) => typeof label === 'string' ? label : label?.name || '')
    .filter(Boolean)
}

async function getTargets(companyId?: string) {
  const repoConfigs = await listRepoConfigsDb({ companyId, enabledOnly: true })
  if (repoConfigs.length > 0) {
    return repoConfigs.map((repo) => ({ owner: repo.owner, repo: repo.repo, tokenRef: repo.tokenRef }))
  }

  const fallbackRepo = process.env.GITHUB_INTERNAL_REPO_FULL_NAME
  if (!fallbackRepo) return []
  const [owner, repo] = fallbackRepo.split('/')
  if (!owner || !repo) return []
  return [{ owner, repo, tokenRef: undefined }]
}

async function syncGithubIssues(companyId?: string) {
  const targets = await getTargets(companyId)
  if (!targets.length) {
    await recordIntegrationRunDb('github_issue_sync', 'failure', 'No GitHub repository configured for sync')
    return { success: false, detail: 'No repository configured (repo config or GITHUB_INTERNAL_REPO_FULL_NAME)', synced: 0, created: 0, updated: 0 }
  }

  let synced = 0
  let created = 0
  let updated = 0
  const touched: Array<{ repo: string; issueNumber: number; taskId: string; created: boolean }> = []

  for (const target of targets) {
    const headers = await resolveGitHubRequestHeaders(target.tokenRef)
    if (!headers) {
      const detail = target.tokenRef
        ? `GitHub issue sync failed: no GitHub Token configured for tokenRef (${target.tokenRef}) in ${target.owner}/${target.repo}`
        : `GitHub issue sync failed: tokenRef not set for ${target.owner}/${target.repo}`
      await recordIntegrationRunDb('github_issue_sync', 'failure', detail)
      return { success: false, detail, synced, created, updated, touched }
    }
    const res = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/issues?state=all&per_page=100`,
      {
        headers,
        cache: 'no-store'
      }
    )
    if (!res.ok) {
      const detail = `GitHub issue sync failed: ${target.owner}/${target.repo} returned ${res.status}`
      await recordIntegrationRunDb('github_issue_sync', 'failure', detail)
      return { success: false, detail, synced, created, updated, touched }
    }

    const issues = await res.json() as GitHubIssueApiItem[]
    for (const issue of issues) {
      if (issue.pull_request) continue
      const labels = normalizeLabels(issue.labels)

      const payload: GitHubBountyIssue = {
        companyId,
        owner: target.owner,
        repo: target.repo,
        issueNumber: issue.number,
        issueId: issue.id,
        title: issue.title,
        body: issue.body || '',
        labels,
        htmlUrl: issue.html_url,
        authorLogin: issue.user?.login,
        state: issue.state
      }
      const result = await upsertTaskFromGitHubIssue(payload)
      synced += 1
      if (result.created) created += 1
      else updated += 1
      touched.push({
        repo: `${target.owner}/${target.repo}`,
        issueNumber: issue.number,
        taskId: result.task.id,
        created: result.created
      })
    }
  }

  const detail = `GitHub issue sync completed; ${synced} issue(s) synced`
  await recordIntegrationRunDb('github_issue_sync', 'success', detail)
  return { success: true, detail, synced, created, updated, touched }
}

async function runSyncForRequest(req: Request, requestedCompanyId?: string) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  try {
    const companyContext = await getCompanyContext(auth.session, requestedCompanyId || auth.session.activeCompanyId)
    return NextResponse.json(await syncGithubIssues(requestedCompanyId || companyContext?.company.id || auth.session.activeCompanyId))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await recordIntegrationRunDb('github_issue_sync', 'failure', detail)
    return NextResponse.json({ success: false, detail, synced: 0, created: 0, updated: 0 }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  return runSyncForRequest(req, url.searchParams.get('companyId') || undefined)
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  return runSyncForRequest(req, body?.companyId ? String(body.companyId) : undefined)
}
