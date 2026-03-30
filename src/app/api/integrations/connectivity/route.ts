import { NextResponse } from 'next/server'
import { getCompanyContext, requireInternalUser } from '@/lib/auth'
import { deriveCompanyIntegrationConnectivity } from '@/lib/integration-connectivity'
import { listIntegrationHealthStatesDb, listRepoConfigsDb } from '@/lib/runtime-data-db'

async function resolveCompany(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth

  const url = new URL(req.url)
  const queryCompanyId = url.searchParams.get('companyId') || undefined
  const body = req.method === 'POST' ? await req.clone().json().catch(() => ({})) : {}
  const requestedCompanyId = body?.companyId ? String(body.companyId) : queryCompanyId
  const context = await getCompanyContext(auth.session, requestedCompanyId || auth.session.activeCompanyId)

  if (!context?.company) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'No valid company context found' }, { status: 404 })
    }
  }

  return {
    ok: true as const,
    session: auth.session,
    company: context.company
  }
}

async function buildPayload(companyId: string) {
  const [repos, integrationStates] = await Promise.all([
    listRepoConfigsDb({ companyId, includeGlobal: false }),
    listIntegrationHealthStatesDb()
  ])
  return {
    repos,
    integrationStates
  }
}

export async function GET(req: Request) {
  const resolved = await resolveCompany(req)
  if (!resolved.ok) return resolved.response

  const { repos, integrationStates } = await buildPayload(resolved.company.id)
  const connectivity = deriveCompanyIntegrationConnectivity({
    company: resolved.company,
    repos,
    integrationStates
  })

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    companyId: resolved.company.id,
    companyName: resolved.company.name,
    connectivity
  })
}

export async function POST(req: Request) {
  const resolved = await resolveCompany(req)
  if (!resolved.ok) return resolved.response

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || 'checkAll')
  const origin = new URL(req.url).origin
  const companyId = resolved.company.id

  async function trigger(path: string, init?: RequestInit) {
    const response = await fetch(`${origin}${path}`, {
      ...(init || {}),
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') || '',
        ...(init?.headers || {})
      }
    })
    const payload = await response.json().catch(() => ({}))
    return {
      ok: response.ok && payload?.success !== false,
      payload
    }
  }

  const results: Record<string, unknown> = {}

  if (action === 'checkGitHub' || action === 'checkAll') {
    const github = await trigger('/api/integrations/github/issues', {
      method: 'POST',
      body: JSON.stringify({ companyId })
    })
    results.github = github.payload
  }

  if (action === 'checkMeegle' || action === 'checkAll') {
    const meegle = await trigger('/api/integrations/meegle/sync', {
      method: 'POST',
      body: JSON.stringify({ companyId })
    })
    results.meegle = meegle.payload
  }

  if (action === 'checkLark' || action === 'checkAll') {
    const lark = await trigger('/api/integrations/lark/notify', {
      method: 'POST',
      body: JSON.stringify({
        companyId,
        message: `Connectivity ping from tomo for ${resolved.company.name}`
      })
    })
    results.lark = lark.payload
  }

  const { repos, integrationStates } = await buildPayload(companyId)
  const connectivity = deriveCompanyIntegrationConnectivity({
    company: resolved.company,
    repos,
    integrationStates
  })

  const success = connectivity.overallReady
    || Object.values(results).some((item) => Boolean((item as { success?: boolean })?.success))

  return NextResponse.json({
    success,
    checkedAt: new Date().toISOString(),
    companyId,
    companyName: resolved.company.name,
    connectivity,
    results
  }, { status: success ? 200 : 400 })
}
