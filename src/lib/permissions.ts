import type { CompanyRole, PlatformRole } from '@/lib/types'
import type { SessionUser, UserRole } from '@/lib/session'

export type InternalUserRole = Exclude<UserRole, 'external_contributor'>

export type CompanyCapability =
  | 'company.read'
  | 'company.manage'
  | 'member.manage'
  | 'wallet.manage'
  | 'audit.view'
  | 'task.create'
  | 'task.review'
  | 'payment.approve'
  | 'repo.manage'
  | 'integration.manage'
  | 'exports.view'

export const COMPANY_PERMISSION_MATRIX: Record<CompanyRole, CompanyCapability[]> = {
  company_owner: [
    'company.read',
    'company.manage',
    'member.manage',
    'wallet.manage',
    'audit.view',
    'task.create',
    'task.review',
    'payment.approve',
    'repo.manage',
    'integration.manage',
    'exports.view'
  ],
  company_admin: [
    'company.read',
    'company.manage',
    'member.manage',
    'wallet.manage',
    'audit.view',
    'task.create',
    'task.review',
    'payment.approve',
    'repo.manage',
    'integration.manage',
    'exports.view'
  ],
  company_finance: [
    'company.read',
    'wallet.manage',
    'audit.view',
    'payment.approve',
    'exports.view'
  ],
  company_reviewer: [
    'company.read',
    'audit.view',
    'task.review',
    'exports.view'
  ],
  company_maintainer: [
    'company.read',
    'task.create',
    'repo.manage',
    'integration.manage',
    'exports.view'
  ],
  company_viewer: [
    'company.read',
    'exports.view'
  ]
}

export function isPlatformAdmin(session: Pick<SessionUser, 'role' | 'platformRole'> | null | undefined) {
  if (!session) return false
  return session.role === 'admin' || session.platformRole === 'platform_admin'
}

export function isInternalUser(session: Pick<SessionUser, 'role'> | null | undefined) {
  if (!session) return false
  return session.role !== 'external_contributor'
}

export function isExternalContributor(session: Pick<SessionUser, 'role'> | null | undefined) {
  return session?.role === 'external_contributor'
}

export function hasCompanyCapability(role: CompanyRole | undefined, capability: CompanyCapability) {
  if (!role) return false
  return COMPANY_PERMISSION_MATRIX[role].includes(capability)
}

export function hasAnyCompanyCapability(role: CompanyRole | undefined, capabilities: CompanyCapability[]) {
  return capabilities.some((capability) => hasCompanyCapability(role, capability))
}

export function getEffectiveCompanyRole(input: {
  session?: Pick<SessionUser, 'activeCompanyRole'>
  membershipRole?: CompanyRole
}) {
  return input.membershipRole || input.session?.activeCompanyRole
}

export function canAccessInternalConsole(session: Pick<SessionUser, 'role' | 'platformRole'> | null | undefined) {
  return isInternalUser(session)
}

export function canAccessExternalConsole(session: Pick<SessionUser, 'role' | 'platformRole'> | null | undefined) {
  return isPlatformAdmin(session) || isExternalContributor(session)
}

export function getActorRoleLabel(input: {
  session: Pick<SessionUser, 'role' | 'platformRole' | 'activeCompanyRole'>
  membershipRole?: CompanyRole | null
}) {
  if (isPlatformAdmin(input.session)) {
    return (input.session.platformRole || 'platform_admin') as PlatformRole | string
  }
  return getEffectiveCompanyRole({ session: input.session, membershipRole: input.membershipRole || undefined }) || input.session.role
}
