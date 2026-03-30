import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { requireCompanyRoles } from '@/lib/auth'
import { buildCookieOptions } from '@/lib/session'

export async function POST(req: Request) {
  const auth = await requireCompanyRoles(req, ['company_owner', 'company_admin', 'company_finance'])
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const companyName = String(body?.companyName || '').trim()
  const walletAddress = String(body?.walletAddress || '').trim()
  if (!companyName) return NextResponse.json({ error: 'Missing companyName' }, { status: 400 })
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 })
  }

  const nonce = randomBytes(16).toString('hex')
  const issuedAt = new Date().toISOString()
  const message = [
    'WLFIAgent Company Wallet Binding',
    `Company: ${companyName}`,
    `Address: ${walletAddress}`,
    `UserId: ${auth.session.userId}`,
    `Nonce: ${nonce}`,
    `IssuedAt: ${issuedAt}`
  ].join('\n')

  const response = NextResponse.json({ success: true, message, nonce, issuedAt })
  response.cookies.set('bp_company_wallet_bind_nonce', nonce, buildCookieOptions({ maxAge: 10 * 60, requestUrl: req.url }))
  return response
}
