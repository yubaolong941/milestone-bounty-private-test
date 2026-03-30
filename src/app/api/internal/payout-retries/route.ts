import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { verifySimpleWebhookSecret } from '@/lib/integrations'
import { listPaymentRetryJobsDb } from '@/lib/runtime-data-db'
import { processDuePaymentRetryJobs } from '@/lib/payment-retry-queue'

function hasSchedulerAccess(req: Request) {
  return verifySimpleWebhookSecret(
    req.headers.get('x-payout-retry-secret'),
    process.env.PAYOUT_RETRY_CRON_SECRET
  )
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok && !hasSchedulerAccess(req)) return auth.response

  const jobs = await listPaymentRetryJobsDb({ limit: 50 })

  return NextResponse.json({
    success: true,
    queueDepth: jobs.filter((job) => job.status === 'pending').length,
    jobs
  })
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok && !hasSchedulerAccess(req)) return auth.response

  const body = await req.json().catch(() => ({}))
  const limit = Math.max(1, Math.min(50, Number(body.limit || 10)))
  const result = await processDuePaymentRetryJobs({ limit })
  return NextResponse.json(result)
}
