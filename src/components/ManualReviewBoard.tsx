'use client'

import { useEffect, useMemo, useState } from 'react'
import { TaskBounty } from '@/lib/types'
import PayoutExecutionOverlay from '@/components/PayoutExecutionOverlay'
import { resolveTaskHandoff } from '@/lib/workflow/handoff'
import { humanizeStatus } from '@/lib/format'

interface Props {
  tasks: TaskBounty[]
  onRefresh: () => void
  initialFilter?: 'all' | 'critical' | 'finance' | 'review'
}

function normalizePaymentMessage(message?: string) {
  if (!message) return 'Awaiting manual action'
  return message
}

export default function ManualReviewBoard({ tasks, onRefresh, initialFilter = 'all' }: Props) {
  const [reason, setReason] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'all' | 'critical' | 'finance' | 'review'>(initialFilter)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [payoutOverlayVisible, setPayoutOverlayVisible] = useState(false)

  useEffect(() => {
    setFilter(initialFilter)
  }, [initialFilter])
  const reviewQueue = useMemo(
    () => tasks.filter((task) =>
      task.manualReviewRequired
      || task.status === 'awaiting_manual_review'
      || task.status === 'awaiting_finance_review'
      || task.status === 'accepted'
      || task.status === 'payment_failed'
    ),
    [tasks]
  )

  const queueWithMeta = useMemo(
    () =>
      reviewQueue
        .map((task) => {
          const handoff = resolveTaskHandoff(task)
          const priority = task.status === 'payment_failed'
            ? 'critical'
            : task.status === 'awaiting_finance_review' || task.status === 'accepted'
              ? 'finance'
              : 'review'
          const headline = normalizePaymentMessage(task.manualReviewReason || task.lastAutoPayoutError)
          const score = task.status === 'payment_failed' ? 30 : task.status === 'accepted' ? 25 : task.status === 'awaiting_finance_review' ? 20 : 10
          return { task, priority, handoff, headline, score }
        })
        .filter((item) => filter === 'all' || item.priority === filter)
        .sort((a, b) => b.score - a.score || new Date(a.task.updatedAt).getTime() - new Date(b.task.updatedAt).getTime()),
    [filter, reviewQueue]
  )

  const act = async (taskId: string, action: 'manualReviewApprove' | 'manualReviewReject' | 'financeApprove' | 'executePayout') => {
    setBusyTaskId(taskId)
    if (action === 'manualReviewApprove' || action === 'financeApprove' || action === 'executePayout') {
      setPayoutOverlayVisible(true)
    }
    const shouldForceManualRelease = action === 'executePayout'
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, taskId, reason: reason[taskId] || '', forceManualRelease: shouldForceManualRelease })
      })
      await res.json().catch(() => ({}))
      setFeedback(
        action === 'manualReviewApprove'
          ? 'Manual review approved'
          : action === 'manualReviewReject'
            ? 'Rejected'
            : action === 'financeApprove'
              ? 'Finance approved'
              : 'Payout execution initiated'
      )
      onRefresh()
    } finally {
      setBusyTaskId(null)
      setPayoutOverlayVisible(false)
    }
  }

  if (reviewQueue.length === 0) {
    return (
      <div className="panel rounded-[20px] p-10 text-center">
        <p className="text-lg font-semibold text-white">No pending tasks</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PayoutExecutionOverlay visible={payoutOverlayVisible} />
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Critical', String(reviewQueue.filter((task) => task.status === 'payment_failed').length)],
          ['Finance', String(reviewQueue.filter((task) => task.status === 'awaiting_finance_review' || task.status === 'accepted').length)],
          ['Review', String(reviewQueue.filter((task) => task.status === 'awaiting_manual_review').length)],
          ['Total', String(reviewQueue.length)]
        ].map(([label, value]) => (
          <div key={label} className="panel rounded-2xl p-5">
            <p className="section-title">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ['all', 'All'],
          ['critical', 'Payout failure'],
          ['finance', 'Finance / payment'],
          ['review', 'Manual review']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key as 'all' | 'critical' | 'finance' | 'review')}
            className={`filter-chip ${filter === key ? 'filter-chip-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <div aria-live="polite" role="status" className="feedback-banner feedback-success">
          <div>
            <p className="text-sm font-semibold text-white">Action recorded</p>
            <p className="mt-1 text-sm subtle">{feedback}</p>
          </div>
          <button onClick={() => setFeedback(null)} className="btn-ghost px-4 py-2 text-xs">Dismiss</button>
        </div>
      )}

      {queueWithMeta.map(({ task, priority, handoff, headline }) => (
        <div key={task.id} className="panel rounded-[20px] p-5">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`status-pill status-${task.status}`}>{humanizeStatus(task.status)}</span>
                <span className="chip">{task.rewardAmount} {task.rewardToken}</span>
                <span className="chip">priority {priority}</span>
                <span className="chip">{handoff.ownerLabel}</span>
                <span className="chip">{handoff.slaLabel}</span>
                {task.paymentFailureCount ? <span className="chip">failures {task.paymentFailureCount}</span> : null}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{task.title}</h3>
              <p className="mt-2 text-sm subtle">{headline}</p>
              <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <p className="section-title">Next Action</p>
                <p className="mt-2 text-sm subtle">{handoff.nextAction}</p>
                <p className="mt-2 text-sm subtle">{handoff.blockerSummary}</p>
              </div>
              {task.lastAutoPayoutFailureCode && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="chip">code {task.lastAutoPayoutFailureCode}</span>
                  <span className="chip">retry {task.lastAutoPayoutRetryStrategy || '-'}</span>
                </div>
              )}
              {task.lastAutoPayoutChecks && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {'merged' in task.lastAutoPayoutChecks && <span className="chip">merge {String(task.lastAutoPayoutChecks.merged)}</span>}
                  {'ciPassed' in task.lastAutoPayoutChecks && <span className="chip">CI {String(task.lastAutoPayoutChecks.ciPassed)}</span>}
                  {'reviewApproved' in task.lastAutoPayoutChecks && <span className="chip">review {String(task.lastAutoPayoutChecks.reviewApproved)}</span>}
                  {'lockChecked' in task.lastAutoPayoutChecks && <span className="chip">lock {String(task.lastAutoPayoutChecks.lockChecked)}</span>}
                  {'nextAction' in task.lastAutoPayoutChecks && <span className="chip">next {String(task.lastAutoPayoutChecks.nextAction)}</span>}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <label htmlFor={`field-case-notes-${task.id}`} className="section-title">Case Notes</label>
                <textarea
                  id={`field-case-notes-${task.id}`}
                  className="textarea mt-3"
                  rows={4}
                  value={reason[task.id] || ''}
                  onChange={(e) => setReason((prev) => ({ ...prev, [task.id]: e.target.value }))}
                  placeholder="Notes"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                {(task.status === 'awaiting_manual_review' || task.status === 'awaiting_acceptance') && (
                  <button
                    onClick={() => act(task.id, 'manualReviewApprove')}
                    className="btn-secondary"
                    disabled={busyTaskId === task.id}
                  >
                    {busyTaskId === task.id ? 'Processing...' : 'Approve review'}
                  </button>
                )}
                {(task.status === 'awaiting_manual_review' || task.status === 'awaiting_acceptance') && (
                  <button
                    onClick={() => act(task.id, 'manualReviewReject')}
                    className="btn-ghost"
                    disabled={busyTaskId === task.id}
                  >
                    Reject task
                  </button>
                )}
                {(task.status === 'awaiting_finance_review' || task.status === 'payment_failed') && (
                  <button
                    onClick={() => act(task.id, 'financeApprove')}
                    className="btn-primary"
                    disabled={busyTaskId === task.id}
                  >
                    Finance approve
                  </button>
                )}
                {task.status === 'accepted' && (
                  <button
                    onClick={() => act(task.id, 'executePayout')}
                    className="btn-primary"
                    disabled={busyTaskId === task.id}
                  >
                    Execute payout
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {queueWithMeta.length === 0 && (
        <div className="panel rounded-2xl p-8 text-center subtle">
          No tasks
        </div>
      )}
    </div>
  )
}
