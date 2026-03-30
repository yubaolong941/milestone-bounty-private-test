import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withSession } from '@/lib/auth'
import { getRecipientProfileByWallet, upsertRecipientProfile } from '@/lib/access-control-db'
import { v4 as uuidv4 } from 'uuid'
import { buildExpiredCookieOptions } from '@/lib/session'
import {
  findBindingByWalletAddress,
  isEvmWalletAddress,
  verifyWalletSignature,
  WALLET_LOGIN_NONCE_COOKIE
} from '@/lib/identity-registry'
import { parseBody, evmAddressSchema } from '@/lib/validation'

const walletLoginSchema = z.object({
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
  const body = await req.json().catch(() => ({}))
  const validation = parseBody(walletLoginSchema, body)
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

  const nonceInCookie = getCookie(req, WALLET_LOGIN_NONCE_COOKIE)
  if (!nonceInCookie) {
    return NextResponse.json({ error: 'Challenge has expired; please initiate login again' }, { status: 400 })
  }
  if (!message.includes(`Address: ${walletAddress}`) || !message.includes(`Nonce: ${nonceInCookie}`)) {
    return NextResponse.json({ error: 'Challenge validation failed' }, { status: 400 })
  }

  const verified = verifyWalletSignature({ walletAddress, message, signature })
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

  const userId = `wallet:${walletAddress.toLowerCase()}`
  const binding = await findBindingByWalletAddress(walletAddress, 'bounty_claimer')
  const existingProfile = await getRecipientProfileByWallet(walletAddress)
  await upsertRecipientProfile({
    id: existingProfile?.id || uuidv4(),
    type: existingProfile?.type || 'individual',
    displayName: existingProfile?.displayName || binding?.githubLogin || walletAddress,
    githubLogin: binding?.githubLogin || existingProfile?.githubLogin,
    githubUserId: existingProfile?.githubUserId,
    walletAddress,
    externalUserId: existingProfile?.externalUserId || userId,
    identitySource: existingProfile?.githubLogin ? 'hybrid' : 'wallet_security_bounty',
    ownerUserId: existingProfile?.ownerUserId || userId,
    status: 'active',
    createdAt: existingProfile?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  const response = withSession(
    {
      userId,
      role: 'external_contributor',
      githubLogin: binding?.githubLogin,
      walletAddress,
      externalAuthType: 'wallet_security_bounty'
    },
    NextResponse.json({ success: true, role: 'external_contributor', userId, walletAddress, binding })
  )
  response.cookies.set(WALLET_LOGIN_NONCE_COOKIE, '', buildExpiredCookieOptions(req.url))
  return response
}
