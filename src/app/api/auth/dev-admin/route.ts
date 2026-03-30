import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { insertAuditLog, listCompanies } from '@/lib/access-control-db'
import { withSession } from '@/lib/auth'

function isDevAdminAllowed() {
  return process.env.ENABLE_DEV_ADMIN_LOGIN === 'true'
}

function secureEquals(left: string, right: string) {
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) return false
  return timingSafeEqual(leftBuf, rightBuf)
}

export async function POST(req: Request) {
  if (!isDevAdminAllowed()) {
    return NextResponse.json({ error: 'Local admin login is disabled in the current environment' }, { status: 403 })
  }

  const expectedToken = (process.env.DEV_ADMIN_TOKEN || '').trim()
  if (!expectedToken) {
    return NextResponse.json({ error: 'DEV_ADMIN_TOKEN is not configured; local admin login denied' }, { status: 500 })
  }

  let body: { token?: string; next?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON with { token }' }, { status: 400 })
  }

  const providedToken = (body.token || req.headers.get('x-dev-admin-token') || '').trim()
  if (!providedToken || !secureEquals(providedToken, expectedToken)) {
    return NextResponse.json({ error: 'DEV_ADMIN_TOKEN validation failed' }, { status: 401 })
  }

  const companies = await listCompanies()
  const activeCompany = companies[0]
  if (!activeCompany) {
    return NextResponse.json({ error: 'No companies found in the database; unable to establish local admin context' }, { status: 400 })
  }

  const url = new URL(req.url)
  const next = body.next || '/staff'
  const origin = `${url.protocol}//${url.host}`
  const response = NextResponse.redirect(`${origin}${next}`)
  const userId = 'local-dev-admin'

  await insertAuditLog({
    companyId: activeCompany.id,
    actorUserId: userId,
    actorRole: 'platform_admin',
    action: 'auth.dev_admin_login',
    targetType: 'session',
    targetId: userId,
    summary: 'Local dev-admin login',
    metadata: {
      next,
      activeCompanyId: activeCompany.id,
      activeCompanyName: activeCompany.name,
      userAgent: req.headers.get('user-agent') || '',
      forwardedFor: req.headers.get('x-forwarded-for') || '',
      host: req.headers.get('host') || ''
    },
    createdAt: new Date().toISOString()
  })

  const ttlSeconds = Number(process.env.DEV_ADMIN_SESSION_TTL_SECONDS || 7200)
  const maxAgeSeconds = Number.isFinite(ttlSeconds)
    ? Math.max(300, Math.min(60 * 60 * 24, Math.floor(ttlSeconds)))
    : 7200

  return withSession(
    {
      userId,
      role: 'admin',
      platformRole: 'platform_admin',
      githubLogin: process.env.DEV_ADMIN_GITHUB_LOGIN || 'tomo-admin',
      activeCompanyId: activeCompany.id,
      activeCompanyRole: undefined
    },
    response,
    { maxAgeSeconds, requestUrl: req.url }
  )
}
