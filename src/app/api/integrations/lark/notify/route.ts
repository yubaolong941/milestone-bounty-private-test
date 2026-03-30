import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getCompanyContext, requireInternalUser } from '@/lib/auth'
import { recordIntegrationRunDb } from '@/lib/runtime-data-db'

function resolveLegacyWebhookConfig() {
  return {
    webhookUrl: process.env.LARK_BOT_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL || '',
    webhookSecret: process.env.LARK_BOT_WEBHOOK_SECRET || process.env.LARK_WEBHOOK_SECRET || '',
    callbackSecretConfigured: Boolean(process.env.LARK_CALLBACK_SECRET),
    defaultReceiveId: process.env.LARK_DEFAULT_RECEIVE_ID || ''
  }
}

function buildSignedWebhookHeaders(secret: string) {
  if (!secret) return null
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const sign = crypto.createHmac('sha256', `${timestamp}\n${secret}`).digest('base64')
  return { timestamp, sign }
}

async function resolveCompanyLarkConfig(req: Request, session: { activeCompanyId?: string; role: string }) {
  const body = req.method === 'POST' ? await req.clone().json().catch(() => ({})) : {}
  const requestedCompanyId = body?.companyId ? String(body.companyId) : session.activeCompanyId
  const companyContext = await getCompanyContext(session as never, requestedCompanyId)
  if (companyContext?.company) {
    return {
      companyId: companyContext.company.id,
      companyName: companyContext.company.name,
      webhookUrl: companyContext.company.larkWebhookUrl || '',
      webhookSecret: companyContext.company.larkWebhookSecret || '',
      callbackSecretConfigured: Boolean(process.env.LARK_CALLBACK_SECRET),
      defaultReceiveId: companyContext.company.larkDefaultReceiveId || '',
      source: 'company' as const
    }
  }

  const legacy = resolveLegacyWebhookConfig()
  return {
    companyId: requestedCompanyId,
    companyName: undefined,
    ...legacy,
    source: 'env' as const
  }
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const config = await resolveCompanyLarkConfig(req, auth.session)
  return NextResponse.json({
    configured: Boolean(config.webhookUrl),
    mode: config.webhookUrl ? 'bot_webhook' : 'unconfigured',
    source: config.source,
    companyId: config.companyId,
    companyName: config.companyName,
    callbackSecretConfigured: config.callbackSecretConfigured,
    defaultReceiveIdConfigured: Boolean(config.defaultReceiveId)
  })
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const config = await resolveCompanyLarkConfig(req, auth.session)
  if (!config.webhookUrl) {
    await recordIntegrationRunDb(
      'lark_notify',
      'failure',
      config.companyName
        ? `Company ${config.companyName} has not configured a Lark webhook`
        : 'Lark notification webhook is not configured'
    )
    return NextResponse.json({
      error: config.companyName
        ? `Company ${config.companyName} has not configured a Lark webhook`
        : 'Lark notification webhook is not configured'
    }, { status: 400 })
  }

  const message = String(body?.message || 'Task bounty awaiting approval').trim()
  const receiveId = String(body?.receiveId || config.defaultReceiveId || '').trim()
  const signedFields = buildSignedWebhookHeaders(config.webhookSecret)
  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...(signedFields || {}),
      msg_type: 'text',
      content: {
        text: receiveId ? `[receiveId:${receiveId}] ${message}` : message
      }
    })
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (typeof payload?.code === 'number' && payload.code !== 0)) {
    await recordIntegrationRunDb(
      'lark_notify',
      'failure',
      payload?.msg || payload?.message || `Lark webhook call failed: ${response.status}`
    )
    return NextResponse.json({
      error: payload?.msg || payload?.message || `Lark webhook call failed: ${response.status}`
    }, { status: 400 })
  }

  await recordIntegrationRunDb(
    'lark_notify',
    'success',
    config.companyName ? `Lark test message sent successfully for company ${config.companyName}` : 'Lark test message sent successfully'
  )

  return NextResponse.json({
    success: true,
    mode: 'bot_webhook',
    source: config.source,
    companyId: config.companyId,
    companyName: config.companyName,
    receiveId: receiveId || undefined,
    detail: 'Lark notification sent'
  })
}
