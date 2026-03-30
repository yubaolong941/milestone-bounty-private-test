import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { listNotificationsDb, updateNotificationAckDb } from '@/lib/runtime-data-db'
import { parsePaginationParams } from '@/lib/pagination'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const acknowledged = url.searchParams.get('acknowledged')
  const items = await listNotificationsDb({
    companyId: auth.session.activeCompanyId,
    acknowledged: acknowledged === 'false' ? false : undefined,
    pagination: pagination || undefined
  })
  return NextResponse.json(pagination ? {
    items,
    pagination: { page: pagination.page, pageSize: pagination.pageSize }
  } : items)
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const body = await req.json().catch(() => ({}))
  const id = String(body?.id || '')
  const action = String(body?.action || 'ack')
  if (!id) return NextResponse.json({ error: 'Missing notification id' }, { status: 400 })

  const target = await updateNotificationAckDb(id, action === 'ack')
  if (!target) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  return NextResponse.json({ success: true, item: target })
}
