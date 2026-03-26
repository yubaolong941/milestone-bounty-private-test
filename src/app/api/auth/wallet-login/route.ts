import { NextResponse } from 'next/server'
import { withSession } from '@/lib/auth'

export async function POST(req: Request) {
  const body = await req.json()
  const walletAddress = String(body?.walletAddress || '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: '钱包地址格式不合法' }, { status: 400 })
  }
  const userId = `wallet:${walletAddress.toLowerCase()}`
  return withSession(
    {
      userId,
      role: 'external_contributor',
      walletAddress,
      externalAuthType: 'wallet_security_bounty'
    },
    NextResponse.json({ success: true, role: 'external_contributor', userId, walletAddress })
  )
}
