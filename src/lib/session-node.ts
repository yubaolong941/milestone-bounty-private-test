import { createHmac, timingSafeEqual } from 'crypto'
import { COOKIE_NAME, SessionUser, getSessionSecret } from './session'

function signPayload(payload: string) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf-8')
}

export function encodeSession(session: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url')
  const signature = signPayload(payload)
  return `${payload}.${signature}`
}

export function decodeSession(value: string): SessionUser | null {
  try {
    const [payload, signature] = value.split('.')
    if (!payload || !signature) return null

    const expected = signPayload(payload)
    const provided = Buffer.from(signature)
    const actual = Buffer.from(expected)
    if (provided.length !== actual.length || !timingSafeEqual(provided, actual)) {
      return null
    }

    return JSON.parse(decodeBase64Url(payload)) as SessionUser
  } catch {
    return null
  }
}

export function getSessionFromCookieHeader(cookieHeader: string): SessionUser | null {
  const parts = cookieHeader.split(';').map((part) => part.trim())
  const target = parts.find((part) => part.startsWith(`${COOKIE_NAME}=`))
  if (!target) return null
  return decodeSession(target.slice(COOKIE_NAME.length + 1))
}
