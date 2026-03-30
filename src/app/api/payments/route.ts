import { NextResponse } from 'next/server'
import { getCompanyContext, requireInternalUser } from '@/lib/auth'
import { hasAnyCompanyCapability, isPlatformAdmin } from '@/lib/permissions'
import { listPaymentsDb } from '@/lib/runtime-data-db'
import { parsePaginationParams } from '@/lib/pagination'
import type { PaymentRecord } from '@/lib/types'

export const dynamic = 'force-dynamic'

function buildCsv(payments: PaymentRecord[]) {
  const header = 'id,projectName,reportTitle,amount,toName,toAddress,txHash,timestamp,repo,issueNumber,claimerGithubLogin,rewardToken'
  const rows = payments.map((item) => [
    item.id,
    JSON.stringify(item.projectName || ''),
    JSON.stringify(item.reportTitle || ''),
    item.amount,
    JSON.stringify(item.toName || ''),
    item.toAddress || '',
    item.txHash || '',
    item.timestamp || '',
    item.repo || '',
    item.issueNumber ?? '',
    item.claimerGithubLogin || '',
    item.rewardToken || ''
  ].join(','))
  return [header, ...rows].join('\n')
}

function formatResponse(result: PaymentRecord[] | { items: PaymentRecord[]; total: number }, pagination: ReturnType<typeof parsePaginationParams>, format: string) {
  const items = Array.isArray(result) ? result : result.items
  const total = Array.isArray(result) ? items.length : result.total

  if (format === 'csv') {
    return new NextResponse(buildCsv(items), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="payments.csv"'
      }
    })
  }

  if (pagination) {
    return NextResponse.json({
      items,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize))
      }
    })
  }

  return NextResponse.json(items)
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const format = url.searchParams.get('format') || 'json'
  const pagination = parsePaginationParams(url.searchParams)
  const companyContext = await getCompanyContext(auth.session, url.searchParams.get('companyId') || auth.session.activeCompanyId)
  const companyId = url.searchParams.get('companyId') || companyContext?.company.id

  if (isPlatformAdmin(auth.session) && !companyId) {
    const result = await listPaymentsDb(undefined, { pagination: pagination || undefined })
    return formatResponse(result, pagination, format)
  }

  if (!companyId) {
    return NextResponse.json({ error: 'No active company context selected' }, { status: 403 })
  }

  if (isPlatformAdmin(auth.session)) {
    const result = await listPaymentsDb(companyId, { pagination: pagination || undefined })
    return formatResponse(result, pagination, format)
  }

  const context = companyContext
  if (!context || !hasAnyCompanyCapability(context.membership?.role, ['audit.view', 'exports.view', 'payment.approve'])) {
    return NextResponse.json({ error: 'Unauthorized to view this company\'s payment records' }, { status: 403 })
  }

  const result = await listPaymentsDb(companyId, { pagination: pagination || undefined })
  return formatResponse(result, pagination, format)
}
