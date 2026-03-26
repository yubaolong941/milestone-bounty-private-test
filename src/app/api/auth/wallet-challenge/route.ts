import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireRoles } from '@/lib/auth'

export async function POST(req: Request) {
  const auth = requireRoles(req, ['external_contributor'])
  if (!auth.ok) return auth.response
  if (auth.session.externalAuthType !== 'github_code_bounty') {
    return NextResponse.json({ error: '仅 GitHub 登录用户可发起钱包绑定 challenge' }, { status: 400 })
  }

  const body = await req.json()
  const walletAddress = String(body?.walletAddress || '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: '钱包地址格式不合法' }, { status: 400 })
  }

  const nonce = randomBytes(16).toString('hex')
  const issuedAt = new Date().toISOString()
  const message = [
    'BountyPay Wallet Binding',
    `Address: ${walletAddress}`,
    `UserId: ${auth.session.userId}`,
    `Nonce: ${nonce}`,
    `IssuedAt: ${issuedAt}`
  ].join('\n')

  const response = NextResponse.json({ success: true, message, nonce, issuedAt })
  response.cookies.set('bp_wallet_bind_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 10 * 60
  })
  return response
}
