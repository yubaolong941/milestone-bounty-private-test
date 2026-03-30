import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { inferHealthCheck } from '@/lib/ai'
import { listIntegrationHealthStatesDb } from '@/lib/runtime-data-db'
import { inspectPlatformPayoutWallet } from '@/lib/settlement'

function summarizeHealth(updatedAt?: string, lastStatus?: 'success' | 'failure') {
  if (!updatedAt) return 'unknown'
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  if (Number.isNaN(ageMs)) return 'unknown'
  if (lastStatus === 'failure') return 'degraded'
  if (ageMs > 15 * 60 * 1000) return 'stale'
  return 'ok'
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const [ai, integrations, treasuryPayout] = await Promise.all([
    inferHealthCheck(),
    listIntegrationHealthStatesDb(),
    inspectPlatformPayoutWallet()
  ])

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    ai,
    treasuryPayout,
    integrations: integrations.map((item) => ({
      ...item,
      health: summarizeHealth(item.updatedAt, item.lastStatus)
    }))
  })
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || 'retryAll')
  const origin = new URL(req.url).origin

  async function retryPath(path: string) {
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        cookie: req.headers.get('cookie') || ''
      }
    })
    const result = await res.json().catch(() => ({}))
    return { success: res.ok && Boolean(result?.success), result }
  }

  if (action === 'retryMeegle') {
    const { success, result } = await retryPath('/api/integrations/meegle/sync')
    return NextResponse.json({ success, retried: 'meegle_sync', result }, { status: success ? 200 : 400 })
  }
  if (action === 'retryGitHub') {
    const issueSync = await retryPath('/api/integrations/github/issues')
    const success = issueSync.success
    return NextResponse.json({
      success,
      retried: 'github_issue_sync',
      results: {
        issues: issueSync.result
      }
    }, { status: success ? 200 : 400 })
  }

  const [meegleRetry, githubRetry] = await Promise.all([
    retryPath('/api/integrations/meegle/sync'),
    retryPath('/api/integrations/github/issues')
  ])
  const success = meegleRetry.success && githubRetry.success
  return NextResponse.json(
    {
      success,
      retried: 'all',
      results: {
        meegle: meegleRetry.result,
        github: {
          issues: githubRetry.result
        }
      }
    },
    { status: success ? 200 : 400 }
  )
}
