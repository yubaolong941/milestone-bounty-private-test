import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getCompanyContext, getSessionFromRequest, withSession } from '@/lib/auth'
import { getInstallationAccessToken } from '@/lib/integrations'
import { upsertRepoConfigDb, listRepoConfigsDb } from '@/lib/runtime-data-db'
import { insertAuditLog } from '@/lib/access-control-db'
import type { RepoConfig } from '@/lib/types'
import { buildCookieOptions, buildExpiredCookieOptions } from '@/lib/session'

function getCookie(req: Request, key: string): string | null {
  const cookieHeader = req.headers.get('cookie') || ''
  const part = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${key}=`))
  if (!part) return null
  return decodeURIComponent(part.slice(key.length + 1))
}

function readPendingStates(req: Request, key: string): string[] {
  const raw = getCookie(req, key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((x) => String(x || '')).filter(Boolean) : []
  } catch {
    return raw ? [raw] : []
  }
}

function readPendingNextMap(req: Request, key: string): Record<string, string> {
  const raw = getCookie(req, key)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => [String(k), String(v || '')])
        .filter(([k, v]) => Boolean(k && v))
    )
  } catch {
    return {}
  }
}

function normalizeNextPath(value: string | null | undefined) {
  if (!value) return '/staff?layer=operations&ops=setup'
  const trimmed = value.trim()
  if (!trimmed) return '/staff?layer=operations&ops=setup'
  if (trimmed.startsWith('/')) return trimmed
  try {
    const decoded = decodeURIComponent(trimmed)
    if (decoded.startsWith('/')) return decoded
  } catch {
    // ignore
  }
  return '/staff?layer=operations&ops=setup'
}

function parseGitHubAppState(state: string) {
  if (!state.startsWith('bp-ghapp:')) {
    return { nonce: '', companyId: '' }
  }
  const parts = state.split(':')
  return {
    nonce: parts[1] || '',
    companyId: parts[2] || ''
  }
}

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  default_branch: string
  owner: { login: string }
  private: boolean
}

function buildRedirectUrl(appBaseUrl: string, next: string, params: Record<string, string>) {
  const target = new URL(next, appBaseUrl)
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value)
  }
  return target.toString()
}

export async function GET(req: Request) {
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  const url = new URL(req.url)
  const installationId = url.searchParams.get('installation_id') || ''
  const setupAction = url.searchParams.get('setup_action') || ''
  const state = url.searchParams.get('state') || ''

  const { nonce, companyId: stateCompanyId } = parseGitHubAppState(state)
  const pendingStates = readPendingStates(req, 'bp_github_app_state')
  const pendingNextMap = readPendingNextMap(req, 'bp_github_app_next')

  const next = normalizeNextPath(pendingNextMap[nonce])
  let redirectUrl = buildRedirectUrl(appBaseUrl, next, {
    installationId,
    setup: setupAction
  })
  let nextSession: ReturnType<typeof getSessionFromRequest> | null = null

  if (!installationId) {
    redirectUrl = buildRedirectUrl(appBaseUrl, next, {
      github_app: 'error',
      detail: 'missing_installation_id'
    })
  } else {
    const session = getSessionFromRequest(req)
    if (!session) {
      redirectUrl = `${appBaseUrl}/login?next=${encodeURIComponent(next)}&github_app=auth_required`
    } else {
      nextSession = session
      const targetCompanyId = stateCompanyId || session.activeCompanyId || ''
      const companyContext = await getCompanyContext(session, targetCompanyId)
      const companyId = companyContext?.company.id

      if (!companyId) {
        redirectUrl = buildRedirectUrl(appBaseUrl, next, {
          github_app: 'error',
          detail: 'no_company'
        })
      } else {
        try {
          const tokenResult = await getInstallationAccessToken(installationId)
          if (!tokenResult) {
            redirectUrl = buildRedirectUrl(appBaseUrl, next, {
              github_app: 'error',
              detail: 'token_failed'
            })
          } else {
            const reposRes = await fetch('https://api.github.com/installation/repositories?per_page=100', {
              headers: {
                Authorization: `Bearer ${tokenResult.token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
              },
              cache: 'no-store'
            })

            if (!reposRes.ok) {
              redirectUrl = buildRedirectUrl(appBaseUrl, next, {
                github_app: 'error',
                detail: 'repos_fetch_failed'
              })
            } else {
              const reposData = await reposRes.json() as { repositories?: GitHubRepo[] }
              const repos = reposData.repositories || []
              const existingResult = await listRepoConfigsDb({ companyId })
              const existing = Array.isArray(existingResult) ? existingResult : existingResult.items
              const existingKeys = new Set(existing.map((repo: RepoConfig) => `${repo.owner}/${repo.repo}`))

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
                existingKeys.add(key)
                imported += 1
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
                  stateCompanyId: stateCompanyId || null,
                  totalRepos: repos.length,
                  importedRepos: imported,
                  skippedDuplicates: repos.length - imported
                }
              })

              nextSession = {
                ...session,
                activeCompanyId: companyId,
                activeCompanyRole: companyContext?.membership?.role || session.activeCompanyRole
              }

              redirectUrl = buildRedirectUrl(appBaseUrl, next, {
                github_app: 'installed',
                companyId,
                installationId,
                setup: setupAction,
                imported: String(imported),
                repoCount: String(repos.length)
              })
            }
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'unknown'
          redirectUrl = buildRedirectUrl(appBaseUrl, next, {
            github_app: 'error',
            detail
          })
        }
      }
    }
  }

  const response = NextResponse.redirect(redirectUrl)

  // clear cookies for this nonce
  const nextStates = pendingStates.filter((x) => x !== nonce)
  if (nextStates.length > 0) {
    response.cookies.set('bp_github_app_state', JSON.stringify(nextStates), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  } else {
    response.cookies.set('bp_github_app_state', '', buildExpiredCookieOptions(req.url))
  }
  const nextMap = { ...pendingNextMap }
  delete nextMap[nonce]
  if (Object.keys(nextMap).length > 0) {
    response.cookies.set('bp_github_app_next', JSON.stringify(nextMap), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  } else {
    response.cookies.set('bp_github_app_next', '', buildExpiredCookieOptions(req.url))
  }

  return nextSession ? withSession(nextSession, response, { requestUrl: req.url }) : response
}
