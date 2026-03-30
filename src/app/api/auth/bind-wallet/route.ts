import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRoles, withSession } from '@/lib/auth'
import { buildExpiredCookieOptions } from '@/lib/session'
import {
  createGithubWalletBinding,
  isEvmWalletAddress,
  verifyWalletSignature,
  WALLET_BIND_NONCE_COOKIE
} from '@/lib/identity-registry'
import { parseBody, evmAddressSchema } from '@/lib/validation'

const bindWalletSchema = z.object({
  walletAddress: evmAddressSchema,
  message: z.string().min(1, 'message is required'),
  signature: z.string().min(1, 'signature is required')
}).passthrough()

function getCookie(req: Request, key: string): string | null {
  const cookieHeader = req.headers.get('cookie') || ''
  const part = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${key}=`))
  if (!part) return null
  return decodeURIComponent(part.slice(key.length + 1))
}

export async function POST(req: Request) {
  const auth = requireRoles(req, ['external_contributor'])
  if (!auth.ok) return auth.response

  if (auth.session.externalAuthType !== 'github_code_bounty') {
    return NextResponse.json({ error: 'Only GitHub-authenticated users need to bind a wallet' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const validation = parseBody(bindWalletSchema, body)
  if (!validation.success) return validation.response
  const walletAddress = String(body?.walletAddress || '').trim()
  const message = String(body?.message || '')
  const signature = String(body?.signature || '')
  if (!isEvmWalletAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 })
  }
  if (!message || !signature) {
    return NextResponse.json({ error: 'Missing message/signature' }, { status: 400 })
  }

  const nonceInCookie = getCookie(req, WALLET_BIND_NONCE_COOKIE)
  if (!nonceInCookie) {
    return NextResponse.json({ error: 'Challenge has expired; please initiate binding again' }, { status: 400 })
  }
  if (!message.includes(`Nonce: ${nonceInCookie}`)) {
    return NextResponse.json({ error: 'Challenge nonce does not match' }, { status: 400 })
  }
  if (!message.includes(`UserId: ${auth.session.userId}`)) {
    return NextResponse.json({ error: 'Challenge user does not match' }, { status: 400 })
  }

  const verified = verifyWalletSignature({ walletAddress, message, signature })
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

  const nextSession = { ...auth.session, walletAddress }
  const binding = await createGithubWalletBinding(auth.session, walletAddress)
  const response = withSession(nextSession, NextResponse.json({ success: true, walletAddress, binding }))
  response.cookies.set(WALLET_BIND_NONCE_COOKIE, '', buildExpiredCookieOptions(req.url))
  return response
}
