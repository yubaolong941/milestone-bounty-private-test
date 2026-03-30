import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { buildCookieOptions } from '@/lib/session'
import { requireAnyCompanyCapability } from '@/lib/auth'

function getCookie(req: Request, key: string): string | null {
  const cookieHeader = req.headers.get('cookie') || ''
  const part = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${key}=`))
  if (!part) return null
  return decodeURIComponent(part.slice(key.length + 1))
}

function readPendingStates(req: Request, key: string): string[] {
  const raw = getCookie(req, key) || ''
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

export async function GET(req: Request) {
  const auth = await requireAnyCompanyCapability(req, ['repo.manage'])
  if (!auth.ok) return auth.response

  const appSlug = process.env.GITHUB_APP_SLUG
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  const url = new URL(req.url)
  const next = url.searchParams.get('next') || '/staff?layer=operations&ops=setup'
  const companyId = url.searchParams.get('companyId') || auth.session.activeCompanyId || ''

  if (!appSlug) {
    return NextResponse.json({ error: 'GITHUB_APP_SLUG is not configured' }, { status: 400 })
  }

  const nonce = randomBytes(16).toString('hex')
  const state = `bp-ghapp:${nonce}:${companyId}:${encodeURIComponent(next)}`
  const installUrl = `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`

  const response = NextResponse.redirect(installUrl)
  const states = Array.from(new Set([...readPendingStates(req, 'bp_github_app_state'), nonce])).slice(-5)
  const nextMap = { ...readPendingNextMap(req, 'bp_github_app_next'), [nonce]: next }
  response.cookies.set('bp_github_app_state', JSON.stringify(states), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  response.cookies.set('bp_github_app_next', JSON.stringify(nextMap), buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  return response
}
