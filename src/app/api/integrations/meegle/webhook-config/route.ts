import { NextResponse } from 'next/server'
import { getCompanyContext, requireInternalUser } from '@/lib/auth'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || url.origin
  const requestedCompanyId = url.searchParams.get('companyId') || auth.session.activeCompanyId
  const context = await getCompanyContext(auth.session, requestedCompanyId)

  if (!context?.company) {
    return NextResponse.json({ error: 'No valid company context found' }, { status: 404 })
  }
  if (requestedCompanyId && context.company.id !== requestedCompanyId) {
    return NextResponse.json({ error: 'Not authorized for this company context' }, { status: 403 })
  }

  const webhookUrl = new URL('/api/integrations/meegle/webhook', appBaseUrl)
  webhookUrl.searchParams.set('companyId', context.company.id)
  if (process.env.MEEGLE_WEBHOOK_SECRET) {
    webhookUrl.searchParams.set('secret', process.env.MEEGLE_WEBHOOK_SECRET)
  }

  return NextResponse.json({
    success: true,
    companyId: context.company.id,
    secretConfigured: Boolean(process.env.MEEGLE_WEBHOOK_SECRET),
    webhookUrl: webhookUrl.toString()
  })
}
