'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { connectBrowserWallet, signWalletMessage } from '@/lib/browser-wallet'
import { TaskBounty } from '@/lib/types'
import { humanizeStatus } from '@/lib/format'
import { useFeedback } from '@/lib/use-feedback'
import { SkeletonCard } from '@/components/SkeletonLoader'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { useI18n, type MessageKey, type SupportedLocale, type TemplateValues } from '@/lib/i18n'

type Translate = (key: MessageKey, values?: TemplateValues) => string

function claimStatusMeta(task: TaskBounty, t: Translate, sessionGithub?: string) {
  if (task.status === 'paid') {
    return { label: t('external.statusPaid'), className: 'bg-apple-green/10 text-apple-green border border-apple-green/25' }
  }
  if (!task.claimedByGithubLogin) {
    return { label: t('external.statusClaimable'), className: 'bg-white/[0.06] text-white/90 border border-white/[0.10]' }
  }
  if (['awaiting_acceptance', 'submitted', 'accepted'].includes(task.status)) {
    return { label: t('external.statusPendingPayout'), className: 'bg-apple-orange/10 text-apple-orange border border-apple-orange/25' }
  }
  if (task.claimedByGithubLogin === sessionGithub) {
    return { label: t('external.statusMine'), className: 'bg-apple-blue/10 text-apple-blue border border-apple-blue/25' }
  }
  return { label: t('external.statusOwner', { owner: task.claimedByGithubLogin }), className: 'bg-white/[0.06] text-white/50 border border-white/[0.08]' }
}

function formatTimeLabel(value: string | undefined, t: Translate) {
  if (!value) return t('external.updatedRecently')
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return t('external.timePendingSync')
  const diffHours = Math.max(0, Math.round((Date.now() - timestamp) / (1000 * 60 * 60)))
  if (diffHours < 1) return t('external.updatedWithinHour')
  if (diffHours < 24) return t('external.updatedHoursAgo', { hours: diffHours })
  const diffDays = Math.round(diffHours / 24)
  return t('external.updatedDaysAgo', { days: diffDays })
}

function formatExactTime(value: string | undefined, locale: SupportedLocale) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour12: false })
}

function getExplorerTxUrl(task: TaskBounty) {
  const txHash = task.rewardReleaseTxHash || task.txHash
  if (!txHash) return undefined
  const network = (task.treasuryFundingNetwork || '').toLowerCase()
  if (network === 'bsc') return `https://bscscan.com/tx/${txHash}`
  return undefined
}

function portalNextStep(task: TaskBounty, isMine: boolean, isCodeMode: boolean, hasWallet: boolean, t: Translate) {
  if (isCodeMode && !hasWallet) return t('external.nextBindWallet')
  if (!task.claimedByGithubLogin) return isCodeMode ? t('external.nextClaim') : t('external.nextReviewSecurity')
  if (task.claimedByGithubLogin !== undefined && !isMine) return t('external.nextOwned')
  if (task.status === 'open' || task.status === 'in_progress') {
    return isCodeMode ? t('external.nextDeliverCode') : t('external.nextDeliverSecurity')
  }
  if (task.status === 'submitted') return t('external.nextSubmitted')
  if (task.status === 'awaiting_acceptance' || task.status === 'accepted') return t('external.nextPayout')
  if (task.status === 'paid') return t('external.nextPaid')
  return t('external.nextDefault')
}

export default function ExternalPortal() {
  const { locale, setLocale, t } = useI18n()
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

  const fetchTasks = useCallback(async () => {
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
        title: t('external.loadFailedTitle'),
        detail: error instanceof Error ? error.message : t('external.loadFailedDetail')
      })
    } finally {
      setLoading(false)
    }
  }, [setFeedback, t])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

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
        title: t('external.bindWalletFirstTitle'),
        detail: t('external.bindWalletFirstDetail')
      })
      return
    }
    if (!submitForm.prUrl.trim()) {
      setFeedback({
        tone: 'warning',
        title: t('external.prMissingTitle'),
        detail: t('external.prMissingDetail')
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
        title: t('external.submissionFailedTitle'),
        detail: data?.inferPopup || data?.error || t('external.submissionFailedDetail')
      })
      return
    }

    setFeedback({
      tone: 'success',
      title: t('external.submissionSuccessTitle'),
      detail: data?.inferPopup || t('external.submissionSuccessDetail')
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
        title: t('external.claimFailedTitle'),
        detail: data?.error || t('external.claimFailedDetail')
      })
      return
    }

    setFeedback({
      tone: 'success',
      title: t('external.taskClaimedTitle'),
      detail: t('external.taskClaimedDetail')
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
          title: t('external.bindingPreparationFailedTitle'),
          detail: challengeData?.error || t('external.bindingPreparationFailedDetail')
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
          title: t('external.walletBindingFailedTitle'),
          detail: data?.error || t('external.walletBindingFailedDetail')
        })
        return
      }
      setFeedback({
        tone: 'success',
        title: t('external.walletBoundTitle'),
        detail: t('external.walletBoundDetail', { wallet: data.walletAddress })
      })
      fetchTasks()
    } catch (error) {
      setBindingWallet(false)
      setFeedback({
        tone: 'warning',
        title: t('external.walletBindingNotCompletedTitle'),
        detail: error instanceof Error ? error.message : t('external.walletBindingNotCompletedDetail')
      })
    }
  }

  return (
    <div className="core-page">
      <header className="topbar px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-white">{t('external.title')}</h1>
            <p className="text-xs text-gray-500">
              {isCodeMode
                ? t('external.codeMode', { github: session?.githubLogin || '-' })
                : t('external.securityMode', { wallet: session?.walletAddress || '-' })}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <LanguageSwitcher
              locale={locale}
              onChange={setLocale}
              label={t('common.language')}
              englishLabel={t('common.english')}
              chineseLabel={t('common.chinese')}
            />
            <a href="/staff" className="btn-ghost px-4 py-2 text-xs">{t('common.internalConsole')}</a>
          </div>
        </div>
      </header>

      <main className="core-shell space-y-6 p-0">
        <section className="core-hero p-5 md:p-6">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <span className="chip">{t('external.workspace')}</span>
                <span className="chip">{isCodeMode ? t('external.githubToPayout') : t('external.reportToPayout')}</span>
                <span className="chip">{t('external.visibleTasks', { count: baseTasks.length })}</span>
              </div>
              <div>
                <p className="section-title">{t('external.contributorJourney')}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  [t('external.claimable'), String(filterCounts.unclaimed), t('external.claimableDesc')],
                  [t('external.mine'), String(filterCounts.mine), t('external.mineDesc')],
                  [t('external.pendingPayout'), String(filterCounts.pending_payout), t('external.pendingPayoutDesc')]
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
                    <p className="section-title">{t('external.nextBestAction')}</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {highlightTask ? highlightTask.title : t('external.startClaimable')}
                    </p>
                  </div>
                  <span className="chip">{highlightTask ? formatTimeLabel(highlightTask.updatedAt, t) : t('common.notStarted')}</span>
                </div>
                <p className="mt-4 text-sm leading-6 subtle">
                  {highlightTask
                    ? portalNextStep(
                      highlightTask,
                      highlightTask.claimedByGithubLogin === sessionGithub,
                      isCodeMode,
                      hasWallet,
                      t
                    )
                    : t('external.noFilterTasks')}
                </p>
                {highlightTask && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {!highlightTask.claimedByGithubLogin && isCodeMode && (
                      <button
                        onClick={() => claim(highlightTask.id)}
                        className="btn-secondary"
                        disabled={busyTaskId === highlightTask.id}
                      >
                        {busyTaskId === highlightTask.id ? t('external.claiming') : t('external.claimNow')}
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
                        {t('external.openSubmitDrawer')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="panel rounded-2xl p-6">
                <p className="section-title">{t('external.howItWorks')}</p>
                <div className="mt-4 space-y-4">
                  {[
                    [t('external.stepClaim'), t('external.stepClaimDesc')],
                    [t('external.stepSubmit'), isCodeMode ? t('external.stepSubmitCodeDesc') : t('external.stepSubmitSecurityDesc')],
                    [t('external.stepDecision'), t('external.stepDecisionDesc')]
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
            <button onClick={dismiss} className="btn-ghost px-4 py-2 text-xs">{t('common.dismiss')}</button>
          </div>
        )}

        {isCodeMode && !session?.walletAddress && (
          <div className="panel rounded-2xl border border-apple-orange/30 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="section-title">{t('external.payoutReadiness')}</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{t('external.bindWalletTitle')}</h3>
              </div>
              <div className="flex w-full max-w-xl flex-col gap-3 md:flex-row">
                <button onClick={bindWallet} className="btn-secondary" disabled={bindingWallet}>
                  {bindingWallet ? t('external.connectingSigning') : t('external.connectWallet')}
                </button>
                <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-xs leading-5 subtle">
                  {t('external.walletHint')}
                </div>
              </div>
            </div>
          </div>
        )}

        {isCodeMode && (
          <div className="flex flex-wrap gap-2">
            {[
              ['all', t('external.filterAll')],
              ['unclaimed', t('external.filterUnclaimed')],
              ['mine', t('external.filterMine')],
              ['pending_payout', t('external.filterPendingPayout')]
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
            <p className="text-lg font-semibold text-white">{t('external.emptyTitle')}</p>
            <p className="mt-3 text-sm leading-6 subtle">
              {filter === 'mine'
                ? t('external.emptyMine')
                : filter === 'pending_payout'
                  ? t('external.emptyPayout')
                  : t('external.emptyDefault')}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="btn-primary">{t('common.viewAllTasks')}</button>
              )}
              <a href="/staff" className="btn-ghost">{t('common.internalConsole')}</a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {displayTasks.map((task) => {
              const statusMeta = claimStatusMeta(task, t, sessionGithub)
              const isMine = task.claimedByGithubLogin === sessionGithub
              const canSubmit = ['open', 'in_progress'].includes(task.status) && isCodeMode && isMine
              const explanation = portalNextStep(task, isMine, isCodeMode, hasWallet, t)
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
                        {task.claimedByGithubLogin && <span className="chip">{t('external.owner', { owner: task.claimedByGithubLogin })}</span>}
                      </div>
                      <p className="mt-3 text-sm leading-7 subtle">{task.description}</p>

                      <div className="mt-4 grid gap-3">
                        <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                          <p className="section-title">{t('external.currentStatus')}</p>
                          <p className="mt-2 text-sm font-semibold text-white">{humanizeStatus(task.status)}</p>
                          <p className="mt-2 text-sm leading-6 subtle">{explanation}</p>
                          {isExpanded && task.status === 'paid' && payoutTxHash && (
                            <div className="mt-4 rounded-[10px] border border-apple-green/25 bg-apple-green/10 p-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-apple-green">{t('external.payoutProof')}</p>
                              <p className="mt-2 text-sm text-white">{t('external.payoutCompleted')}</p>
                              <p className="mt-2 text-xs text-slate-300">{t('external.paidAt')} {formatExactTime(task.paidAt, locale)}</p>
                              <p className="mt-2 break-all font-mono text-xs text-apple-green/85">Tx: {payoutTxHash}</p>
                              <div className="mt-3 flex flex-wrap gap-3">
                                {payoutExplorerUrl && (
                                  <a href={payoutExplorerUrl} target="_blank" className="btn-ghost">
                                    {t('external.openExplorer')}
                                  </a>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                          <p className="section-title">{t('external.requirementClarity')}</p>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {task.requirementClarityStatus || t('external.pendingAnalysis')}
                            {task.requirementClarityScore !== undefined ? ` - ${task.requirementClarityScore}` : ''}
                          </p>
                          <p className="mt-2 text-sm leading-6 subtle">
                            {task.requirementClaritySummary || task.requirementSummarySnapshot || t('external.noAdditionalRequirement')}
                          </p>
                        </div>
                      )}

                      {isExpanded && (task.acceptanceCriteriaSnapshot?.length || task.requirementCriticFindings?.length) && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {task.acceptanceCriteriaSnapshot?.length ? (
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                              <p className="section-title">{t('external.acceptanceChecklist')}</p>
                              <div className="mt-3 space-y-2">
                                {task.acceptanceCriteriaSnapshot.slice(0, 3).map((item) => (
                                  <p key={item} className="text-sm subtle">- {item}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {task.requirementCriticFindings?.length ? (
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                              <p className="section-title">{t('external.submissionRisks')}</p>
                              <div className="mt-3 space-y-2">
                                {task.requirementCriticFindings.slice(0, 3).map((item) => (
                                  <p key={item} className="text-sm subtle">- {item}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-3">
                        {task.prUrl && <a href={task.prUrl} target="_blank" className="btn-ghost">{t('external.openSubmittedPr')}</a>}
                        <button
                          onClick={() => setExpandedTaskIds((prev) => ({ ...prev, [task.id]: !(prev[task.id] === true) }))}
                          className="btn-ghost"
                        >
                          {isExpanded ? t('external.hideDetails') : t('external.showDetails')}
                        </button>
                        {!task.claimedByGithubLogin && isCodeMode && (
                          <button
                            onClick={() => claim(task.id)}
                            className="btn-secondary"
                            disabled={busyTaskId === task.id}
                          >
                            {busyTaskId === task.id ? t('external.claiming') : t('external.claimTask')}
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
                            {task.prUrl ? t('external.updateSubmission') : t('external.submitGithubPr')}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {isExpanded && (
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4">
                        <p className="section-title">{t('external.operationalFacts')}</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.company')}</p>
                            <p className="mt-1 text-sm text-white">{task.companyName || t('external.pendingSync')}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.repoVisibility')}</p>
                            <p className="mt-1 text-sm text-white">{task.repoVisibility || 'public'}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.repo')}</p>
                            <p className="mt-1 text-sm text-white">{task.repo || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.lastUpdate')}</p>
                            <p className="mt-1 text-sm text-white">{formatTimeLabel(task.updatedAt, t)}</p>
                          </div>
                          {task.status === 'paid' && (
                            <>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.payerWallet')}</p>
                                <p className="mt-1 break-all text-sm text-white">{task.payerWalletAddress || '-'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.contributorWallet')}</p>
                                <p className="mt-1 break-all text-sm text-white">{task.developerWallet || '-'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.payoutProvider')}</p>
                                <p className="mt-1 text-sm text-white">{task.payoutProvider || '-'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('external.onchainReceipt')}</p>
                                <p className="mt-1 break-all text-sm text-white">{payoutTxHash || '-'}</p>
                              </div>
                            </>
                          )}
                        </div>
                          {task.mirrorRepoUrl && <p className="mt-4 text-sm subtle">{t('external.mirrorRepo')} {task.mirrorRepoUrl}</p>}
                        </div>
                      )}

                      {activeSubmitTaskId === task.id && canSubmit && (
                        <div className="rounded-2xl border border-apple-blue/25 bg-apple-blue/10 p-4">
                          <p className="section-title">{t('external.submissionDrawer')}</p>
                          <h4 className="mt-2 text-lg font-semibold text-white">{t('external.submitDeliveryTitle')}</h4>
                          <p className="mt-2 text-sm leading-6 subtle">
                            {t('external.submitDeliveryDesc')}
                          </p>
                          <div className="mt-4 space-y-3">
                            <div>
                              <label htmlFor="field-submit-pr-url" className="label">{t('external.prUrl')}</label>
                              <input
                                id="field-submit-pr-url"
                                value={submitForm.prUrl}
                                onChange={(e) => setSubmitForm((prev) => ({ ...prev, prUrl: e.target.value }))}
                                placeholder="https://github.com/org/repo/pull/123"
                                className="input mt-2"
                              />
                            </div>
                            <div>
                              <label htmlFor="field-submit-commit-sha" className="label">{t('external.commitSha')}</label>
                              <input
                                id="field-submit-commit-sha"
                                value={submitForm.commitSha}
                                onChange={(e) => setSubmitForm((prev) => ({ ...prev, commitSha: e.target.value }))}
                                placeholder={t('external.commitShaPlaceholder')}
                                className="input mt-2"
                              />
                            </div>
                            <div className="flex flex-wrap gap-3">
                              <button onClick={() => submit(task.id)} className="btn-primary" disabled={busyTaskId === task.id}>
                                {busyTaskId === task.id ? t('external.submitting') : t('external.confirmSubmit')}
                              </button>
                              <button onClick={() => setActiveSubmitTaskId(null)} className="btn-ghost">{t('external.cancel')}</button>
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
