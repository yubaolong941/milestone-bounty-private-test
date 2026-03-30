import { NextResponse } from 'next/server'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { withSession } from '@/lib/auth'
import {
  getCompanyBySlug,
  insertAuditLog,
  insertCompany,
  insertMembership,
  listActiveMembershipsForIdentity,
  upsertRecipientProfile
} from '@/lib/access-control-db'
import { v4 as uuidv4 } from 'uuid'
import { buildCookieOptions, buildExpiredCookieOptions } from '@/lib/session'
import { getGitHubLoginConfigErrorDetail, resolveGitHubLoginConfig } from '@/lib/github-login'

const execFileAsync = promisify(execFile)

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getCookie(req: Request, key: string): string | null {
  const cookieHeader = req.headers.get('cookie') || ''
  const part = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${key}=`))
  if (!part) return null
  return decodeURIComponent(part.slice(key.length + 1))
}

function readPendingStates(req: Request): string[] {
  const raw = getCookie(req, 'bp_github_oauth_state')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '')).filter(Boolean) : []
  } catch {
    return raw ? [raw] : []
  }
}

function readPendingNextMap(req: Request): Record<string, string> {
  const raw = getCookie(req, 'bp_github_oauth_next')
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [String(key), String(value || '')])
        .filter(([key, value]) => Boolean(key && value))
    )
  } catch {
    return raw ? { legacy: raw } : {}
  }
}

function normalizeNextPath(value: string | null | undefined) {
  if (!value) return '/external'
  const trimmed = value.trim()
  if (!trimmed) return '/external'
  if (trimmed.startsWith('/')) return trimmed
  try {
    const decoded = decodeURIComponent(trimmed)
    if (decoded.startsWith('/')) return decoded
  } catch {
    // ignore malformed encoding and fall through
  }
  return '/external'
}

function redirectToLoginWithError(req: Request, appBaseUrl: string, reason: string, detail?: string, status?: number) {
  const target = new URL('/login', appBaseUrl)
  target.searchParams.set('auth_error', reason)
  if (detail) target.searchParams.set('auth_detail', detail.slice(0, 180))
  const response = NextResponse.redirect(target.toString(), status ? { status } : undefined)
  response.cookies.set('bp_github_oauth_state', '', buildExpiredCookieOptions(req.url))
  response.cookies.set('bp_github_oauth_next', '', buildExpiredCookieOptions(req.url))
  return response
}

async function githubJsonRequest<T>(input: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.url)
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: input.method || 'GET',
      headers: input.headers,
      family: 4,
      timeout: 15000
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data: T | null = null
        try {
          data = text ? JSON.parse(text) as T : null
        } catch {
          data = null
        }
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          data,
          text
        })
      })
    })
    req.on('timeout', () => req.destroy(new Error('GitHub request timeout')))
    req.on('error', reject)
    if (input.body) req.write(input.body)
    req.end()
  })
}

async function exchangeGitHubTokenByCurl(input: {
  clientId: string
  clientSecret: string
  code: string
}) {
  const payload = JSON.stringify({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code
  })
  const { stdout } = await execFileAsync('curl', [
    '--silent',
    '--show-error',
    '--max-time', '30',
    '--request', 'POST',
    '--url', 'https://github.com/login/oauth/access_token',
    '--header', 'Accept: application/json',
    '--header', 'Content-Type: application/json',
    '--header', 'User-Agent: milestone-pay-dev',
    '--data', payload
  ])
  return JSON.parse(stdout || '{}') as { access_token?: string; error?: string; error_description?: string }
}

async function ensureBootstrapCompanyForStaffLogin(input: {
  githubLogin: string
  githubNumericId: string
  displayName: string
}) {
  const now = new Date().toISOString()
  const slugBase = slugify(input.githubLogin || input.displayName || 'company') || `company-${uuidv4().slice(0, 8)}`
  let slug = slugBase
  let counter = 1
  while (await getCompanyBySlug(slug)) {
    slug = `${slugBase}-${counter++}`
  }

  const ownerUserId = input.githubNumericId || `github:${input.githubLogin}`
  const companyName = input.displayName || input.githubLogin || 'New Company'

  const company = await insertCompany({
    id: uuidv4(),
    slug,
    name: companyName,
    status: 'active',
    githubOrgLogin: input.githubLogin,
    githubOrgId: undefined,
    projectManagementTool: 'meegle',
    projectManagementToolLabel: undefined,
    meegleWorkspaceId: undefined,
    meegleProjectKey: undefined,
    meegleViewUrl: undefined,
    documentationTool: 'lark',
    documentationToolLabel: undefined,
    larkWebhookUrl: undefined,
    larkWebhookSecret: undefined,
    larkDefaultReceiveId: undefined,
    description: 'Auto-created on first GitHub staff login. Continue onboarding to finish company setup.',
    websiteUrl: undefined,
    contactEmail: undefined,
    defaultRepoConfigId: undefined,
    activeWalletId: undefined,
    createdByUserId: ownerUserId
  })

  const membership = await insertMembership({
    id: uuidv4(),
    companyId: company!.id,
    userId: ownerUserId,
    githubLogin: input.githubLogin,
    walletAddress: undefined,
    role: 'company_owner',
    status: 'active',
    invitedByUserId: ownerUserId,
    invitedAt: now,
    acceptedAt: now
  })

  await insertAuditLog({
    companyId: company!.id,
    actorUserId: ownerUserId,
    actorRole: 'company_owner',
    action: 'company.auto_bootstrap_from_github_login',
    targetType: 'company',
    targetId: company!.id,
    summary: `Auto-created company ${companyName} on first GitHub staff login`,
    metadata: {
      githubLogin: input.githubLogin,
      bootstrap: true
    },
    createdAt: now
  })

  return membership
}

export async function GET(req: Request) {
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') || ''
    if (!code) return redirectToLoginWithError(req, appBaseUrl, 'missing_code', 'GitHub did not return a code', 302)

    const stateNonce = state.startsWith('bp-github-oauth:') ? state.slice('bp-github-oauth:'.length) : ''
    const pendingStates = readPendingStates(req)
    if (!stateNonce || !pendingStates.includes(stateNonce)) {
      return redirectToLoginWithError(req, appBaseUrl, 'state_mismatch', 'GitHub OAuth state validation failed', 302)
    }

    const loginConfig = resolveGitHubLoginConfig()
    if (!loginConfig) {
      return redirectToLoginWithError(req, appBaseUrl, 'oauth_not_configured', getGitHubLoginConfigErrorDetail(), 302)
    }

    const tokenData = await exchangeGitHubTokenByCurl({
      clientId: loginConfig.clientId,
      clientSecret: loginConfig.clientSecret,
      code
    })
    if (tokenData?.error) {
      return redirectToLoginWithError(req, appBaseUrl, 'token_exchange_failed', tokenData.error_description || tokenData.error, 302)
    }
    const accessToken = tokenData?.access_token
    if (!accessToken) {
      return redirectToLoginWithError(req, appBaseUrl, 'missing_access_token', 'Failed to obtain access_token', 302)
    }

    const userRes = await githubJsonRequest<Record<string, unknown>>({
      url: 'https://api.github.com/user',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'milestone-pay-dev'
      }
    })
    if (!userRes.ok) {
      return redirectToLoginWithError(req, appBaseUrl, 'load_user_failed', `Failed to fetch GitHub user info: ${userRes.status}`, 302)
    }
    const user = (userRes.data || {}) as Record<string, unknown>
    const githubLogin = user?.login ? String(user.login).trim().toLowerCase() : 'unknown'
    const githubNumericId = String(user?.id || '')

    await upsertRecipientProfile({
      id: uuidv4(),
      type: 'individual',
      displayName: String(user?.name || user?.login || 'GitHub User'),
      githubLogin: githubLogin !== 'unknown' ? githubLogin : undefined,
      githubUserId: user?.id ? String(user.id) : undefined,
      walletAddress: undefined,
      externalUserId: String(user?.id || `github:${githubLogin}`),
      identitySource: 'github_code_bounty',
      ownerUserId: String(user?.id || `github:${githubLogin}`),
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    const membershipCandidates = await Promise.all([
      listActiveMembershipsForIdentity({
        userId: githubNumericId,
        githubLogin: githubLogin !== 'unknown' ? githubLogin : undefined
      }),
      listActiveMembershipsForIdentity({
        userId: githubLogin !== 'unknown' ? githubLogin : undefined,
        githubLogin: githubLogin !== 'unknown' ? githubLogin : undefined
      })
    ])

    let memberships = Array.from(
      new Map(
        membershipCandidates
          .flat()
          .map((item) => [item.id, item])
      ).values()
    )
    const pendingNextMap = readPendingNextMap(req)
    const next = normalizeNextPath(pendingNextMap[stateNonce] || getCookie(req, 'bp_github_oauth_next'))
    const staffIntent = next.startsWith('/staff')

    if (staffIntent && memberships.length === 0 && githubLogin !== 'unknown') {
      const bootstrapMembership = await ensureBootstrapCompanyForStaffLogin({
        githubLogin,
        githubNumericId,
        displayName: String(user?.company || user?.name || user?.login || 'New Company')
      })
      memberships = bootstrapMembership ? [bootstrapMembership] : memberships
    }

    const preferredMembership = memberships[0]
    const isInternalMember = Boolean(preferredMembership)
    const prefersExternalPortal = next.startsWith('/external')
    const useExternalPortal = staffIntent ? false : (prefersExternalPortal || !isInternalMember)
    const sessionUserId = preferredMembership?.userId
      || githubNumericId
      || `github:${githubLogin}`

    const response = NextResponse.redirect(`${appBaseUrl}${useExternalPortal ? next : '/staff?layer=operations&ops=setup'}`)
    const nextPendingStates = pendingStates.filter((item) => item !== stateNonce)
    const nextPendingMap = { ...pendingNextMap }
    delete nextPendingMap[stateNonce]
    if (nextPendingStates.length > 0) {
      response.cookies.set('bp_github_oauth_state', JSON.stringify(nextPendingStates), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
    } else {
      response.cookies.set('bp_github_oauth_state', '', buildExpiredCookieOptions(req.url))
    }
    if (Object.keys(nextPendingMap).length > 0) {
      response.cookies.set('bp_github_oauth_next', JSON.stringify(nextPendingMap), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
    } else {
      response.cookies.set('bp_github_oauth_next', '', buildExpiredCookieOptions(req.url))
    }

    return withSession(
      {
        userId: sessionUserId,
        role: useExternalPortal ? 'external_contributor' : 'staff',
        githubLogin,
        externalAuthType: useExternalPortal ? 'github_code_bounty' : undefined,
        activeCompanyId: useExternalPortal ? undefined : preferredMembership?.companyId,
        activeCompanyRole: useExternalPortal ? undefined : preferredMembership?.role
      },
      response
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return redirectToLoginWithError(req, appBaseUrl, 'callback_exception', detail, 302)
  }
}
