import { TaskBounty } from '@/lib/types'

export type WorkflowHandoffOwner =
  | 'external_contributor'
  | 'reviewer'
  | 'finance'
  | 'platform_ops'
  | 'company_ops'
  | 'system'

export interface WorkflowHandoff {
  owner: WorkflowHandoffOwner
  ownerLabel: string
  queue: 'delivery' | 'review' | 'finance' | 'payout' | 'ops' | 'done'
  slaLabel: string
  narrative: string
  nextAction: string
  blockerSummary: string
}

function payoutBlocker(task: TaskBounty) {
  if (task.lastAutoPayoutError?.includes('Missing bounty:$xx label') && task.rewardAmount) {
    return `Waiting to retry payout with confirmed amount ${task.rewardAmount} ${task.rewardToken || 'USD1'}`
  }
  return task.lastAutoPayoutError || task.manualReviewReason || 'Waiting for payout conditions to be fulfilled'
}

export function resolveTaskHandoff(task: TaskBounty): WorkflowHandoff {
  if (task.status === 'payment_failed') {
    return {
      owner: 'finance',
      ownerLabel: 'Finance',
      queue: 'finance',
      slaLabel: 'Re-clearance decision required within 2 hours',
      narrative: 'The task has passed preliminary review but payment execution failed. Finance must re-confirm whether to proceed with clearance.',
      nextAction: 'Check failure code, retry strategy, wallet and escrow lock status. Confirm whether to re-approve to payout stage.',
      blockerSummary: payoutBlocker(task)
    }
  }

  if (task.status === 'awaiting_finance_review') {
    return {
      owner: 'finance',
      ownerLabel: 'Finance',
      queue: 'finance',
      slaLabel: 'Clearance decision required today',
      narrative: 'Delivery evidence is largely in place. The task is currently blocked at the finance clearance step and cannot proceed to payment yet.',
      nextAction: 'Verify escrow lock status, review decision and payout conditions. Advance the task to accepted once confirmed.',
      blockerSummary: task.manualReviewReason || 'Waiting for finance to confirm pre-payment conditions'
    }
  }

  if (task.status === 'accepted') {
    return {
      owner: 'platform_ops',
      ownerLabel: 'Payout',
      queue: 'payout',
      slaLabel: 'Execute as soon as possible after clearance',
      narrative: 'Finance has approved clearance. The payout execution layer should initiate payment and record the receipt.',
      nextAction: 'Execute payment, record tx hash, and roll back to finance for re-confirmation on failure.',
      blockerSummary: task.lastAutoPayoutError || 'Waiting to execute payment'
    }
  }

  if (task.status === 'awaiting_manual_review') {
    return {
      owner: 'reviewer',
      ownerLabel: 'Reviewer',
      queue: 'review',
      slaLabel: 'Review must be completed within 4 hours',
      narrative: 'Automated assessment cannot directly approve. Waiting for reviewer to provide a definitive decision.',
      nextAction: 'Provide an approve or reject decision based on AI findings, CI results, and PR evidence.',
      blockerSummary: task.manualReviewReason || task.githubCheckSummary || 'Waiting for manual review decision'
    }
  }

  if (task.status === 'awaiting_acceptance') {
    return {
      owner: 'reviewer',
      ownerLabel: 'Reviewer',
      queue: 'review',
      slaLabel: 'Acceptance decision required today',
      narrative: 'Code or deliverables have been submitted and are awaiting final acceptance.',
      nextAction: 'Confirm PR meets acceptance criteria before deciding whether to proceed to finance or auto-payout.',
      blockerSummary: task.githubCheckSummary || 'Waiting for reviewer to complete final acceptance'
    }
  }

  if (task.status === 'submitted' || task.status === 'ai_reviewing') {
    return {
      owner: 'system',
      ownerLabel: 'System',
      queue: 'delivery',
      slaLabel: 'Auto-verification in progress',
      narrative: 'The task has entered the verification pipeline. The system is aggregating PR, CI, and AI gate results.',
      nextAction: 'Wait for system to aggregate results. If timed out, platform ops should check GitHub and AI integrations.',
      blockerSummary: task.githubCheckSummary || 'Waiting for PR, CI, and AI verification results'
    }
  }

  if (task.status === 'open') {
    return {
      owner: 'external_contributor',
      ownerLabel: 'External Contributor',
      queue: 'delivery',
      slaLabel: 'Waiting to be claimed',
      narrative: 'The task is still actionable. The next step is to claim it, lock the budget, or complete delivery materials.',
      nextAction: 'Complete the claim first, or have the company finalize the escrow lock and payer identity to avoid the task stalling in open state.',
      blockerSummary: task.claimedByGithubLogin ? 'Waiting for developer to begin delivery' : 'Waiting for claimer and recipient identity to be confirmed'
    }
  }

  if (task.status === 'in_progress') {
    return {
      owner: 'external_contributor',
      ownerLabel: 'External Contributor',
      queue: 'delivery',
      slaLabel: 'Waiting for delivery submission',
      narrative: 'The task has been claimed. The developer needs to submit a verifiable PR or commit as evidence.',
      nextAction: 'Submit PR / commit / patch to enter the automated verification pipeline.',
      blockerSummary: task.prUrl || task.commitSha ? 'Delivery evidence exists, waiting for system processing' : 'No verifiable delivery submitted yet'
    }
  }

  if (task.status === 'paid') {
    return {
      owner: 'system',
      ownerLabel: 'Closed',
      queue: 'done',
      slaLabel: 'Completed',
      narrative: 'The task has been accepted and settled successfully. Details are retained for audit and retrospective purposes.',
      nextAction: 'No further action needed. Retained for audit, client reporting, and retrospectives.',
      blockerSummary: task.txHash || task.rewardReleaseTxHash || 'Settlement completed'
    }
  }

  if (task.status === 'cancelled' || task.status === 'disputed') {
    return {
      owner: 'platform_ops',
      ownerLabel: 'Platform Ops',
      queue: 'ops',
      slaLabel: 'Handle as needed',
      narrative: 'The task has exited the main flow. Operations should retain context and decide whether to reopen or archive.',
      nextAction: 'Preserve audit information. Reopen or take manual ownership if necessary.',
      blockerSummary: task.manualReviewReason || 'Task has exited the main flow'
    }
  }

  return {
    owner: 'company_ops',
    ownerLabel: 'Company Ops',
    queue: 'ops',
    slaLabel: 'Pending confirmation',
    narrative: 'The task is currently in transit. Progress can continue around delivery evidence, review decisions, and settlement proof.',
    nextAction: 'Confirm whether current evidence is complete and drive the task to the next stage.',
    blockerSummary: 'Waiting for further confirmation'
  }
}
