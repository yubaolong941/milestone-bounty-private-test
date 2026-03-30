import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import { CompanyContext } from '../helpers'
import { handleExecutePayout } from './execute-payout'

export async function handleRetryPayout(
  body: Record<string, unknown>,
  session: SessionUser,
  companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  return handleExecutePayout(body, session, companyContext, task, tasks, 'manual_retry')
}
