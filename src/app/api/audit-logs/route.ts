import { NextResponse } from 'next/server'
import { getCompanyContext, hasCompanyCapability, isPlatformAdmin, requireInternalUser } from '@/lib/auth'
import { parsePaginationParams } from '@/lib/pagination'
import { listAuditLogs } from '@/lib/access-control-db'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const companyId = url.searchParams.get('companyId') || auth.session.activeCompanyId
  const pagination = parsePaginationParams(url.searchParams)

  const format = url.searchParams.get('format') || 'json'

  if (!companyId) {
    if (!isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'Missing companyId' }, { status: 400 })
    }
    const result = await listAuditLogs(undefined, { pagination: pagination || undefined })
    const items = Array.isArray(result) ? result : result.items
    const total = Array.isArray(result) ? items.length : result.total
    if (format === 'csv') {
      const csv = ['id,companyId,actorUserId,actorRole,action,targetType,targetId,summary,createdAt']
        .concat(items.map((item) =>
          [item.id, item.companyId || '', item.actorUserId, item.actorRole || '', item.action, item.targetType, item.targetId, JSON.stringify(item.summary), item.createdAt].join(',')
        ))
        .join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="audit-logs.csv"'
        }
      })
    }
    return NextResponse.json(pagination ? {
      items,
      pagination: { page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) }
    } : items)
  }

  const context = await getCompanyContext(auth.session, companyId)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized to view this company\'s audit logs' }, { status: 403 })
  }
  if (!isPlatformAdmin(auth.session) && !hasCompanyCapability(context.membership?.role, 'audit.view')) {
    return NextResponse.json({ error: 'Unauthorized to view this company\'s audit logs' }, { status: 403 })
  }
  const result = await listAuditLogs(companyId, { pagination: pagination || undefined })
  const items = Array.isArray(result) ? result : result.items
  const total = Array.isArray(result) ? items.length : result.total
  if (format === 'csv') {
    const csv = ['id,companyId,actorUserId,actorRole,action,targetType,targetId,summary,createdAt']
      .concat(items.map((item) =>
        [item.id, item.companyId || '', item.actorUserId, item.actorRole || '', item.action, item.targetType, item.targetId, JSON.stringify(item.summary), item.createdAt].join(',')
      ))
      .join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="audit-logs.csv"'
      }
    })
  }
  return NextResponse.json(pagination ? {
    items,
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) }
  } : items)
}
