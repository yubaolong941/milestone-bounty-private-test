'use client'

import { useEffect, useRef, useState } from 'react'
import { CompanyRole, TaskBounty } from '@/lib/types'
import type { UserRole } from '@/lib/auth'
import { hasCompanyCapability } from '@/lib/permissions'
import { resolveTaskHandoff } from '@/lib/workflow/handoff'
import { humanizeStatus } from '@/lib/format'

interface TaskDetailDrawerProps {
  task: TaskBounty | null
  role?: UserRole
  companyRole?: CompanyRole
  onClose: () => void
}

function canOperateLocks(role?: UserRole, companyRole?: CompanyRole) {
  return role === 'admin' || hasCompanyCapability(companyRole, 'payment.approve')
}

function canOperateDelivery(role?: UserRole, companyRole?: CompanyRole) {
  return role === 'admin' || hasCompanyCapability(companyRole, 'task.review') || hasCompanyCapability(companyRole, 'task.create')
}

function formatTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-US', { hour12: false })
}

function renderMaybeLink(value?: string) {
  if (!value) return '-'
  if (/^https?:\/\//i.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer" className="break-all text-apple-blue underline">{value}</a>
  }
  return <span className="break-all">{value}</span>
}

function claimabilityLabel(task: TaskBounty) {
  if (task.source !== 'external') return null
  if (!task.claimedByGithubLogin) return 'Claimable'
  if (task.status === 'paid') return 'Paid'
  if (['awaiting_acceptance', 'submitted', 'accepted'].includes(task.status)) return 'Pending acceptance / payout'
  return `In progress · @${task.claimedByGithubLogin}`
}

export default function TaskDetailDrawer({ task, role, companyRole, onClose }: TaskDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    requirement: false,
    ownership: false,
    evidence: false,
    aiRisk: false,
    settlement: false
  })

  useEffect(() => {
    if (task && drawerRef.current) {
      drawerRef.current.focus()
    }
  }, [task])

  if (!task) return null
  const claimability = claimabilityLabel(task)
  const handoff = resolveTaskHandoff(task)

  const timeline = [
    {
      label: 'Task published',
      done: true,
      detail: task.requirementId || task.createdAt ? `Requirement ${task.requirementId || 'generated'} · ${formatTime(task.createdAt)}` : 'Task entered system'
    },
    {
      label: 'Claim and identity binding',
      done: Boolean(task.claimedByGithubLogin || task.developerWallet),
      detail: task.claimedByGithubLogin
        ? `Claimer @${task.claimedByGithubLogin}${task.developerWallet ? ` · wallet ${task.developerWallet}` : ''}`
        : 'Currently claimable. Waiting for owner and payout identity.'
    },
    {
      label: 'Delivery evidence',
      done: Boolean(task.prUrl || task.commitSha),
      detail: task.prUrl || task.commitSha || 'Waiting for PR, commit, or additional delivery evidence'
    },
    {
      label: 'Review decision',
      done: ['accepted', 'paid'].includes(task.status),
      detail: task.githubReviewDecision || task.manualReviewDecision || task.aiGateDecision || 'Waiting for reviewer / AI gate decision'
    },
    {
      label: 'Settlement completed',
      done: task.status === 'paid',
      detail: task.txHash || task.rewardReleaseTxHash || 'Waiting for payout or on-chain receipt'
    }
  ]

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/60 backdrop-blur-sm overlay-enter"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-task-title"
        tabIndex={-1}
        className="flex h-full w-full max-w-3xl flex-col border-l border-white/[0.08] bg-[rgba(10,18,30,0.98)] shadow-2xl slide-in-right outline-none"
      >
        <div className="topbar flex items-center justify-between px-6 py-4">
          <div>
            <p className="section-title">Task Detail</p>
            <h2 id="drawer-task-title" className="mt-2 text-2xl font-semibold text-white">{task.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 subtle">{handoff.narrative}</p>
          </div>
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <section className="hero-card rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`status-pill status-${task.status}`}>{humanizeStatus(task.status)}</span>
              {claimability && <span className="chip">{claimability}</span>}
              <span className="chip">{task.source}</span>
              <span className="chip">{task.rewardAmount} {task.rewardToken}</span>
              {task.rewardLockStatus && <span className="chip">lock {task.rewardLockStatus}</span>}
              <span className="chip">owner {handoff.ownerLabel}</span>
              <span className="chip">{handoff.slaLabel}</span>
              <span className="chip">updated {formatTime(task.updatedAt)}</span>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div>
                <p className="section-title">Current State</p>
                <p className="mt-3 text-sm leading-7 subtle">{handoff.narrative}</p>
                <p className="mt-3 text-sm leading-7 subtle">{task.description || 'No description'}</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <p className="section-title">Next Best Action</p>
                <p className="mt-3 text-sm leading-6 subtle">{handoff.nextAction}</p>
                <div className="mt-4 rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Current Owner</p>
                  <p className="mt-2 text-sm text-white">{handoff.ownerLabel}</p>
                  <p className="mt-2 text-sm leading-6 subtle">{handoff.blockerSummary}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {canOperateLocks(role, companyRole) && <span className="chip">Can lock/release payout</span>}
                  {canOperateDelivery(role, companyRole) && <span className="chip">Can validate delivery</span>}
                  {!canOperateLocks(role, companyRole) && !canOperateDelivery(role, companyRole) && <span className="chip">Read-only audit view</span>}
                </div>
              </div>
            </div>
          </section>

          <section className="panel rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-title">Flow Timeline</p>
                <p className="mt-2 text-xl font-semibold text-white">Evidence chain from task to payout</p>
              </div>
              <span className="chip">{timeline.filter((item) => item.done).length}/{timeline.length} completed</span>
            </div>
            <div className="mt-5 space-y-3">
              {timeline.map((item, index) => (
                <div key={item.label} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${item.done ? 'bg-white text-slate-950' : 'bg-white/10 text-white'}`}>
                        {index + 1}
                      </div>
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                    </div>
                    <span className="chip">{item.done ? 'Done' : 'Pending'}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 subtle">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">Requirement Context</p>
                <button className="btn-ghost" onClick={() => toggleSection('requirement')}>
                  {expandedSections.requirement ? 'Hide' : 'Show'}
                </button>
              </div>
              {expandedSections.requirement && <div className="mt-4 info-list">
                <div className="info-row"><span className="info-key">Requirement ID</span><span>{task.requirementId || '-'}</span></div>
                <div className="info-row"><span className="info-key">Reference Doc</span><span>{renderMaybeLink(task.requirementDocUrl)}</span></div>
                <div className="info-row"><span className="info-key">Doc Title</span><span>{task.requirementDocTitle || '-'}</span></div>
                <div className="info-row"><span className="info-key">Meegle</span><span>{renderMaybeLink(task.meegleUrl || task.meegleIssueId)}</span></div>
                <div className="info-row"><span className="info-key">Clarity</span><span>{task.requirementClarityStatus || '-'} {task.requirementClarityScore !== undefined ? `(${task.requirementClarityScore})` : ''}</span></div>
              </div>}
              {expandedSections.requirement && task.acceptanceCriteriaSnapshot && task.acceptanceCriteriaSnapshot.length > 0 && (
                <div className="mt-4 space-y-2">
                  {task.acceptanceCriteriaSnapshot.map((item) => (
                    <div key={item} className="rounded-xl border border-white/[0.08] bg-white/5 px-3 py-2 text-sm text-white/90">
                      {item}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">Ownership & Funding</p>
                <button className="btn-ghost" onClick={() => toggleSection('ownership')}>
                  {expandedSections.ownership ? 'Hide' : 'Show'}
                </button>
              </div>
              {expandedSections.ownership && <div className="mt-4 info-list">
                <div className="info-row"><span className="info-key">Claim</span><span>{task.claimedByGithubLogin ? `@${task.claimedByGithubLogin}` : 'Claimable'}</span></div>
                <div className="info-row"><span className="info-key">PR Author</span><span>{task.prAuthorGithubLogin ? `@${task.prAuthorGithubLogin}` : '-'}</span></div>
                <div className="info-row"><span className="info-key">Wallet</span><span className="break-all">{task.developerWallet || '-'}</span></div>
                <div className="info-row"><span className="info-key">Payout Account</span><span>{task.payerCompanyName || 'Platform Treasury'} {task.payerWalletAddress ? `(${task.payerWalletAddress})` : ''}</span></div>
                <div className="info-row"><span className="info-key">Lock Id</span><span className="break-all">{task.rewardLockId || '-'}</span></div>
                <div className="info-row"><span className="info-key">Locked Amount</span><span>{task.rewardLockedAmount ? `${task.rewardLockedAmount} ${task.rewardLockedToken || task.rewardToken}` : '-'}</span></div>
              </div>}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">Delivery Evidence</p>
                <button className="btn-ghost" onClick={() => toggleSection('evidence')}>
                  {expandedSections.evidence ? 'Hide' : 'Show'}
                </button>
              </div>
              {expandedSections.evidence && <div className="mt-4 info-list">
                <div className="info-row"><span className="info-key">Repo</span><span>{task.repo || '-'}</span></div>
                <div className="info-row"><span className="info-key">Delivery Mode</span><span>{task.deliveryMode || '-'}</span></div>
                <div className="info-row"><span className="info-key">PR</span><span>{renderMaybeLink(task.prUrl)}</span></div>
                <div className="info-row"><span className="info-key">Commit</span><span className="break-all">{task.commitSha || '-'}</span></div>
                <div className="info-row"><span className="info-key">CI</span><span>{String(task.ciPassed ?? false)}</span></div>
                <div className="info-row"><span className="info-key">GitHub Review</span><span>{task.githubReviewDecision || '-'}</span></div>
              </div>}
            </div>

            <div className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">AI Review & Risk</p>
                <button className="btn-ghost" onClick={() => toggleSection('aiRisk')}>
                  {expandedSections.aiRisk ? 'Hide' : 'Show'}
                </button>
              </div>
              {expandedSections.aiRisk && <div className="mt-4 info-list">
                <div className="info-row"><span className="info-key">Score</span><span>{task.aiScore ?? '-'}</span></div>
                <div className="info-row"><span className="info-key">Completion</span><span>{task.aiCompletionScore ?? '-'}</span></div>
                <div className="info-row"><span className="info-key">Gate</span><span>{task.aiGateDecision || '-'}</span></div>
                <div className="info-row"><span className="info-key">Model</span><span>{task.aiModelUsed || '-'}</span></div>
                <div className="info-row"><span className="info-key">Failure Code</span><span>{task.lastAutoPayoutFailureCode || '-'}</span></div>
                <div className="info-row"><span className="info-key">Retry Strategy</span><span>{task.lastAutoPayoutRetryStrategy || '-'}</span></div>
              </div>}
              {expandedSections.aiRisk && task.aiReviewSummary && <p className="mt-4 text-sm subtle">{task.aiReviewSummary}</p>}
              {expandedSections.aiRisk && task.aiCriticFindings && task.aiCriticFindings.length > 0 && (
                <div className="mt-4 space-y-2">
                  {task.aiCriticFindings.map((finding) => (
                    <div key={finding} className="rounded-xl border border-apple-orange/25 bg-apple-orange/8 px-3 py-2 text-sm text-apple-orange">
                      {finding}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="section-title">Settlement Controls</p>
              <button className="btn-ghost" onClick={() => toggleSection('settlement')}>
                {expandedSections.settlement ? 'Hide' : 'Show'}
              </button>
            </div>
            {expandedSections.settlement && <div className="mt-4 info-list">
              <div className="info-row"><span className="info-key">Payout Provider</span><span>{task.payoutProvider || '-'}</span></div>
              <div className="info-row"><span className="info-key">Funding Tx</span><span className="break-all">{task.rewardLockTxHash || '-'}</span></div>
              <div className="info-row"><span className="info-key">Release Tx</span><span className="break-all">{task.rewardReleaseTxHash || task.txHash || '-'}</span></div>
              <div className="info-row"><span className="info-key">Manual Review</span><span>{task.manualReviewDecision || '-'}</span></div>
              <div className="info-row"><span className="info-key">Reviewed At</span><span>{formatTime(task.manualReviewedAt)}</span></div>
              <div className="info-row"><span className="info-key">Paid At</span><span>{formatTime(task.paidAt)}</span></div>
            </div>}
            {expandedSections.settlement && (task.lastAutoPayoutError || task.manualReviewReason) && (
              <div className="mt-4 rounded-[10px] border border-apple-orange/20 bg-apple-orange/8 p-4">
                <p className="text-sm font-semibold text-white">Exception explanation</p>
                <p className="mt-2 text-sm leading-6 subtle">{task.lastAutoPayoutError || task.manualReviewReason}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
