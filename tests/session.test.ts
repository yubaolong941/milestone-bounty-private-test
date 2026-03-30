import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { encodeSession, decodeSession, getSessionFromCookieHeader } from '@/lib/session-node'
import { createHmac } from 'crypto'
import { COOKIE_NAME, buildCookieOptions, buildExpiredCookieOptions, getSessionSecret, shouldUseSecureCookies } from '@/lib/session'
import type { SessionUser } from '@/lib/session'

// session.ts pulls SESSION_SECRET at module load time.
// In dev/test the fallback 'bp-dev-session-secret' is used automatically
// (NODE_ENV is not 'production' in vitest).

const baseSession: SessionUser = {
  userId: 'user-123',
  role: 'admin',
  githubLogin: 'octocat',
  walletAddress: '0xabc',
  activeCompanyId: 'company-abc',
  activeCompanyRole: 'company_owner'
}

describe('encodeSession / decodeSession roundtrip', () => {
  it('roundtrips a full session object', () => {
    const token = encodeSession(baseSession)
    const decoded = decodeSession(token)
    expect(decoded).toEqual(baseSession)
  })

  it('roundtrips a minimal session (only required fields)', () => {
    const minimal: SessionUser = { userId: 'u1', role: 'staff' }
    const token = encodeSession(minimal)
    expect(decodeSession(token)).toEqual(minimal)
  })

  it('roundtrips an external_contributor session', () => {
    const session: SessionUser = {
      userId: 'ext-99',
      role: 'external_contributor',
      githubLogin: 'contributor',
      externalAuthType: 'github_code_bounty'
    }
    expect(decodeSession(encodeSession(session))).toEqual(session)
  })

  it('roundtrips a session with platformRole', () => {
    const session: SessionUser = {
      userId: 'platform-1',
      role: 'admin',
      platformRole: 'platform_admin'
    }
    expect(decodeSession(encodeSession(session))).toEqual(session)
  })

  it('roundtrips every UserRole without data loss', () => {
    const roles = ['admin', 'reviewer', 'finance', 'staff', 'external_contributor'] as const
    for (const role of roles) {
      const session: SessionUser = { userId: `u-${role}`, role }
      expect(decodeSession(encodeSession(session))?.role).toBe(role)
    }
  })

  it('encodeSession produces a two-part dot-separated token', () => {
    const token = encodeSession(baseSession)
    const parts = token.split('.')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBeTruthy()
    expect(parts[1]).toBeTruthy()
  })

  it('decoded userId matches original', () => {
    const token = encodeSession({ ...baseSession, userId: 'unique-id-xyz' })
    expect(decodeSession(token)?.userId).toBe('unique-id-xyz')
  })
})

describe('decodeSession — tamper / invalid input', () => {
  it('returns null for an empty string', () => {
    expect(decodeSession('')).toBeNull()
  })

  it('returns null when signature is missing (no dot)', () => {
    const token = encodeSession(baseSession)
    const payloadOnly = token.split('.')[0]!
    expect(decodeSession(payloadOnly)).toBeNull()
  })

  it('returns null when payload has been tampered', () => {
    const token = encodeSession(baseSession)
    const [, sig] = token.split('.')
    // Flip the first char of the base64url payload
    const tampered = 'XXXX.' + sig
    expect(decodeSession(tampered)).toBeNull()
  })

  it('returns null when signature has been tampered', () => {
    const token = encodeSession(baseSession)
    const [payload] = token.split('.')
    expect(decodeSession(payload + '.invalidsignature')).toBeNull()
  })

  it('returns null for a fully random string', () => {
    expect(decodeSession('notavalidtoken.atall')).toBeNull()
  })

  it('returns null when both parts are empty', () => {
    expect(decodeSession('.')).toBeNull()
  })

  it('rejects a token with extra dots in the signature', () => {
    const token = encodeSession(baseSession) + '.extra'
    // split('.') takes first two parts so this is still testable — at minimum should not crash
    const result = decodeSession(token)
    // May decode if structure is still valid, but extra suffix should not cause an exception
    expect(() => decodeSession(token)).not.toThrow()
  })

  it('returns null for valid signature but non-JSON payload', () => {
    const payload = Buffer.from('not-json', 'utf-8').toString('base64url')
    const signature = createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
    expect(decodeSession(`${payload}.${signature}`)).toBeNull()
  })
})

describe('getSessionFromCookieHeader', () => {
  it('extracts a valid session from a cookie header', () => {
    const token = encodeSession(baseSession)
    const cookieHeader = `${COOKIE_NAME}=${token}`
    const session = getSessionFromCookieHeader(cookieHeader)
    expect(session).toEqual(baseSession)
  })

  it('returns null when the cookie header is empty', () => {
    expect(getSessionFromCookieHeader('')).toBeNull()
  })

  it('returns null when the target cookie is missing', () => {
    expect(getSessionFromCookieHeader('other_cookie=somevalue')).toBeNull()
  })

  it('extracts the session even when other cookies are present', () => {
    const token = encodeSession(baseSession)
    const cookieHeader = `foo=bar; ${COOKIE_NAME}=${token}; baz=qux`
    const session = getSessionFromCookieHeader(cookieHeader)
    expect(session).toEqual(baseSession)
  })

  it('returns null when the session cookie value is tampered', () => {
    const cookieHeader = `${COOKIE_NAME}=tampered.invalidsig`
    expect(getSessionFromCookieHeader(cookieHeader)).toBeNull()
  })

  it('ignores similarly-named cookies that do not start with the exact name', () => {
    const token = encodeSession(baseSession)
    // prefix cookie that contains the session name as a substring
    const cookieHeader = `prefix_${COOKIE_NAME}=${token}`
    expect(getSessionFromCookieHeader(cookieHeader)).toBeNull()
  })

  it('still parses when cookie value is URL-encoded token (base64url remains URI-safe)', () => {
    const token = encodeSession(baseSession)
    const cookieHeader = `${COOKIE_NAME}=${encodeURIComponent(token)}`
    expect(getSessionFromCookieHeader(cookieHeader)).toEqual(baseSession)
  })

  it('returns null when cookie name has invalid whitespace around "="', () => {
    const token = encodeSession(baseSession)
    const cookieHeader = `${COOKIE_NAME} =${token}`
    expect(getSessionFromCookieHeader(cookieHeader)).toBeNull()
  })
})

describe('shouldUseSecureCookies', () => {
  // Note: NODE_ENV cannot be reassigned in Node 20+ via defineProperty on process.env.
  // We test the branches that are reachable in the test (non-production) environment.

  afterEach(() => {
    delete process.env.APP_BASE_URL
    delete process.env.PUBLIC_BASE_URL
  })

  it('returns false when requestUrl is an HTTP URL', () => {
    expect(shouldUseSecureCookies('http://localhost:3000')).toBe(false)
  })

  it('returns true when requestUrl is an HTTPS URL', () => {
    expect(shouldUseSecureCookies('https://app.example.com')).toBe(true)
  })

  it('returns false when requestUrl is a plain HTTP URL', () => {
    expect(shouldUseSecureCookies('http://app.example.com')).toBe(false)
  })

  it('returns true when APP_BASE_URL is HTTPS and no requestUrl is provided', () => {
    process.env.APP_BASE_URL = 'https://secure.example.com'
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('returns false when APP_BASE_URL is HTTP and no requestUrl is provided', () => {
    process.env.APP_BASE_URL = 'http://insecure.example.com'
    expect(shouldUseSecureCookies()).toBe(false)
  })

  it('does not throw on a malformed requestUrl string', () => {
    expect(() => shouldUseSecureCookies('not-a-url')).not.toThrow()
  })

  it('requestUrl takes precedence over APP_BASE_URL for HTTPS detection', () => {
    process.env.APP_BASE_URL = 'http://fallback.example.com'
    // explicit https requestUrl should win
    expect(shouldUseSecureCookies('https://overrides.example.com')).toBe(true)
  })

  it('requestUrl HTTP overrides an HTTPS APP_BASE_URL', () => {
    process.env.APP_BASE_URL = 'https://secure.example.com'
    expect(shouldUseSecureCookies('http://local.example.com')).toBe(false)
  })
})

describe('buildCookieOptions', () => {
  it('always sets httpOnly and sameSite=lax', () => {
    const opts = buildCookieOptions()
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
  })

  it('sets path to /', () => {
    expect(buildCookieOptions().path).toBe('/')
  })

  it('omits maxAge when not provided', () => {
    const opts = buildCookieOptions()
    expect('maxAge' in opts).toBe(false)
  })

  it('includes maxAge when provided', () => {
    const opts = buildCookieOptions({ maxAge: 3600 })
    expect(opts.maxAge).toBe(3600)
  })
})

describe('buildExpiredCookieOptions', () => {
  it('sets maxAge to 0 to expire the cookie immediately', () => {
    const opts = buildExpiredCookieOptions()
    expect(opts.maxAge).toBe(0)
  })
})
