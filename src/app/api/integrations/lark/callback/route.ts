import { NextResponse } from 'next/server'
import { verifySimpleWebhookSecret } from '@/lib/integrations'
import { tryAutoPayout } from '@/lib/payout-executor'
import { v4 as uuidv4 } from 'uuid'
import { appendPaymentDb, listTaskBountiesDb, saveTaskBountiesDb } from '@/lib/runtime-data-db'
import { classifyPaymentFailure } from '@/lib/payment-failures'
import { enqueueAutoRetryForTask } from '@/lib/payment-retry-queue'
import { hashWorkflowPayload } from '@/lib/workflow/events'

export async function POST(req: Request) {
  const body = await req.json()
  if (body?.challenge) return NextResponse.json({ challenge: body.challenge })

  const secretOk = verifySimpleWebhookSecret(
    req.headers.get('x-lark-secret'),
    process.env.LARK_CALLBACK_SECRET
  )
  if (!secretOk) return NextResponse.json({ error: 'Lark callback signature verification failed' }, { status: 401 })

  const action = body?.action
  const taskId = body?.taskId
  if (!action || !taskId) return NextResponse.json({ error: 'Missing action/taskId' }, { status: 400 })

  const tasks = await listTaskBountiesDb()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (action === 'reject') {
    task.status = 'disputed'
    task.updatedAt = new Date().toISOString()
    await saveTaskBountiesDb(tasks)
    return NextResponse.json({ success: true, status: task.status })
  }

  if (action === 'approve_and_pay') {
    const payout = await tryAutoPayout(task, {
      mergedOverride: undefined,
      riskPassed: true,
      source: 'lark_callback',
      idempotencyKey: `payout:lark:${task.id}:${hashWorkflowPayload([action, taskId, JSON.stringify(body)])}`
    })
    if (!payout.success) {
      const failure = classifyPaymentFailure({ error: payout.error, checks: payout.checks })
      await enqueueAutoRetryForTask({
        task,
        classification: failure,
        source: 'lark_callback',
        error: payout.error,
        metadata: {
          checks: payout.checks
        }
      })
      await saveTaskBountiesDb(tasks)
      return NextResponse.json({ success: false, error: payout.error, checks: payout.checks }, { status: 400 })
    }
    await saveTaskBountiesDb(tasks)

    if (payout.shouldRecordLedger) {
      await appendPaymentDb({
        id: uuidv4(),
        projectId: 'task-bounty',
        projectName: 'Requirement Bounty',
        companyId: task.companyId,
        companyName: task.companyName,
        reportId: task.id,
        reportTitle: task.title,
        moduleType: 'bounty_task',
        amount: task.rewardAmount,
        rewardToken: task.rewardToken,
        toAddress: task.developerWallet,
        toName: task.developerName,
        fromAddress: task.payerWalletAddress,
        fromName: task.payerCompanyName,
        txHash: payout.txHash!,
        memo: `[TaskBounty][Lark] ${task.title} auto bounty payout`,
        timestamp: new Date().toISOString()
      })
    }
    task.nextAutoRetryAt = undefined
    task.autoRetryJobId = undefined
    await saveTaskBountiesDb(tasks)
    return NextResponse.json({ success: true, txHash: payout.txHash, status: task.status })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
