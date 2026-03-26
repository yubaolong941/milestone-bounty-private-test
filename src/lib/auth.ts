import { NextResponse } from 'next/server'

export type UserRole = 'admin' | 'reviewer' | 'finance' | 'staff' | 'external_contributor'

export interface SessionUser {
  userId: string
  role: UserRole
  githubLogin?: string
  walletAddress?: string
  externalAuthType?: 'github_code_bounty' | 'wallet_security_bounty'
}

const COOKIE_NAME = 'bp_session'

function encodeSession(session: SessionUser): string {
  return Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url')
}

function decodeSession(value: string): SessionUser | null {
  try {
    const raw = Buffer.from(value, 'base64url').toString('utf-8')
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

export function getSessionFromRequest(req: Request): SessionUser | null {
  const cookieHeader = req.headers.get('cookie') || ''
  const parts = cookieHeader.split(';').map((x) => x.trim())
  const target = parts.find((x) => x.startsWith(`${COOKIE_NAME}=`))
  if (!target) return null
  const value = target.slice(COOKIE_NAME.length + 1)
  return decodeSession(value)
}

export function withSession(session: SessionUser, response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/'
  })
  return response
}

export function clearSession(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, maxAge: 0, path: '/' })
  return response
}

export function requireRoles(req: Request, roles: UserRole[]): { ok: true; session: SessionUser } | { ok: false; response: NextResponse } {
  const session = getSessionFromRequest(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: '未登录' }, { status: 401 }) }
  }
  if (!roles.includes(session.role)) {
    return { ok: false, response: NextResponse.json({ error: '无权限' }, { status: 403 }) }
  }
  return { ok: true, session }
}
