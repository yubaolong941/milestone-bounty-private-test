import { NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { buildCookieOptions } from '@/lib/session'
import {
  buildWalletChallengeMessage,
  isEvmWalletAddress,
  WALLET_BIND_NONCE_COOKIE,
  WALLET_LOGIN_NONCE_COOKIE
} from '@/lib/identity-registry'

export async function POST(req: Request) {
  const session = getSessionFromRequest(req)
  const body = await req.json().catch(() => ({}))
  const walletAddress = String(body?.walletAddress || '').trim()
  const purpose = String(body?.purpose || '').trim() || (session ? 'bind_wallet' : 'wallet_login')

  if (!isEvmWalletAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 })
  }

  if (purpose === 'bind_wallet') {
    if (!session || session.role !== 'external_contributor' || session.externalAuthType !== 'github_code_bounty') {
      return NextResponse.json({ error: 'Only GitHub-authenticated users can initiate a wallet binding challenge' }, { status: 400 })
    }

    const { nonce, issuedAt, message } = buildWalletChallengeMessage({
      purpose: 'bind_wallet',
      walletAddress,
      userId: session.userId
    })
    const response = NextResponse.json({ success: true, message, nonce, issuedAt, purpose })
    response.cookies.set(WALLET_BIND_NONCE_COOKIE, nonce, buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
    return response
  }

  const { nonce, issuedAt, message } = buildWalletChallengeMessage({
    purpose: 'wallet_login',
    walletAddress
  })
  const response = NextResponse.json({ success: true, message, nonce, issuedAt, purpose: 'wallet_login' })
  response.cookies.set(WALLET_LOGIN_NONCE_COOKIE, nonce, buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  return response
}
