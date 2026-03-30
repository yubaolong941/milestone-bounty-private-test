import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { parsePaginationParams } from '@/lib/pagination'
import {
  getWorkflowEventById,
  listWorkflowEvents
} from '@/lib/repositories/workflow-event-repository'
import { recordWorkflowReplay } from '@/lib/workflow/events'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const taskId = url.searchParams.get('taskId') || undefined
  const eventType = url.searchParams.get('eventType') || undefined
  const pagination = parsePaginationParams(url.searchParams)

  return NextResponse.json({
    success: true,
    items: await listWorkflowEvents({
      status: status as 'processing' | 'processed' | 'dead_letter' | undefined,
      taskId,
      eventType,
      limit: pagination?.limit || 200,
      offset: pagination?.offset || 0
    }),
    ...(pagination ? { pagination: { page: pagination.page, pageSize: pagination.pageSize } } : {})
  })
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || 'replay')
  if (action !== 'replay') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const id = String(body?.id || '')
  const event = await getWorkflowEventById(id)
  if (!event) {
    return NextResponse.json({ error: 'WorkflowEvent not found' }, { status: 404 })
  }

  const replayRequest = event.payload?.replayRequest as {
    path?: string
    method?: string
    body?: string
    headers?: Record<string, string>
  } | undefined

  if (!replayRequest?.path) {
    return NextResponse.json({ error: 'This event does not support replay' }, { status: 400 })
  }

  await recordWorkflowReplay(event.id)

  const origin = new URL(req.url).origin
  const replayAttempt = String((event.replayCount || 0) + 1)
  const response = await fetch(`${origin}${replayRequest.path}`, {
    method: replayRequest.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: req.headers.get('cookie') || '',
      'x-workflow-replay-of': event.id,
      'x-workflow-replay-attempt': replayAttempt,
      ...(replayRequest.headers || {})
    },
    body: replayRequest.body || undefined
  })
  const payload = await response.json().catch(() => ({}))

  return NextResponse.json({
    success: response.ok,
    replayedEventId: event.id,
    replayAttempt,
    result: payload
  }, { status: response.ok ? 200 : 400 })
}
