import { NextResponse } from 'next/server'
import { generateCsrfToken, setCsrfCookie } from '@/lib/csrf'

/**
 * GET /api/auth/csrf
 *
 * Issues a fresh CSRF token. The frontend should call this endpoint on page
 * load (or after login) and store the returned token so it can be sent back
 * in the `x-csrf-token` header on every state-mutating request.
 *
 * The same token is also written into the `__csrf` cookie (httpOnly: false)
 * so that JavaScript can read it directly from `document.cookie` if preferred.
 *
 * Example client usage:
 * ```ts
 * const { token } = await fetch('/api/auth/csrf').then(r => r.json())
 * // Later, on mutations:
 * fetch('/api/some-mutation', {
 *   method: 'POST',
 *   headers: { 'x-csrf-token': token, 'Content-Type': 'application/json' },
 *   body: JSON.stringify(payload),
 * })
 * ```
 */
export async function GET(_req: Request): Promise<NextResponse> {
  const token = generateCsrfToken()
  const response = NextResponse.json({ token })
  setCsrfCookie(response, token)
  return response
}
