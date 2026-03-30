/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * How it works:
 *   1. On page load the frontend calls GET /api/auth/csrf, which generates a
 *      random token, stores it in a non-httpOnly cookie (__csrf), and returns
 *      the same token in the JSON body.
 *   2. For every state-mutating request (POST / PUT / PATCH / DELETE) the
 *      frontend reads the token from the cookie (or from the initial response)
 *      and sends it back in the `x-csrf-token` request header.
 *   3. The server reads both values and rejects the request when they differ.
 *
 * NOTE: All mutation API routes (POST/PUT/PATCH/DELETE) should wrap their
 * handler with `withCsrfProtection`, or call `validateCsrf(req)` directly,
 * before performing any state changes. GET/HEAD/OPTIONS are considered safe
 * and are always allowed through.
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { shouldUseSecureCookies } from '@/lib/session'

export const CSRF_COOKIE_NAME = '__csrf'
export const CSRF_HEADER_NAME = 'x-csrf-token'

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random CSRF token as a 64-character hex string.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Sets the `__csrf` cookie on `response`.
 *
 * The cookie is intentionally NOT httpOnly so that client-side JavaScript can
 * read it and echo it back in the `x-csrf-token` request header.
 */
export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: shouldUseSecureCookies(),
    path: '/',
  })
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** HTTP methods that do not mutate server state — CSRF is not required. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Validates the CSRF token for an incoming request.
 *
 * Returns `true` when:
 *   - The request uses a safe HTTP method (GET / HEAD / OPTIONS), or
 *   - The `__csrf` cookie value and the `x-csrf-token` header value are both
 *     present and match (compared with a timing-safe equality check).
 *
 * Returns `false` when the token is missing or does not match.
 */
export function validateCsrf(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return true
  }

  const cookieHeader = req.headers.get('cookie') ?? ''
  const cookieToken = parseCsrfCookie(cookieHeader)
  const headerToken = req.headers.get(CSRF_HEADER_NAME)

  if (!cookieToken || !headerToken) {
    return false
  }

  // Use timingSafeEqual to prevent timing attacks.
  // Both Buffers must be the same length for timingSafeEqual to work.
  if (cookieToken.length !== headerToken.length) {
    return false
  }

  try {
    return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  } catch {
    return false
  }
}

/** Parses the raw `Cookie` header string and returns the __csrf value if found. */
function parseCsrfCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.split('=')
    const name = rawName.trim()
    if (name === CSRF_COOKIE_NAME) {
      return rest.join('=').trim() || null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Handler wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a Next.js API route handler with CSRF validation.
 *
 * Usage:
 * ```ts
 * export const POST = withCsrfProtection(async (req) => {
 *   // handler body — only reached when CSRF token is valid
 *   return NextResponse.json({ ok: true })
 * })
 * ```
 */
export function withCsrfProtection(
  handler: (req: Request) => Promise<NextResponse>
): (req: Request) => Promise<NextResponse> {
  return async (req: Request): Promise<NextResponse> => {
    if (!validateCsrf(req)) {
      return NextResponse.json(
        { error: 'Invalid or missing CSRF token' },
        { status: 403 }
      )
    }
    return handler(req)
  }
}
