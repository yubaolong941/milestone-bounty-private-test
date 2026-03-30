import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getActorRoleLabel, getCompanyContext, hasCompanyCapability, isPlatformAdmin, requireInternalUser } from '@/lib/auth'
import { insertAuditLog, listAuditLogs } from '@/lib/access-control-db'
import { paginateArray, parsePaginationParams } from '@/lib/pagination'
import { AuditLog, TreasuryFundingRecord } from '@/lib/types'
import { listTreasuryFundings, recordTreasuryFunding, toTreasuryFundingRecord, upsertTreasuryFunding } from '@/lib/repositories/treasury-funding-repository'
import { parseBody, evmAddressSchema } from '@/lib/validation'

const recordTreasuryFundingSchema = z.object({
  companyId: z.string().optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid txHash format (must be 0x + 64 hex chars)'),
  companyName: z.string().optional(),
  amount: z.number().optional(),
  tokenSymbol: z.string().optional(),
  network: z.string().optional(),
  fromAddress: evmAddressSchema.optional().or(z.literal('')),
  toAddress: evmAddressSchema.optional().or(z.literal(''))
}).passthrough()

function toLegacyFundingRecord(item: AuditLog): TreasuryFundingRecord | null {
  if (item.action !== 'treasury_funding.recorded' && item.action !== 'treasury_funding.applied_to_task') return null
  const metadata = item.metadata || {}
  const txHash = typeof metadata.txHash === 'string' ? metadata.txHash : undefined
  if (!txHash) return null

  return {
    id: item.id,
    companyId: item.companyId,
    companyName: typeof metadata.companyName === 'string' ? metadata.companyName : undefined,
    txHash,
    amount: Number(metadata.amount || 0),
    tokenSymbol: typeof metadata.tokenSymbol === 'string' ? metadata.tokenSymbol : 'USD1',
    network: typeof metadata.network === 'string' ? metadata.network : undefined,
    fromAddress: typeof metadata.fromAddress === 'string' ? metadata.fromAddress : undefined,
    toAddress: typeof metadata.toAddress === 'string' ? metadata.toAddress : undefined,
    taskId: typeof metadata.taskId === 'string' ? metadata.taskId : undefined,
    taskTitle: typeof metadata.taskTitle === 'string' ? metadata.taskTitle : undefined,
    status: item.action === 'treasury_funding.applied_to_task' ? 'applied' : 'recorded',
    source: (typeof metadata.source === 'string' && (metadata.source === 'wallet_payment' || metadata.source === 'task_publish'))
      ? metadata.source
      : (item.action === 'treasury_funding.applied_to_task' ? 'task_publish' : 'wallet_payment'),
    createdAt: item.createdAt,
    recordedByUserId: item.actorUserId
  }
}

async function ensureLegacyTreasuryFundingsBackfilled(companyId?: string) {
  const existing = await listTreasuryFundings(companyId)
  if (existing.length > 0) return existing

  const auditLogsResult = await listAuditLogs(companyId)
  const auditLogs = Array.isArray(auditLogsResult) ? auditLogsResult : auditLogsResult.items
  const legacy = auditLogs
    .map(toLegacyFundingRecord)
    .filter(Boolean) as TreasuryFundingRecord[]

  for (const item of legacy) {
    await upsertTreasuryFunding({
      id: item.id,
      companyId: item.companyId,
      companyName: item.companyName,
      txHash: item.txHash,
      amount: item.amount,
      allocatedAmount: item.status === 'applied' ? item.amount : 0,
      remainingAmount: item.status === 'applied' ? 0 : item.amount,
      tokenSymbol: item.tokenSymbol,
      network: item.network,
      fromAddress: item.fromAddress,
      toAddress: item.toAddress,
      status: item.status === 'applied' ? 'exhausted' : 'received',
      source: item.source,
      linkedTaskIds: item.taskId ? [item.taskId] : [],
      linkedTaskTitles: item.taskTitle ? [item.taskTitle] : [],
      recordedByUserId: item.recordedByUserId,
      metadata: {},
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      verifiedAt: item.createdAt
    })
  }

  return listTreasuryFundings(companyId)
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const companyContext = await getCompanyContext(auth.session, url.searchParams.get('companyId') || auth.session.activeCompanyId)
  const companyId = url.searchParams.get('companyId') || companyContext?.company.id
  if (!companyId) {
    if (!isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Missing companyId' }, { status: 400 })
    }
    const all = await ensureLegacyTreasuryFundingsBackfilled()
    const items = all.map(toTreasuryFundingRecord)
    return NextResponse.json(pagination ? paginateArray(items, pagination) : items)
  }

  const context = companyContext
  if (!context || (!isPlatformAdmin(auth.session) && !hasCompanyCapability(context.membership?.role, 'audit.view'))) {
    return NextResponse.json({ error: 'Not authorized to view this company\'s funding records' }, { status: 403 })
  }

  const items = await ensureLegacyTreasuryFundingsBackfilled(companyId)
  const normalized = items.map(toTreasuryFundingRecord)
  return NextResponse.json(pagination ? paginateArray(normalized, pagination) : normalized)
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const validation = parseBody(recordTreasuryFundingSchema, body)
  if (!validation.success) return validation.response
  const companyId = String(body?.companyId || auth.session.activeCompanyId || '').trim()
  const txHash = String(body?.txHash || '').trim()
  const companyName = String(body?.companyName || '').trim()

  if (!companyId) return NextResponse.json({ error: 'Missing companyId' }, { status: 400 })
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return NextResponse.json({ error: 'Invalid txHash format' }, { status: 400 })
  const context = await getCompanyContext(auth.session, companyId)
  if (!context || (!isPlatformAdmin(auth.session) && !hasCompanyCapability(context.membership?.role, 'wallet.manage'))) {
    return NextResponse.json({ error: 'Not authorized to record funding for this company' }, { status: 403 })
  }

  await insertAuditLog({
    id: uuidv4(),
    companyId,
    actorUserId: auth.session.userId,
    actorRole: getActorRoleLabel({ session: auth.session, membershipRole: context.membership?.role }),
    action: 'treasury_funding.recorded',
    targetType: 'treasury_funding',
    targetId: txHash,
    summary: `Recorded platform funding ${txHash}`,
    metadata: {
      companyName,
      txHash,
      amount: Number(body?.amount || 0),
      tokenSymbol: String(body?.tokenSymbol || 'USD1'),
      network: String(body?.network || ''),
      fromAddress: body?.fromAddress ? String(body.fromAddress) : undefined,
      toAddress: body?.toAddress ? String(body.toAddress) : undefined,
      source: 'wallet_payment'
    },
    createdAt: new Date().toISOString()
  })

  await recordTreasuryFunding({
    id: uuidv4(),
    companyId,
    companyName,
    txHash,
    amount: Number(body?.amount || 0),
    tokenSymbol: String(body?.tokenSymbol || 'USD1'),
    network: String(body?.network || ''),
    fromAddress: body?.fromAddress ? String(body.fromAddress) : undefined,
    toAddress: body?.toAddress ? String(body.toAddress) : undefined,
    source: 'wallet_payment',
    verifiedAt: new Date().toISOString(),
    recordedByUserId: auth.session.userId,
    metadata: {
      recordedFrom: 'platform_treasury_fundings_api'
    }
  })

  return NextResponse.json({ success: true })
}
