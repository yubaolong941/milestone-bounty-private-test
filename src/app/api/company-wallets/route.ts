import { NextResponse } from 'next/server'
import { verifyMessage } from 'ethers'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getActorRoleLabel, getCompanyContext, hasCompanyCapability, isPlatformAdmin, requireCompanyRoles, requireInternalUser } from '@/lib/auth'
import { buildExpiredCookieOptions } from '@/lib/session'
import { parsePaginationParams } from '@/lib/pagination'
import {
  deactivateOtherCompanyWallets,
  findCompanyWallet,
  getCompanyById,
  getCompanyWalletById,
  insertAuditLog,
  insertCompanyWallet,
  listCompanyWallets,
  updateCompanyFields,
  updateCompanyWallet
} from '@/lib/access-control-db'
import { CompanyWalletConfig } from '@/lib/types'
import { upsertWalletIdentityBinding } from '@/lib/identity-registry'
import { parseBody, evmAddressSchema } from '@/lib/validation'

const bindWalletSchema = z.object({
  action: z.literal('bind').optional(),
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  walletLabel: z.string().optional(),
  walletAddress: evmAddressSchema,
  network: z.string().optional(),
  tokenSymbol: z.string().optional(),
  tokenAddress: z.string().optional(),
  message: z.string().min(1, 'message is required'),
  signature: z.string().min(1, 'signature is required'),
  active: z.boolean().optional()
}).passthrough()

const activateWalletSchema = z.object({
  action: z.literal('activate'),
  companyId: z.string().optional(),
  id: z.string().min(1, 'wallet id is required')
}).passthrough()

function getCookie(req: Request, key: string): string | null {
  const cookieHeader = req.headers.get('cookie') || ''
  const part = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${key}=`))
  if (!part) return null
  return decodeURIComponent(part.slice(key.length + 1))
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const companyId = url.searchParams.get('companyId') || auth.session.activeCompanyId
  if (!companyId) {
    if (!isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Missing companyId' }, { status: 400 })
    }
    const items = await listCompanyWallets(undefined, { pagination: pagination || undefined })
    return NextResponse.json(pagination ? {
      items,
      pagination: { page: pagination.page, pageSize: pagination.pageSize }
    } : items)
  }

  if (!isPlatformAdmin(auth.session)) {
    const context = await getCompanyContext(auth.session, companyId)
    if (!context || !hasCompanyCapability(context.membership?.role, 'company.read')) {
      return NextResponse.json({ error: 'Not authorized to view company wallets' }, { status: 403 })
    }
  }
  const items = await listCompanyWallets(companyId, { pagination: pagination || undefined })
  return NextResponse.json(pagination ? {
    items,
    pagination: { page: pagination.page, pageSize: pagination.pageSize }
  } : items)
}

export async function POST(req: Request) {
  const auth = await requireCompanyRoles(req, ['company_owner', 'company_admin', 'company_finance'])
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || 'bind')
  const companyId = String(body?.companyId || auth.companyId)
  const company = await getCompanyById(companyId)
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  if (action === 'bind') {
    const validation = parseBody(bindWalletSchema, body)
    if (!validation.success) return validation.response
    const companyName = String(body?.companyName || company.name).trim()
    const walletLabel = body?.walletLabel ? String(body.walletLabel).trim() : undefined
    const walletAddress = String(body?.walletAddress || '').trim()
    const network = String(body?.network || process.env.AGENTPAY_NETWORK || process.env.WLFI_NETWORK || 'bsc').trim()
    const tokenSymbol = String(body?.tokenSymbol || process.env.AGENTPAY_TOKEN_SYMBOL || process.env.WLFI_TOKEN_SYMBOL || 'USD1').trim().toUpperCase()
    const tokenAddress = body?.tokenAddress
      ? String(body.tokenAddress).trim()
      : (process.env.AGENTPAY_TOKEN_ADDRESS || process.env.WLFI_TOKEN_ADDRESS || undefined)
    const message = String(body?.message || '')
    const signature = String(body?.signature || '')
    const nonceInCookie = getCookie(req, 'bp_company_wallet_bind_nonce')

    if (!companyName) return NextResponse.json({ error: 'Missing companyName' }, { status: 400 })
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 })
    }
    if (!message || !signature || !nonceInCookie) {
      return NextResponse.json({ error: 'Missing challenge or signature information' }, { status: 400 })
    }
    if (!message.includes(`Company: ${companyName}`) || !message.includes(`Address: ${walletAddress}`) || !message.includes(`Nonce: ${nonceInCookie}`)) {
      return NextResponse.json({ error: 'Challenge validation failed' }, { status: 400 })
    }

    let recovered = ''
    try {
      recovered = verifyMessage(message, signature)
    } catch {
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 })
    }
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Recovered signer address does not match wallet address' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const existing = await findCompanyWallet(companyId, companyName)
    const nextItem: CompanyWalletConfig = existing || {
      id: uuidv4(),
      companyId,
      companyName,
      walletLabel,
      walletAddress,
      network,
      tokenSymbol,
      tokenAddress,
      active: true,
      verificationMethod: 'wallet_signature',
      verifiedSignatureAddress: recovered,
      verifiedByUserId: auth.session.userId,
      verifiedByGithubLogin: auth.session.githubLogin,
      verifiedAt: now,
      lastUsedAt: undefined,
      createdAt: now,
      updatedAt: now
    }

    nextItem.companyId = companyId
    nextItem.walletLabel = walletLabel
    nextItem.walletAddress = walletAddress
    nextItem.network = network
    nextItem.tokenSymbol = tokenSymbol
    nextItem.tokenAddress = tokenAddress
    nextItem.active = body?.active !== false
    nextItem.verificationMethod = 'wallet_signature'
    nextItem.verifiedSignatureAddress = recovered
    nextItem.verifiedByUserId = auth.session.userId
    nextItem.verifiedByGithubLogin = auth.session.githubLogin
    nextItem.verifiedAt = now
    nextItem.updatedAt = now

    const saved = existing
      ? await updateCompanyWallet(existing.id, nextItem)
      : await insertCompanyWallet(nextItem)

    if (nextItem.active) {
      await deactivateOtherCompanyWallets(companyId, nextItem.id)
    }
    await updateCompanyFields(company.id, { activeWalletId: nextItem.id })
    await insertAuditLog({
      companyId,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session, membershipRole: auth.membership?.role }),
      action: existing ? 'company_wallet.update' : 'company_wallet.bind',
      targetType: 'company_wallet',
      targetId: nextItem.id,
      summary: `${existing ? 'Updated' : 'Bound'} company wallet ${walletAddress}`,
      metadata: {
        walletLabel,
        walletAddress,
        network,
        tokenSymbol,
        active: nextItem.active
      },
      createdAt: now
    })
    await upsertWalletIdentityBinding({
      actorRole: 'company_operator',
      walletAddress,
      authSource: 'wallet_signature'
    })
    const response = NextResponse.json({ success: true, item: saved })
    response.cookies.set('bp_company_wallet_bind_nonce', '', buildExpiredCookieOptions(req.url))
    return response
  }

  if (action === 'activate') {
    const validation = parseBody(activateWalletSchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const target = await getCompanyWalletById(id)
    if (target && target.companyId !== companyId) return NextResponse.json({ error: 'Company wallet not found' }, { status: 404 })
    if (!target) return NextResponse.json({ error: 'Company wallet not found' }, { status: 404 })
    await deactivateOtherCompanyWallets(companyId, id)
    const updated = await updateCompanyWallet(id, { active: true })
    await updateCompanyFields(company.id, { activeWalletId: id })
    await insertAuditLog({
      companyId,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session, membershipRole: auth.membership?.role }),
      action: 'company_wallet.activate',
      targetType: 'company_wallet',
      targetId: id,
      summary: `Activated company wallet ${target.walletAddress}`,
      metadata: { walletAddress: target.walletAddress },
      createdAt: new Date().toISOString()
    })
    return NextResponse.json({ success: true, item: updated })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
