import { NextResponse } from 'next/server'
import { getCompanyById, getMembershipForIdentity, listActiveMembershipsForIdentity, listCompanies } from '@/lib/access-control-db'
import { CompanyMembership, CompanyRole } from '@/lib/types'
import { buildCookieOptions, buildExpiredCookieOptions, COOKIE_NAME, SESSION_TTL_SECONDS, SessionUser, UserRole } from './session'
import { encodeSession, getSessionFromCookieHeader } from './session-node'
import {
  CompanyCapability,
  COMPANY_PERMISSION_MATRIX,
  getActorRoleLabel,
  hasAnyCompanyCapability,
  hasCompanyCapability,
  isInternalUser,
  isPlatformAdmin
} from './permissions'

export type { SessionUser, UserRole } from './session'
export type { CompanyCapability } from './permissions'
export { COMPANY_PERMISSION_MATRIX, hasCompanyCapability, hasAnyCompanyCapability, isInternalUser, isPlatformAdmin, getActorRoleLabel } from './permissions'

export function getSessionFromRequest(req: Request): SessionUser | null {
  return getSessionFromCookieHeader(req.headers.get('cookie') || '')
}

export function withSession(
  session: SessionUser,
  response: NextResponse,
  options?: { maxAgeSeconds?: number; requestUrl?: string }
): NextResponse {
  response.cookies.set(
    COOKIE_NAME,
    encodeSession(session),
    buildCookieOptions({
      maxAge: options?.maxAgeSeconds ?? SESSION_TTL_SECONDS,
      requestUrl: options?.requestUrl
    })
  )
  return response
}

export function clearSession(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', buildExpiredCookieOptions())
  return response
}

export function requireRoles(req: Request, roles: UserRole[]): { ok: true; session: SessionUser } | { ok: false; response: NextResponse } {
  const session = getSessionFromRequest(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }
  }
  if (!roles.includes(session.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Access denied' }, { status: 403 }) }
  }
  return { ok: true, session }
}

export function requireInternalUser(req: Request): { ok: true; session: SessionUser } | { ok: false; response: NextResponse } {
  const session = getSessionFromRequest(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }
  }
  if (!isInternalUser(session)) {
    return { ok: false, response: NextResponse.json({ error: 'Accessible to internal members only' }, { status: 403 }) }
  }
  return { ok: true, session }
}

async function resolvePreferredCompanyContext(session: SessionUser) {
  const memberships = await listActiveMembershipsForIdentity({
    userId: session.userId,
    githubLogin: session.githubLogin,
    githubUserId: session.githubUserId,
    walletAddress: session.walletAddress
  })

  const preferredMembership = memberships[0]
  if (preferredMembership) {
    const company = await getCompanyById(preferredMembership.companyId)
    if (company) {
      return {
        company,
        membership: preferredMembership,
        effectiveRole: preferredMembership.role
      }
    }
  }

  if (isPlatformAdmin(session)) {
    const companies = await listCompanies()
    const company = companies[0]
    if (company) {
      return {
        company,
        membership: null,
        effectiveRole: session.activeCompanyRole
      }
    }
  }

  return null
}

export async function getCompanyContext(session: SessionUser, companyId = session.activeCompanyId) {
  if (!companyId) {
    return resolvePreferredCompanyContext(session)
  }
  const company = await getCompanyById(companyId)
  if (!company) {
    return resolvePreferredCompanyContext(session)
  }

  const membership = await getMembershipForIdentity(company.id, {
    userId: session.userId,
    githubLogin: session.githubLogin,
    githubUserId: session.githubUserId,
    walletAddress: session.walletAddress
  })

  if (!membership && !isPlatformAdmin(session)) {
    return resolvePreferredCompanyContext(session)
  }

  return {
    company,
    membership,
    effectiveRole: membership?.role || session.activeCompanyRole
  }
}

export async function requireCompanyRoles(
  req: Request,
  roles: CompanyRole[]
): Promise<{ ok: true; session: SessionUser; companyId: string; membership: CompanyMembership | null } | { ok: false; response: NextResponse }> {
  const session = getSessionFromRequest(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }
  }
  const context = await getCompanyContext(session)
  if (!context) {
    return { ok: false, response: NextResponse.json({ error: 'No valid company context selected' }, { status: 403 }) }
  }
  if (!isPlatformAdmin(session) && (!context.membership || !roles.includes(context.membership.role))) {
    return { ok: false, response: NextResponse.json({ error: 'Insufficient company permissions' }, { status: 403 }) }
  }
  return {
    ok: true,
    session: { ...session, activeCompanyRole: context.membership?.role || session.activeCompanyRole },
    companyId: context.company.id,
    membership: context.membership
  }
}

export async function requireCompanyCapability(
  req: Request,
  capability: CompanyCapability
): Promise<{ ok: true; session: SessionUser; companyId: string; membership: CompanyMembership | null } | { ok: false; response: NextResponse }> {
  const session = getSessionFromRequest(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }
  }

  const context = await getCompanyContext(session)
  if (!context) {
    return { ok: false, response: NextResponse.json({ error: 'No valid company context selected' }, { status: 403 }) }
  }

  if (!isPlatformAdmin(session) && !hasCompanyCapability(context.membership?.role, capability)) {
    return { ok: false, response: NextResponse.json({ error: `Missing permission: ${capability}` }, { status: 403 }) }
  }

  return {
    ok: true,
    session: { ...session, activeCompanyRole: context.membership?.role || session.activeCompanyRole },
    companyId: context.company.id,
    membership: context.membership
  }
}

export async function requireAnyCompanyCapability(
  req: Request,
  capabilities: CompanyCapability[]
): Promise<{ ok: true; session: SessionUser; companyId: string; membership: CompanyMembership | null } | { ok: false; response: NextResponse }> {
  const session = getSessionFromRequest(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }
  }

  const context = await getCompanyContext(session)
  if (!context) {
    return { ok: false, response: NextResponse.json({ error: 'No valid company context selected' }, { status: 403 }) }
  }

  if (!isPlatformAdmin(session) && !hasAnyCompanyCapability(context.membership?.role, capabilities)) {
    return { ok: false, response: NextResponse.json({ error: `Missing permissions: ${capabilities.join(' | ')}` }, { status: 403 }) }
  }

  return {
    ok: true,
    session: { ...session, activeCompanyRole: context.membership?.role || session.activeCompanyRole },
    companyId: context.company.id,
    membership: context.membership
  }
}
