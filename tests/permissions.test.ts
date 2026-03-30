import { describe, expect, it } from 'vitest'
import {
  COMPANY_PERMISSION_MATRIX,
  hasCompanyCapability,
  hasAnyCompanyCapability,
  isPlatformAdmin,
  isInternalUser,
  isExternalContributor,
  canAccessInternalConsole,
  canAccessExternalConsole,
  getActorRoleLabel,
  getEffectiveCompanyRole
} from '@/lib/permissions'
import type { CompanyCapability } from '@/lib/permissions'
import type { CompanyRole } from '@/lib/types'
import type { SessionUser } from '@/lib/session'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return { userId: 'u1', role: 'admin', ...overrides }
}

const ALL_CAPABILITIES: CompanyCapability[] = [
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
]

const ALL_COMPANY_ROLES: CompanyRole[] = [
  'company_owner',
  'company_admin',
  'company_finance',
  'company_reviewer',
  'company_maintainer',
  'company_viewer'
]

// ---------------------------------------------------------------------------
// COMPANY_PERMISSION_MATRIX shape
// ---------------------------------------------------------------------------

describe('COMPANY_PERMISSION_MATRIX — structure', () => {
  it('defines an entry for every CompanyRole', () => {
    for (const role of ALL_COMPANY_ROLES) {
      expect(COMPANY_PERMISSION_MATRIX[role]).toBeDefined()
      expect(Array.isArray(COMPANY_PERMISSION_MATRIX[role])).toBe(true)
    }
  })

  it('only contains known capability strings', () => {
    for (const role of ALL_COMPANY_ROLES) {
      for (const cap of COMPANY_PERMISSION_MATRIX[role]) {
        expect(ALL_CAPABILITIES).toContain(cap)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// company_owner — full access
// ---------------------------------------------------------------------------

describe('company_owner capabilities', () => {
  it('has every capability', () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(hasCompanyCapability('company_owner', cap)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// company_admin — same as owner
// ---------------------------------------------------------------------------

describe('company_admin capabilities', () => {
  it('has every capability', () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(hasCompanyCapability('company_admin', cap)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// company_finance — limited set
// ---------------------------------------------------------------------------

describe('company_finance capabilities', () => {
  const allowed: CompanyCapability[] = ['company.read', 'wallet.manage', 'audit.view', 'payment.approve', 'exports.view']
  const denied: CompanyCapability[] = ['company.manage', 'member.manage', 'task.create', 'task.review', 'repo.manage', 'integration.manage']

  it.each(allowed)('grants %s', (cap) => {
    expect(hasCompanyCapability('company_finance', cap)).toBe(true)
  })

  it.each(denied)('denies %s', (cap) => {
    expect(hasCompanyCapability('company_finance', cap)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// company_reviewer — limited set
// ---------------------------------------------------------------------------

describe('company_reviewer capabilities', () => {
  const allowed: CompanyCapability[] = ['company.read', 'audit.view', 'task.review', 'exports.view']
  const denied: CompanyCapability[] = ['company.manage', 'member.manage', 'wallet.manage', 'task.create', 'payment.approve', 'repo.manage', 'integration.manage']

  it.each(allowed)('grants %s', (cap) => {
    expect(hasCompanyCapability('company_reviewer', cap)).toBe(true)
  })

  it.each(denied)('denies %s', (cap) => {
    expect(hasCompanyCapability('company_reviewer', cap)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// company_maintainer — limited set
// ---------------------------------------------------------------------------

describe('company_maintainer capabilities', () => {
  const allowed: CompanyCapability[] = ['company.read', 'task.create', 'repo.manage', 'integration.manage', 'exports.view']
  const denied: CompanyCapability[] = ['company.manage', 'member.manage', 'wallet.manage', 'audit.view', 'task.review', 'payment.approve']

  it.each(allowed)('grants %s', (cap) => {
    expect(hasCompanyCapability('company_maintainer', cap)).toBe(true)
  })

  it.each(denied)('denies %s', (cap) => {
    expect(hasCompanyCapability('company_maintainer', cap)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// company_viewer — minimal access
// ---------------------------------------------------------------------------

describe('company_viewer capabilities', () => {
  const allowed: CompanyCapability[] = ['company.read', 'exports.view']
  const denied: CompanyCapability[] = ['company.manage', 'member.manage', 'wallet.manage', 'audit.view', 'task.create', 'task.review', 'payment.approve', 'repo.manage', 'integration.manage']

  it.each(allowed)('grants %s', (cap) => {
    expect(hasCompanyCapability('company_viewer', cap)).toBe(true)
  })

  it.each(denied)('denies %s', (cap) => {
    expect(hasCompanyCapability('company_viewer', cap)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasCompanyCapability — edge cases
// ---------------------------------------------------------------------------

describe('hasCompanyCapability — edge cases', () => {
  it('returns false when role is undefined', () => {
    expect(hasCompanyCapability(undefined, 'company.read')).toBe(false)
  })

  it('returns false when role is undefined, regardless of capability', () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(hasCompanyCapability(undefined, cap)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// hasAnyCompanyCapability
// ---------------------------------------------------------------------------

describe('hasAnyCompanyCapability', () => {
  it('returns true if the role has at least one of the requested capabilities', () => {
    // company_viewer only has company.read and exports.view
    expect(hasAnyCompanyCapability('company_viewer', ['company.read', 'payment.approve'])).toBe(true)
  })

  it('returns false if the role has none of the requested capabilities', () => {
    expect(hasAnyCompanyCapability('company_viewer', ['payment.approve', 'wallet.manage'])).toBe(false)
  })

  it('returns false when role is undefined', () => {
    expect(hasAnyCompanyCapability(undefined, ['company.read'])).toBe(false)
  })

  it('returns false for an empty capabilities list', () => {
    expect(hasAnyCompanyCapability('company_owner', [])).toBe(false)
  })

  it('returns true when all requested capabilities are present', () => {
    expect(hasAnyCompanyCapability('company_admin', ['company.read', 'task.create'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isPlatformAdmin
// ---------------------------------------------------------------------------

describe('isPlatformAdmin', () => {
  it('returns true for role === admin', () => {
    expect(isPlatformAdmin(makeSession({ role: 'admin' }))).toBe(true)
  })

  it('returns true for platformRole === platform_admin even if role is not admin', () => {
    expect(isPlatformAdmin(makeSession({ role: 'staff', platformRole: 'platform_admin' }))).toBe(true)
  })

  it('returns false for a regular staff user', () => {
    expect(isPlatformAdmin(makeSession({ role: 'staff' }))).toBe(false)
  })

  it('returns false for external_contributor', () => {
    expect(isPlatformAdmin(makeSession({ role: 'external_contributor' }))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPlatformAdmin(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isPlatformAdmin(undefined)).toBe(false)
  })

  it('returns false for platformRole === platform_ops', () => {
    expect(isPlatformAdmin(makeSession({ role: 'staff', platformRole: 'platform_ops' }))).toBe(false)
  })

  it('returns false for platformRole === auditor', () => {
    expect(isPlatformAdmin(makeSession({ role: 'reviewer', platformRole: 'auditor' }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isInternalUser
// ---------------------------------------------------------------------------

describe('isInternalUser', () => {
  it('returns true for admin', () => {
    expect(isInternalUser(makeSession({ role: 'admin' }))).toBe(true)
  })

  it('returns true for staff', () => {
    expect(isInternalUser(makeSession({ role: 'staff' }))).toBe(true)
  })

  it('returns true for reviewer', () => {
    expect(isInternalUser(makeSession({ role: 'reviewer' }))).toBe(true)
  })

  it('returns true for finance', () => {
    expect(isInternalUser(makeSession({ role: 'finance' }))).toBe(true)
  })

  it('returns false for external_contributor', () => {
    expect(isInternalUser(makeSession({ role: 'external_contributor' }))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isInternalUser(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isInternalUser(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isExternalContributor
// ---------------------------------------------------------------------------

describe('isExternalContributor', () => {
  it('returns true for external_contributor role', () => {
    expect(isExternalContributor(makeSession({ role: 'external_contributor' }))).toBe(true)
  })

  it('returns false for admin', () => {
    expect(isExternalContributor(makeSession({ role: 'admin' }))).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isExternalContributor(null)).toBe(false)
    expect(isExternalContributor(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// canAccessInternalConsole / canAccessExternalConsole
// ---------------------------------------------------------------------------

describe('canAccessInternalConsole', () => {
  it('allows internal users', () => {
    expect(canAccessInternalConsole(makeSession({ role: 'staff' }))).toBe(true)
  })

  it('denies external contributors', () => {
    expect(canAccessInternalConsole(makeSession({ role: 'external_contributor' }))).toBe(false)
  })
})

describe('canAccessExternalConsole', () => {
  it('allows platform admins', () => {
    expect(canAccessExternalConsole(makeSession({ role: 'admin' }))).toBe(true)
  })

  it('allows external contributors', () => {
    expect(canAccessExternalConsole(makeSession({ role: 'external_contributor' }))).toBe(true)
  })

  it('denies regular staff', () => {
    expect(canAccessExternalConsole(makeSession({ role: 'staff' }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getEffectiveCompanyRole
// ---------------------------------------------------------------------------

describe('getEffectiveCompanyRole', () => {
  it('prefers membershipRole over session activeCompanyRole', () => {
    const result = getEffectiveCompanyRole({
      session: makeSession({ activeCompanyRole: 'company_viewer' }),
      membershipRole: 'company_admin'
    })
    expect(result).toBe('company_admin')
  })

  it('falls back to session activeCompanyRole when no membershipRole', () => {
    const result = getEffectiveCompanyRole({
      session: makeSession({ activeCompanyRole: 'company_finance' })
    })
    expect(result).toBe('company_finance')
  })

  it('returns undefined when neither is set', () => {
    expect(getEffectiveCompanyRole({})).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getActorRoleLabel
// ---------------------------------------------------------------------------

describe('getActorRoleLabel', () => {
  it('returns platformRole for a platform_admin session', () => {
    const session = makeSession({ role: 'admin', platformRole: 'platform_admin' })
    expect(getActorRoleLabel({ session })).toBe('platform_admin')
  })

  it('returns platform_admin string when session.role === admin (no platformRole set)', () => {
    // role===admin triggers isPlatformAdmin, platformRole is undefined, so it falls back to 'platform_admin' cast
    const session = makeSession({ role: 'admin' })
    // getActorRoleLabel returns session.platformRole || 'platform_admin'
    const label = getActorRoleLabel({ session })
    expect(label).toBe('platform_admin')
  })

  it('returns membershipRole when provided for non-admin session', () => {
    const session = makeSession({ role: 'staff' })
    expect(getActorRoleLabel({ session, membershipRole: 'company_reviewer' })).toBe('company_reviewer')
  })

  it('falls back to session.activeCompanyRole when no membershipRole', () => {
    const session = makeSession({ role: 'staff', activeCompanyRole: 'company_maintainer' })
    expect(getActorRoleLabel({ session })).toBe('company_maintainer')
  })

  it('falls back to session.role when no company role is available', () => {
    const session = makeSession({ role: 'reviewer' })
    expect(getActorRoleLabel({ session })).toBe('reviewer')
  })
})
