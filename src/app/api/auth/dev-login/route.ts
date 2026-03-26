import { NextResponse } from 'next/server'
import { UserRole, withSession } from '@/lib/auth'

export async function POST(req: Request) {
  const body = await req.json()
  const role = (body?.role || 'staff') as UserRole
  const allowed: UserRole[] = ['admin', 'reviewer', 'finance', 'staff', 'external_contributor']
  if (!allowed.includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 })

  const userId = body?.userId || (role === 'external_contributor' ? 'ext-demo-user' : 'staff-demo-user')
  const externalAuthType = role === 'external_contributor'
    ? (body?.externalAuthType || 'github_code_bounty')
    : undefined
  const githubLogin = role === 'external_contributor' && externalAuthType === 'github_code_bounty'
    ? (body?.githubLogin || 'external-demo')
    : undefined
  const walletAddress = role === 'external_contributor'
    ? (body?.walletAddress || (externalAuthType === 'wallet_security_bounty' ? '0x0000000000000000000000000000000000000000' : undefined))
    : undefined

  return withSession(
    { userId, role, githubLogin, walletAddress, externalAuthType },
    NextResponse.json({ success: true, role, userId, githubLogin, walletAddress, externalAuthType })
  )
}
