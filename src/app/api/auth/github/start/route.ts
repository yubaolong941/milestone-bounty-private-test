import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { buildCookieOptions } from '@/lib/session'
import { getGitHubLoginConfigErrorDetail, resolveGitHubLoginConfig } from '@/lib/github-login'

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
    return {}
  }
}

export async function GET(req: Request) {
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  const next = new URL(req.url).searchParams.get('next') || '/external'
  const loginConfig = resolveGitHubLoginConfig()

  if (!loginConfig) {
    const target = new URL('/login', appBaseUrl)
    target.searchParams.set('auth_error', 'oauth_not_configured')
    target.searchParams.set('auth_detail', getGitHubLoginConfigErrorDetail())
    return NextResponse.redirect(target.toString(), { status: 302 })
  }

  const stateNonce = randomBytes(16).toString('hex')
  const redirectUri = `${appBaseUrl}/api/auth/github/callback`
  const params = new URLSearchParams({
    client_id: loginConfig.clientId,
    redirect_uri: redirectUri,
    state: `bp-github-oauth:${stateNonce}`,
    scope: 'read:user user:email'
  })

  const response = NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
  const pendingStates = Array.from(new Set([...readPendingStates(req), stateNonce])).slice(-5)
  const pendingNextMap = {
    ...readPendingNextMap(req),
    [stateNonce]: next
  }
  response.cookies.set('bp_github_oauth_state', JSON.stringify(pendingStates), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  response.cookies.set('bp_github_oauth_next', JSON.stringify(pendingNextMap), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  return response
}
