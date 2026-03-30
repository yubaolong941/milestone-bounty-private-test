import type { CompanyRole, ExternalAuthType, PlatformRole } from '@/lib/types'

export type UserRole = 'admin' | 'reviewer' | 'finance' | 'staff' | 'external_contributor'

export interface SessionUser {
  userId: string
  role: UserRole
  platformRole?: PlatformRole
  githubLogin?: string
  githubUserId?: string
  walletAddress?: string
  externalAuthType?: ExternalAuthType
  activeCompanyId?: string
  activeCompanyRole?: CompanyRole
}

export const COOKIE_NAME = 'bp_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

let _cachedSecret: string | null = null

export function getSessionSecret(): string {
  if (_cachedSecret) return _cachedSecret
  const secret = process.env.SESSION_SECRET
    || process.env.APP_SESSION_SECRET
    || (process.env.NODE_ENV !== 'production' ? 'bp-dev-session-secret' : undefined)
  if (!secret) {
    throw new Error('Missing SESSION_SECRET or APP_SESSION_SECRET. Refusing to start the auth session.')
  }
  _cachedSecret = secret
  return secret
}

export function shouldUseSecureCookies(requestUrl?: string) {
  if (process.env.NODE_ENV === 'production') return true

  if (requestUrl) {
    try {
      return new URL(requestUrl).protocol === 'https:'
    } catch {
      return false
    }
  }

  const configuredBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL
  if (configuredBaseUrl) {
    try {
      if (new URL(configuredBaseUrl).protocol === 'https:') return true
    } catch {
      // ignore malformed base url and continue fallback checks
    }
  }

  return false
}

export function buildCookieOptions(input?: { maxAge?: number; requestUrl?: string }) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: shouldUseSecureCookies(input?.requestUrl),
    path: '/',
    ...(input?.maxAge !== undefined ? { maxAge: input.maxAge } : {})
  }
}

export function buildExpiredCookieOptions(requestUrl?: string) {
  return buildCookieOptions({ maxAge: 0, requestUrl })
}

function base64UrlToUint8Array(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function decodeBase64UrlBrowser(value: string) {
  return new TextDecoder().decode(base64UrlToUint8Array(value))
}

function secureEquals(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function signPayloadWeb(payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  let binary = ''
  const bytes = new Uint8Array(signed)
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function decodeSessionEdge(value: string): Promise<SessionUser | null> {
  try {
    const [payload, signature] = value.split('.')
    if (!payload || !signature) return null

    const expected = await signPayloadWeb(payload)
    if (!secureEquals(signature, expected)) return null

    return JSON.parse(decodeBase64UrlBrowser(payload)) as SessionUser
  } catch {
    return null
  }
}
