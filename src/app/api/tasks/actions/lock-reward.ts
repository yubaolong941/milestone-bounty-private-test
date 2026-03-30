import { NextResponse } from 'next/server'
import { SessionUser } from '@/lib/auth'
import { TaskBounty } from '@/lib/types'
import {
  extractRewardFromLabels,
  extractRewardTokenFromLabels,
  upsertLabel
} from '@/lib/claims'
import { lockTaskRewardWithEscrow } from '@/lib/bounty-payout'
import {
  markSettlementFundingReserved,
  markSettlementFundingLocked
} from '@/lib/repositories/settlement-case-repository'
import { saveTaskBountiesDb } from '@/lib/runtime-data-db'
import {
  CompanyContext,
  ensureTaskCapability,
  resolveCompanyPayout
} from '../helpers'

export async function handleLockReward(
  body: Record<string, unknown>,
  session: SessionUser,
  _companyContext: CompanyContext,
  task: TaskBounty,
  tasks: TaskBounty[]
): Promise<NextResponse> {
  const permission = await ensureTaskCapability(session, task, 'payment.approve')
  if (!permission.ok) {
    return permission.response
  }
  const companyWallet = await resolveCompanyPayout(body, task.companyId || session.activeCompanyId)
  if (!companyWallet) {
    return NextResponse.json({ error: 'No available platform escrow account found. Please ensure platform funding is linked to the task.' }, { status: 400 })
  }

  const rewardAmount = Number(body.rewardAmount || extractRewardFromLabels(task.labels || []) || task.rewardAmount || 0)
  const rewardToken = String(body.rewardToken || extractRewardTokenFromLabels(task.labels || []) || task.rewardToken || 'USD1').trim().toUpperCase()
  if (!rewardAmount) return NextResponse.json({ error: 'Missing lock amount' }, { status: 400 })

  task.labels = upsertLabel(task.labels || [], `bounty:$${rewardAmount}`, /^bounty:/i)
  task.labels = upsertLabel(task.labels || [], `rewardToken:${rewardToken}`, /^rewardToken:/i)
  task.rewardAmount = rewardAmount
  task.rewardToken = rewardToken

  const lockResult = await lockTaskRewardWithEscrow({
    task,
    rewardAmount,
    rewardToken,
    companyWalletId: companyWallet.id,
    payerCompanyName: companyWallet.companyName,
    payerWalletAddress: companyWallet.walletAddress,
    fundingTxHash: body.fundingTxHash ? String(body.fundingTxHash).trim() : undefined,
    lockContractAddress: body.lockContractAddress ? String(body.lockContractAddress).trim() : undefined,
    actorUserId: session.userId
  })
  if (!lockResult.success) {
    return NextResponse.json({ error: lockResult.error || 'Escrow lock failed', lock: lockResult.lock }, { status: 400 })
  }
  await saveTaskBountiesDb(tasks)
  await markSettlementFundingReserved(task, {
    treasuryFundingTxHash: task.treasuryFundingTxHash,
    allocatedAmount: rewardAmount,
    fundingReservedAt: task.treasuryFundingVerifiedAt ?? task.updatedAt
  })
  await markSettlementFundingLocked(task)
  return NextResponse.json({ success: true, task, lock: lockResult.lock, onchain: lockResult.onchain })
}
