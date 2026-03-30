'use client'

import { useEffect, useMemo, useState } from 'react'
import { connectBrowserWallet, signWalletMessage } from '@/lib/browser-wallet'
import { TaskBounty } from '@/lib/types'
import { humanizeStatus } from '@/lib/format'
import { useFeedback } from '@/lib/use-feedback'
import { SkeletonCard } from '@/components/SkeletonLoader'

function claimStatusMeta(task: TaskBounty, sessionGithub?: string) {
  if (task.status === 'paid') {
    return { label: 'Paid', className: 'bg-apple-green/10 text-apple-green border border-apple-green/25' }
  }
  if (!task.claimedByGithubLogin) {
    return { label: 'Claimable', className: 'bg-white/[0.06] text-white/90 border border-white/[0.10]' }
  }
  if (['awaiting_acceptance', 'submitted', 'accepted'].includes(task.status)) {
    return { label: 'Pending acceptance / payout', className: 'bg-apple-orange/10 text-apple-orange border border-apple-orange/25' }
  }
  if (task.claimedByGithubLogin === sessionGithub) {
    return { label: 'In progress (mine)', className: 'bg-apple-blue/10 text-apple-blue border border-apple-blue/25' }
  }
  return { label: `In progress \u00b7 @${task.claimedByGithubLogin}`, className: 'bg-white/[0.06] text-white/50 border border-white/[0.08]' }
}

function formatTimeLabel(value?: string) {
  if (!value) return 'Updated recently'
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'Time pending sync'
  const diffHours = Math.max(0, Math.round((Date.now() - timestamp) / (1000 * 60 * 60)))
  if (diffHours < 1) return 'Updated within 1 hour'
  if (diffHours < 24) return `Updated ${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  return `Updated ${diffDays}d ago`
}

function formatExactTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { hour12: false })
}

function getExplorerTxUrl(task: TaskBounty) {
  const txHash = task.rewardReleaseTxHash || task.txHash
  if (!txHash) return undefined
  const network = (task.treasuryFundingNetwork || '').toLowerCase()
  if (network === 'bsc') return `https://bscscan.com/tx/${txHash}`
  return undefined
}

function portalNextStep(task: TaskBounty, isMine: boolean, isCodeMode: boolean, hasWallet: boolean) {
  if (isCodeMode && !hasWallet) return 'Bind your wallet first to enable submission and payout closure.'
  if (!task.claimedByGithubLogin) return isCodeMode ? 'Claim this task first to lock delivery and payout ownership.' : 'Review requirements and submit security evidence.'
  if (task.claimedByGithubLogin !== undefined && !isMine) return 'This task already has an owner. Switch to another claimable task.'
  if (task.status === 'open' || task.status === 'in_progress') {
    return isCodeMode ? 'Complete development and submit a PR to trigger review and acceptance.' : 'Prepare vulnerability summary, repro steps, and impact scope before submission.'
  }
  if (task.status === 'submitted') return 'Waiting for PR, CI, and acceptance checks. Keep supplementary evidence traceable.'
  if (task.status === 'awaiting_acceptance' || task.status === 'accepted') return 'Task is in payout stage. Watch review decisions and payout notifications.'
  if (task.status === 'paid') return 'Payout is completed. Save transaction proof and continue with new tasks.'
  return 'Follow current status. Platform will provide next-step prompts at key checkpoints.'
}

export default function ExternalPortal() {
  const [tasks, setTasks] = useState<TaskBounty[]>([])
  const [session, setSession] = useState<{ externalAuthType?: string; githubLogin?: string; walletAddress?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unclaimed' | 'mine' | 'pending_payout'>('all')
  const { feedback, setFeedback, dismiss } = useFeedback<{ tone: 'success' | 'warning' | 'danger'; title: string; detail: string }>()
  const [activeSubmitTaskId, setActiveSubmitTaskId] = useState<string | null>(null)
  const [submitForm, setSubmitForm] = useState({ prUrl: '', commitSha: '' })
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [bindingWallet, setBindingWallet] = useState(false)
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({})

  const fetchTasks = async () => {
    try {
      const [taskRes, meRes] = await Promise.all([
        fetch('/api/tasks?view=claimable_external'),
        fetch('/api/auth/me').catch(() => null)
      ])

      const taskData = await taskRes.json().catch(() => null)
      const me = meRes ? await meRes.json().catch(() => null) : null

      if (!taskRes.ok) {
        throw new Error((taskData as { error?: string } | null)?.error || 'Failed to load task list')
      }

      setTasks(Array.isArray(taskData) ? taskData : [])
      setSession(me?.session || null)
    } catch (error) {
      setTasks([])
      setSession(null)
      setFeedback({
        tone: 'danger',
        title: 'External portal failed to load',
        detail: error instanceof Error ? error.message : 'Tasks or session data failed to load. Please refresh and retry.'
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  const externalTasks = tasks.filter((x) => x.source === 'external')
  const codeTasks = externalTasks.filter((x) => x.prUrl || x.repo)
  const securityTasks = externalTasks.filter((x) => !x.prUrl && !x.repo)
  const isCodeMode = session?.externalAuthType === 'github_code_bounty'
  const baseTasks = isCodeMode ? codeTasks : securityTasks
  const sessionGithub = session?.githubLogin?.toLowerCase()
  const hasWallet = Boolean(session?.walletAddress)

  const filterCounts = {
    all: baseTasks.length,
    unclaimed: baseTasks.filter((task) => !task.claimedByGithubLogin).length,
    mine: baseTasks.filter((task) => task.claimedByGithubLogin === sessionGithub).length,
    pending_payout: baseTasks.filter((task) =>
      task.claimedByGithubLogin === sessionGithub
      && task.status !== 'paid'
      && ['awaiting_acceptance', 'submitted', 'accepted'].includes(task.status)
    ).length
  }

  const displayTasks = baseTasks.filter((task) => {
    if (filter === 'all') return true
    if (filter === 'unclaimed') return !task.claimedByGithubLogin
    if (filter === 'mine') return task.claimedByGithubLogin === sessionGithub
    if (filter === 'pending_payout') {
      return task.claimedByGithubLogin === sessionGithub
        && task.status !== 'paid'
        && ['awaiting_acceptance', 'submitted', 'accepted'].includes(task.status)
    }
    return true
  })

  const highlightTask = useMemo(
    () => displayTasks.find((task) => task.claimedByGithubLogin === sessionGithub && task.status !== 'paid')
      || displayTasks.find((task) => !task.claimedByGithubLogin)
      || displayTasks[0]
      || null,
    [displayTasks, sessionGithub]
  )

  const submit = async (taskId: string) => {
    if (isCodeMode && !hasWallet) {
      setFeedback({
        tone: 'warning',
        title: 'Bind payout wallet first',
        detail: 'This account has no wallet binding yet. Bind first to enable code bounty submission and settlement.'
      })
      return
    }
    if (!submitForm.prUrl.trim()) {
      setFeedback({
        tone: 'warning',
        title: 'PR link is missing',
        detail: 'Please add a GitHub PR URL so reviewer, CI, and payout can follow one evidence chain.'
      })
      return
    }

    setBusyTaskId(taskId)
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit',
        taskId,
        prUrl: submitForm.prUrl.trim(),
        commitSha: submitForm.commitSha.trim()
      })
    })
    const data = await res.json().catch(() => ({}))
    setBusyTaskId(null)

    if (!res.ok) {
      setFeedback({
        tone: 'danger',
        title: 'Submission failed',
        detail: data?.inferPopup || data?.error || 'Platform could not accept this submission. Check PR URL and wallet binding, then retry.'
      })
      return
    }

    setFeedback({
      tone: 'success',
      title: 'Submission entered review pipeline',
      detail: data?.inferPopup || 'Your PR is recorded. Platform will continue with checks, acceptance, and payout validation.'
    })
    setActiveSubmitTaskId(null)
    setSubmitForm({ prUrl: '', commitSha: '' })
    fetchTasks()
  }

  const claim = async (taskId: string) => {
    setBusyTaskId(taskId)
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', taskId })
    })
    const data = await res.json().catch(() => ({}))
    setBusyTaskId(null)

    if (!res.ok) {
      setFeedback({
        tone: 'danger',
        title: 'Claim failed',
        detail: data?.error || 'This task may already be claimed. Refresh and pick another available task.'
      })
      return
    }

    setFeedback({
      tone: 'success',
      title: 'Task claimed',
      detail: 'You are now the owner. Next step is delivery and PR submission for automated acceptance.'
    })
    fetchTasks()
  }

  const bindWallet = async () => {
    try {
      setBindingWallet(true)
      const connection = await connectBrowserWallet('okx')
      const challengeRes = await fetch('/api/auth/wallet-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: connection.walletAddress, purpose: 'bind_wallet' })
      })
      const challengeData = await challengeRes.json().catch(() => ({}))
      if (!challengeRes.ok) {
        setBindingWallet(false)
        setFeedback({
          tone: 'danger',
          title: 'Binding preparation failed',
          detail: challengeData?.error || 'Platform could not generate signature challenge. Please retry.'
        })
        return
      }

      const signature = await signWalletMessage(connection.provider, connection.walletAddress, challengeData.message)
      const res = await fetch('/api/auth/bind-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: connection.walletAddress,
          message: challengeData.message,
          signature
        })
      })
      const data = await res.json().catch(() => ({}))
      setBindingWallet(false)
      if (!res.ok) {
        setFeedback({
          tone: 'danger',
          title: 'Wallet binding failed',
          detail: data?.error || 'Signature submitted but platform verification did not complete. Retry shortly.'
        })
        return
      }
      setFeedback({
        tone: 'success',
        title: 'Wallet bound',
        detail: `Payout address ${data.walletAddress} is now linked to this account. Future submissions flow to settlement automatically.`
      })
      fetchTasks()
    } catch (error) {
      setBindingWallet(false)
      setFeedback({
        tone: 'warning',
        title: 'Wallet binding not completed',
        detail: error instanceof Error ? error.message : 'Binding was not completed. Unlock wallet extension and retry signing.'
      })
    }
  }

  return (
    <div className="core-page">
      <header className="topbar px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-white">External Contributor Portal</h1>
            <p className="text-xs text-gray-500">
              {isCodeMode
                ? `Code bounty mode (GitHub: ${session?.githubLogin || '-'})`
                : `Security bounty mode (Wallet: ${session?.walletAddress || '-'})`}
            </p>
          </div>
          <a href="/staff" className="btn-ghost px-4 py-2 text-xs">Internal console</a>
        </div>
      </header>

      <main className="core-shell space-y-6 p-0">
        <section className="core-hero p-5 md:p-6">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <span className="chip">external workspace</span>
                <span className="chip">{isCodeMode ? 'github to payout' : 'report to payout'}</span>
                <span className="chip">{baseTasks.length} visible tasks</span>
              </div>
              <div>
                <p className="section-title">Contributor Journey</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ['Claimable', String(filterCounts.unclaimed), 'No owner yet, ready to start'],
                  ['Mine', String(filterCounts.mine), 'Claimed by you and still active'],
                  ['Pending payout', String(filterCounts.pending_payout), 'Already in review or settlement']
                ].map(([label, value, desc]) => (
                  <div key={label} className="command-card">
                    <p className="section-title">{label}</p>
                    <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
                    <p className="mt-2 text-sm subtle">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="panel rounded-2xl p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="section-title">Next Best Action</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {highlightTask ? highlightTask.title : 'Start with a claimable task'}
                    </p>
                  </div>
                  <span className="chip">{highlightTask ? formatTimeLabel(highlightTask.updatedAt) : 'Not started'}</span>
                </div>
                <p className="mt-4 text-sm leading-6 subtle">
                  {highlightTask
                    ? portalNextStep(
                      highlightTask,
                      highlightTask.claimedByGithubLogin === sessionGithub,
                      isCodeMode,
                      hasWallet
                    )
                    : 'No tasks match this filter. Switch to All or Unclaimed to begin.'}
                </p>
                {highlightTask && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {!highlightTask.claimedByGithubLogin && isCodeMode && (
                      <button
                        onClick={() => claim(highlightTask.id)}
                        className="btn-secondary"
                        disabled={busyTaskId === highlightTask.id}
                      >
                        {busyTaskId === highlightTask.id ? 'Claiming...' : 'Claim now'}
                      </button>
                    )}
                    {['open', 'in_progress'].includes(highlightTask.status)
                      && isCodeMode
                      && highlightTask.claimedByGithubLogin === sessionGithub && (
                      <button
                        onClick={() => {
                          setActiveSubmitTaskId(highlightTask.id)
                          setSubmitForm({ prUrl: highlightTask.prUrl || '', commitSha: highlightTask.commitSha || '' })
                        }}
                        className="btn-primary"
                      >
                        Open submit drawer
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="panel rounded-2xl p-6">
                <p className="section-title">How It Works</p>
                <div className="mt-4 space-y-4">
                  {[
                    ['1. Claim task', 'Lock ownership identity for delivery and payout.'],
                    ['2. Submit proof', isCodeMode ? 'Submit PR and optional commit SHA.' : 'Submit issue details, repro steps, and impact scope.'],
                    ['3. Await decision', 'Platform runs review, risk checks, and payout checks.']
                  ].map(([title, desc]) => (
                    <div key={title} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                      <p className="text-sm font-semibold text-white">{title}</p>
                      <p className="mt-2 text-sm leading-6 subtle">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {feedback && (
          <div aria-live="polite" role="status" className={`feedback-banner feedback-${feedback.tone}`}>
            <div>
              <p className="text-sm font-semibold text-white">{feedback.title}</p>
              <p className="mt-1 text-sm subtle">{feedback.detail}</p>
            </div>
            <button onClick={dismiss} className="btn-ghost px-4 py-2 text-xs">Dismiss</button>
          </div>
        )}

        {isCodeMode && !session?.walletAddress && (
          <div className="panel rounded-2xl border border-apple-orange/30 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="section-title">Payout Readiness</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Bind wallet before code submission</h3>
              </div>
              <div className="flex w-full max-w-xl flex-col gap-3 md:flex-row">
                <button onClick={bindWallet} className="btn-secondary" disabled={bindingWallet}>
                  {bindingWallet ? 'Connecting and signing...' : 'Connect wallet'}
                </button>
                <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-xs leading-5 subtle">
                  EVM signature wallets are supported for payout binding.
                </div>
              </div>
            </div>
          </div>
        )}

        {isCodeMode && (
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'All'],
              ['unclaimed', 'Unclaimed'],
              ['mine', 'Mine'],
              ['pending_payout', 'Pending payout']
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key as 'all' | 'unclaimed' | 'mine' | 'pending_payout')}
                className={`filter-chip ${filter === key ? 'filter-chip-active' : ''}`}
              >
                {label} ({filterCounts[key as keyof typeof filterCounts]})
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <SkeletonCard />
        ) : displayTasks.length === 0 ? (
          <div className="panel rounded-[20px] p-10 text-center">
            <p className="text-lg font-semibold text-white">No tasks under this filter</p>
            <p className="mt-3 text-sm leading-6 subtle">
              {filter === 'mine'
                ? 'You have no active tasks yet. Switch to Unclaimed to pick one.'
                : filter === 'pending_payout'
                  ? 'No tasks are awaiting payout currently. New submissions will move here automatically.'
                  : 'Try All tasks or wait for newly synced external tasks.'}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="btn-primary">View all tasks</button>
              )}
              <a href="/staff" className="btn-ghost">Back to internal console</a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {displayTasks.map((task) => {
              const statusMeta = claimStatusMeta(task, sessionGithub)
              const isMine = task.claimedByGithubLogin === sessionGithub
              const canSubmit = ['open', 'in_progress'].includes(task.status) && isCodeMode && isMine
              const explanation = portalNextStep(task, isMine, isCodeMode, hasWallet)
              const payoutTxHash = task.rewardReleaseTxHash || task.txHash
              const payoutExplorerUrl = getExplorerTxUrl(task)
              const isExpanded = expandedTaskIds[task.id] === true
              return (
                <div key={task.id} className="panel rounded-[20px] p-5 md:p-6">
                  <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] px-2.5 py-1 rounded-full ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                        <span className="chip">{task.rewardAmount} {task.rewardToken}</span>
                        <span className="chip">{task.deliveryMode || 'public_mirror_pr'}</span>
                        {task.githubIssueNumber && <span className="chip">Issue #{task.githubIssueNumber}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-semibold text-white">{task.title}</h3>
                        {task.claimedByGithubLogin && <span className="chip">Owner @{task.claimedByGithubLogin}</span>}
                      </div>
                      <p className="mt-3 text-sm leading-7 subtle">{task.description}</p>

                      <div className="mt-4 grid gap-3">
                        <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                          <p className="section-title">Current Status</p>
                          <p className="mt-2 text-sm font-semibold text-white">{humanizeStatus(task.status)}</p>
                          <p className="mt-2 text-sm leading-6 subtle">{explanation}</p>
                          {isExpanded && task.status === 'paid' && payoutTxHash && (
                            <div className="mt-4 rounded-[10px] border border-apple-green/25 bg-apple-green/10 p-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-apple-green">Payout Proof</p>
                              <p className="mt-2 text-sm text-white">Platform has released payout to the contributor.</p>
                              <p className="mt-2 text-xs text-slate-300">Paid at: {formatExactTime(task.paidAt)}</p>
                              <p className="mt-2 break-all font-mono text-xs text-apple-green/85">Tx: {payoutTxHash}</p>
                              <div className="mt-3 flex flex-wrap gap-3">
                                {payoutExplorerUrl && (
                                  <a href={payoutExplorerUrl} target="_blank" className="btn-ghost">
                                    Open explorer
                                  </a>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                          <p className="section-title">Requirement Clarity</p>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {task.requirementClarityStatus || 'Pending analysis'}
                            {task.requirementClarityScore !== undefined ? ` · ${task.requirementClarityScore}` : ''}
                          </p>
                          <p className="mt-2 text-sm leading-6 subtle">
                            {task.requirementClaritySummary || task.requirementSummarySnapshot || 'No additional requirement summary yet. Use Issue details and task description for delivery.'}
                          </p>
                        </div>
                      )}

                      {isExpanded && (task.acceptanceCriteriaSnapshot?.length || task.requirementCriticFindings?.length) && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {task.acceptanceCriteriaSnapshot?.length ? (
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                              <p className="section-title">Acceptance Checklist</p>
                              <div className="mt-3 space-y-2">
                                {task.acceptanceCriteriaSnapshot.slice(0, 3).map((item) => (
                                  <p key={item} className="text-sm subtle">• {item}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {task.requirementCriticFindings?.length ? (
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                              <p className="section-title">Submission Risks</p>
                              <div className="mt-3 space-y-2">
                                {task.requirementCriticFindings.slice(0, 3).map((item) => (
                                  <p key={item} className="text-sm subtle">• {item}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-3">
                        {task.prUrl && <a href={task.prUrl} target="_blank" className="btn-ghost">Open submitted PR</a>}
                        <button
                          onClick={() => setExpandedTaskIds((prev) => ({ ...prev, [task.id]: !(prev[task.id] === true) }))}
                          className="btn-ghost"
                        >
                          {isExpanded ? 'Hide details' : 'Show details'}
                        </button>
                        {!task.claimedByGithubLogin && isCodeMode && (
                          <button
                            onClick={() => claim(task.id)}
                            className="btn-secondary"
                            disabled={busyTaskId === task.id}
                          >
                            {busyTaskId === task.id ? 'Claiming...' : 'Claim task'}
                          </button>
                        )}
                        {canSubmit && (
                          <button
                            onClick={() => {
                              setActiveSubmitTaskId(task.id)
                              setSubmitForm({ prUrl: task.prUrl || '', commitSha: task.commitSha || '' })
                            }}
                            className="btn-primary"
                          >
                            {task.prUrl ? 'Update submission' : 'Submit GitHub PR'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {isExpanded && (
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4">
                        <p className="section-title">Operational Facts</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Company</p>
                            <p className="mt-1 text-sm text-white">{task.companyName || 'Pending sync'}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Repo visibility</p>
                            <p className="mt-1 text-sm text-white">{task.repoVisibility || 'public'}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Repo</p>
                            <p className="mt-1 text-sm text-white">{task.repo || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Last update</p>
                            <p className="mt-1 text-sm text-white">{formatTimeLabel(task.updatedAt)}</p>
                          </div>
                          {task.status === 'paid' && (
                            <>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Payer wallet</p>
                                <p className="mt-1 break-all text-sm text-white">{task.payerWalletAddress || '-'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Contributor wallet</p>
                                <p className="mt-1 break-all text-sm text-white">{task.developerWallet || '-'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Payout Provider</p>
                                <p className="mt-1 text-sm text-white">{task.payoutProvider || '-'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">On-chain receipt</p>
                                <p className="mt-1 break-all text-sm text-white">{payoutTxHash || '-'}</p>
                              </div>
                            </>
                          )}
                        </div>
                          {task.mirrorRepoUrl && <p className="mt-4 text-sm subtle">Mirror repo: {task.mirrorRepoUrl}</p>}
                        </div>
                      )}

                      {activeSubmitTaskId === task.id && canSubmit && (
                        <div className="rounded-2xl border border-apple-blue/25 bg-apple-blue/10 p-4">
                          <p className="section-title">Submission Drawer</p>
                          <h4 className="mt-2 text-lg font-semibold text-white">Submit delivery into review pipeline</h4>
                          <p className="mt-2 text-sm leading-6 subtle">
                            After submission, reviewer, CI, AI gate, and payout checks continue on this PR evidence chain.
                          </p>
                          <div className="mt-4 space-y-3">
                            <div>
                              <label htmlFor="field-submit-pr-url" className="label">PR URL</label>
                              <input
                                id="field-submit-pr-url"
                                value={submitForm.prUrl}
                                onChange={(e) => setSubmitForm((prev) => ({ ...prev, prUrl: e.target.value }))}
                                placeholder="https://github.com/org/repo/pull/123"
                                className="input mt-2"
                              />
                            </div>
                            <div>
                              <label htmlFor="field-submit-commit-sha" className="label">Commit SHA</label>
                              <input
                                id="field-submit-commit-sha"
                                value={submitForm.commitSha}
                                onChange={(e) => setSubmitForm((prev) => ({ ...prev, commitSha: e.target.value }))}
                                placeholder="Commit SHA (optional)"
                                className="input mt-2"
                              />
                            </div>
                            <div className="flex flex-wrap gap-3">
                              <button onClick={() => submit(task.id)} className="btn-primary" disabled={busyTaskId === task.id}>
                                {busyTaskId === task.id ? 'Submitting...' : 'Confirm submit'}
                              </button>
                              <button onClick={() => setActiveSubmitTaskId(null)} className="btn-ghost">Cancel</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
