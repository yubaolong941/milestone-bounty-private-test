import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { runMeegleSync } from '@/app/api/integrations/meegle/webhook/route'

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const result = await runMeegleSync({ companyId: normalizeOptionalString(url.searchParams.get('companyId')) })
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const result = await runMeegleSync({ companyId: normalizeOptionalString(body?.companyId) })
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
