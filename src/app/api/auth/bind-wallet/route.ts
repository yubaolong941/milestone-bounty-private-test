import { NextResponse } from 'next/server'
import { requireRoles, withSession } from '@/lib/auth'
import { verifyMessage } from 'ethers'

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
    return NextResponse.json({ error: '仅 GitHub 登录用户需要绑定钱包' }, { status: 400 })
  }

  const body = await req.json()
  const walletAddress = String(body?.walletAddress || '').trim()
  const message = String(body?.message || '')
  const signature = String(body?.signature || '')
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: '钱包地址格式不合法' }, { status: 400 })
  }
  if (!message || !signature) {
    return NextResponse.json({ error: '缺少 message/signature' }, { status: 400 })
  }

  const nonceInCookie = getCookie(req, 'bp_wallet_bind_nonce')
  if (!nonceInCookie) {
    return NextResponse.json({ error: 'challenge 已过期，请重新发起绑定' }, { status: 400 })
  }
  if (!message.includes(`Nonce: ${nonceInCookie}`)) {
    return NextResponse.json({ error: 'challenge nonce 不匹配' }, { status: 400 })
  }
  if (!message.includes(`UserId: ${auth.session.userId}`)) {
    return NextResponse.json({ error: 'challenge 用户不匹配' }, { status: 400 })
  }

  let recovered = ''
  try {
    recovered = verifyMessage(message, signature)
  } catch {
    return NextResponse.json({ error: '签名校验失败' }, { status: 400 })
  }
  if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
    return NextResponse.json({ error: '签名地址与钱包地址不一致' }, { status: 400 })
  }

  const nextSession = { ...auth.session, walletAddress }
  const response = withSession(nextSession, NextResponse.json({ success: true, walletAddress }))
  response.cookies.set('bp_wallet_bind_nonce', '', { httpOnly: true, maxAge: 0, path: '/' })
  return response
}
