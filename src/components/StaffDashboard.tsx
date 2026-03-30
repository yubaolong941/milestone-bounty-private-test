'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CompanyRole, PaymentRecord, TaskBounty, TreasuryFundingRecord } from '@/lib/types'
import type { UserRole } from '@/lib/auth'
import PaymentHistory from '@/components/PaymentHistory'
import TaskBountyBoard from '@/components/TaskBountyBoard'
import RepoConfigBoard from '@/components/RepoConfigBoard'
import IntegrationHealthBoard from '@/components/IntegrationHealthBoard'
import CompanyWalletBoard from '@/components/CompanyWalletBoard'
import CompanyBoard from '@/components/CompanyBoard'
import CompanyMembershipBoard from '@/components/CompanyMembershipBoard'
import AuditLogBoard from '@/components/AuditLogBoard'
import ManualReviewBoard from '@/components/ManualReviewBoard'
import NotificationCenter from '@/components/NotificationCenter'
import ExecutiveOverviewBoard from '@/components/ExecutiveOverviewBoard'
import CompanyOnboardingGuide from '@/components/CompanyOnboardingGuide'
import type { SetupStage } from '@/components/CompanyOnboardingGuide'
import TreasuryFundingHistory from '@/components/TreasuryFundingHistory'
import { SkeletonCard } from '@/components/SkeletonLoader'
import { hasCompanyCapability } from '@/lib/permissions'

type ProductLayer = 'overview' | 'operations' | 'evidence'
type OperationsView = 'priority' | 'tasks' | 'reviews' | 'payments' | 'alerts' | 'setup'
type EvidenceView = 'exports' | 'ledger' | 'audit' | 'health'

const roleCopy: Record<UserRole, { label: string; headline: string; focus: string[] }> = {
  admin: {
    label: 'Platform Admin',
    headline: 'Command Center',
    focus: ['Health', 'Blockers', 'Evidence']
  },
  staff: {
    label: 'Operations',
    headline: 'Command Center',
    focus: ['Priority Queue', 'Settlement', 'Evidence']
  },
  reviewer: {
    label: 'Reviewer',
    headline: 'Review Desk',
    focus: ['Manual Review', 'Evidence Gaps', 'Decision']
  },
  finance: {
    label: 'Finance',
    headline: 'Settlement Desk',
    focus: ['Payout Queue', 'Failures', 'Ledger']
  },
  external_contributor: {
    label: 'Contributor',
    headline: 'Delivery Desk',
    focus: ['Tasks', 'Review', 'Payout']
  }
}

const layerCopy: Record<ProductLayer, { label: string; title: string }> = {
  overview: {
    label: 'Overview',
    title: 'Overview'
  },
  operations: {
    label: 'Operations',
    title: 'Operations'
  },
  evidence: {
    label: 'Evidence',
    title: 'Evidence'
  }
}

const operationsViews: Array<{ key: OperationsView; label: string }> = [
  { key: 'setup', label: 'Workflow Setup' },
  { key: 'tasks', label: 'Task Flow' },
  { key: 'priority', label: 'Priority Queue' },
  { key: 'reviews', label: 'Review Decisions' },
  { key: 'payments', label: 'Settlement Queue' },
  { key: 'alerts', label: 'Alerts' },
]

const evidenceViews: Array<{ key: EvidenceView; label: string }> = [
  { key: 'exports', label: 'Client Exports' },
  { key: 'ledger', label: 'Ledger' },
  { key: 'audit', label: 'Audit Trail' },
  { key: 'health', label: 'System Proof' }
]

function statusTone(value: 'healthy' | 'at_risk' | 'critical') {
  if (value === 'healthy') return 'border-apple-green/25 bg-apple-green/10 text-apple-green'
  if (value === 'at_risk') return 'border-apple-orange/25 bg-apple-orange/10 text-apple-orange'
  return 'border-apple-red/25 bg-apple-red/10 text-apple-red'
}

export default function StaffDashboard() {
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [treasuryFundings, setTreasuryFundings] = useState<TreasuryFundingRecord[]>([])
  const [tasks, setTasks] = useState<TaskBounty[]>([])
  const [role, setRole] = useState<UserRole>('staff')
  const [companyRole, setCompanyRole] = useState<CompanyRole | undefined>(undefined)
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [activeLayer, setActiveLayer] = useState<ProductLayer>('operations')
  const [operationsView, setOperationsView] = useState<OperationsView>('priority')
  const [evidenceView, setEvidenceView] = useState<EvidenceView>('exports')
  const [taskQueuePreset, setTaskQueuePreset] = useState<{
    source: 'all' | 'internal' | 'external'
    status: 'all' | TaskBounty['status']
    search: string
    needsRequirementBinding: boolean
  }>({ source: 'all', status: 'all', search: '', needsRequirementBinding: false })
  const [reviewQueuePreset, setReviewQueuePreset] = useState<'all' | 'critical' | 'finance' | 'review'>('all')
  const [paymentQueuePreset, setPaymentQueuePreset] = useState<'all' | 'with_issue' | 'locked' | 'high_value'>('all')
  const [setupStage, setSetupStage] = useState<SetupStage>('company')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const syncUrlParam = useCallback((key: string, value: string) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set(key, value)
    window.history.replaceState(null, '', url.toString())
  }, [])

  const switchLayer = useCallback((layer: ProductLayer) => {
    setActiveLayer(layer)
    syncUrlParam('layer', layer)
  }, [syncUrlParam])

  const switchOpsView = useCallback((view: OperationsView) => {
    setOperationsView(view)
    syncUrlParam('ops', view)
  }, [syncUrlParam])

  const switchEvidenceView = useCallback((view: EvidenceView) => {
    setEvidenceView(view)
    syncUrlParam('evidence', view)
  }, [syncUrlParam])

  async function fetchJson<T>(url: string, fallback: T): Promise<T> {
    const response = await fetch(url, { credentials: 'include' })
    const contentType = response.headers.get('content-type') || ''

    if (!contentType.includes('application/json')) {
      if (response.ok) return fallback
      throw new Error(`${url} returned non-JSON response`)
    }

    const payload = await response.json()
    if (!response.ok) {
      const message = typeof payload?.error === 'string' ? payload.error : `${url} request failed`
      throw new Error(message)
    }

    return payload as T
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      setLoadError(null)

      const [pay, t, me, fundings] = await Promise.all([
        fetchJson<PaymentRecord[]>('/api/payments', []),
        fetchJson<TaskBounty[]>('/api/tasks', []),
        fetchJson<{ session?: { userId?: string; role?: UserRole; activeCompanyRole?: CompanyRole }, companyContext?: { membership?: { role?: CompanyRole } } } | null>('/api/auth/me', null),
        fetchJson<TreasuryFundingRecord[]>('/api/platform/treasury-fundings', [])
      ])
      const sessionInfo = me?.session as
        | { userId?: string; role?: UserRole; activeCompanyRole?: CompanyRole }
        | undefined

      setPayments(Array.isArray(pay) ? pay : [])
      setTasks(Array.isArray(t) ? t : [])
      setTreasuryFundings(Array.isArray(fundings) ? fundings : [])
      setRole((sessionInfo?.role || 'staff') as UserRole)
      setCompanyRole((me?.companyContext?.membership?.role || sessionInfo?.activeCompanyRole || undefined) as CompanyRole | undefined)
      setCurrentUserId(String(sessionInfo?.userId || ''))

      if (sessionInfo?.role !== 'admin' && !me?.companyContext) {
        setLoadError('Current account has no active company context. Join or switch company first.')
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Dashboard data failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const openSetupStage = (stage: SetupStage) => {
    switchLayer('operations')
    switchOpsView('setup')
    setSetupStage(stage)

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const target = document.getElementById('setup-stage-panel')
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const layer = url.searchParams.get('layer')
    const ops = url.searchParams.get('ops')
    const evidence = url.searchParams.get('evidence')
    const source = url.searchParams.get('source')
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search') || ''
    const preset = url.searchParams.get('preset')
    const needs = url.searchParams.get('needs')

    if (layer === 'overview' || layer === 'operations' || layer === 'evidence') setActiveLayer(layer)
    if (ops && operationsViews.some((item) => item.key === ops)) setOperationsView(ops as OperationsView)
    if (evidence && evidenceViews.some((item) => item.key === evidence)) setEvidenceView(evidence as EvidenceView)
    if (preset === 'review' || preset === 'critical' || preset === 'finance' || preset === 'all') setReviewQueuePreset(preset)
    if (preset === 'all' || preset === 'with_issue' || preset === 'locked' || preset === 'high_value') setPaymentQueuePreset(preset)

    setTaskQueuePreset({
      source: source === 'internal' || source === 'external' ? source : 'all',
      status: status && status !== 'all' ? status as TaskBounty['status'] : 'all',
      search,
      needsRequirementBinding: needs === 'requirement'
    })
  }, [])

  const externalTasks = tasks.filter((task) => task.source === 'external').length
  const reviewQueueCount = tasks.filter((task) =>
    task.manualReviewRequired ||
    task.status === 'awaiting_manual_review' ||
    task.status === 'awaiting_finance_review' ||
    task.status === 'payment_failed'
  ).length
  const waitingAcceptanceCount = tasks.filter((task) => task.status === 'awaiting_acceptance').length
  const lockedTasks = tasks.filter((task) => task.rewardLockStatus === 'locked').length
  const paidTaskCount = tasks.filter((task) => task.status === 'paid').length
  const paymentFailureCount = tasks.filter((task) => task.status === 'payment_failed').length
  const missingRequirementLinks = tasks.filter((task) => !task.requirementDocUrl).length
  const missingOwners = tasks.filter((task) => task.source === 'external' && !task.claimedByGithubLogin).length

  const health: 'healthy' | 'at_risk' | 'critical' = paymentFailureCount > 0 || reviewQueueCount > 6
    ? 'critical'
    : waitingAcceptanceCount > 0 || missingRequirementLinks > 0
      ? 'at_risk'
      : 'healthy'

  const topPriorities = useMemo(() => {
    const items = [
      {
        title: 'Manual review queue',
        value: reviewQueueCount,
        owner: 'Reviewer / Ops',
        reason: 'Delivery exists, but release decisions are still pending.',
        action: 'Open Review Decisions and clear pending manual reviews and payout failures.'
      },
      {
        title: 'Awaiting acceptance',
        value: waitingAcceptanceCount,
        owner: 'Owner / Product',
        reason: 'Delivery is done but acceptance is not completed yet.',
        action: 'Finalize acceptance first to avoid last-mile delays.'
      },
      {
        title: 'Payout failures and retries',
        value: paymentFailureCount,
        owner: 'Finance / Ops',
        reason: 'This directly impacts customer trust.',
        action: 'Open Settlement Queue to inspect failure reasons and retry owners.'
      },
      {
        title: 'Missing requirement structure',
        value: missingRequirementLinks,
        owner: 'Product / Ops',
        reason: 'Execution and acceptance lose alignment without clear requirement context.',
        action: 'Add requirement summary, acceptance criteria, and reference material.'
      }
    ]
    return items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 3)
  }, [reviewQueueCount, waitingAcceptanceCount, paymentFailureCount, missingRequirementLinks])

  const exportLinks = {
    daily: '/api/ops/overview?scenario=live&view=daily&format=md',
    customer: '/api/ops/overview?scenario=live&view=customer&format=md',
    weekly: '/api/ops/overview?scenario=live&view=weekly&format=md',
    kpis: '/api/ops/overview?scenario=live&format=csv',
    audit: '/api/audit-logs?format=csv',
    payments: '/api/payments?format=csv'
  }

  const ownershipCards = [
    {
      label: 'Ops owner',
      value: externalTasks,
      detail: 'Drive tasks from requirement to execution'
    },
    {
      label: 'Reviewer owner',
      value: reviewQueueCount,
      detail: 'Provide manual review and release decisions'
    },
    {
      label: 'Finance owner',
      value: paymentFailureCount + lockedTasks,
      detail: 'Ensure payout, retry, and settlement evidence closure'
    },
    {
      label: 'Product/Owner',
      value: waitingAcceptanceCount + missingOwners,
      detail: 'Close acceptance and ownership without dangling tasks'
    }
  ]

  const externalFlowGroups = [
    {
      key: 'claimable',
      title: 'Claimable',
      count: tasks.filter((task) => task.source === 'external' && !task.claimedByGithubLogin && task.status === 'open').length,
      description: 'Published and ready for contributors to claim now.',
      actionLabel: 'View claimable tasks',
      action: () => {
        setTaskQueuePreset({ source: 'external', status: 'open', search: '', needsRequirementBinding: false })
        switchOpsView('tasks')
      }
    },
    {
      key: 'in_progress',
      title: 'In progress',
      count: tasks.filter((task) => task.source === 'external' && Boolean(task.claimedByGithubLogin) && ['open', 'in_progress', 'submitted', 'ai_reviewing'].includes(task.status)).length,
      description: 'Already owned. Focus on delivery pace, PR checks, and AI/CI results.',
      actionLabel: 'View in-progress tasks',
      action: () => {
        setTaskQueuePreset({ source: 'external', status: 'in_progress', search: '', needsRequirementBinding: false })
        switchOpsView('tasks')
      }
    },
    {
      key: 'awaiting_acceptance',
      title: 'Awaiting acceptance',
      count: tasks.filter((task) => task.source === 'external' && ['awaiting_acceptance', 'awaiting_manual_review'].includes(task.status)).length,
      description: 'Delivery entered review. Reviewer or owner must approve or reject.',
      actionLabel: 'Open acceptance queue',
      action: () => {
        setTaskQueuePreset({ source: 'external', status: 'awaiting_acceptance', search: '', needsRequirementBinding: false })
        switchOpsView('tasks')
      }
    },
    {
      key: 'awaiting_payout',
      title: 'Awaiting payout',
      count: tasks.filter((task) => task.source === 'external' && ['accepted', 'awaiting_finance_review', 'payment_failed'].includes(task.status)).length,
      description: 'Near closure. Finance and ops should settle, retry, or explain exceptions.',
      actionLabel: 'Open settlement queue',
      action: () => {
        setPaymentQueuePreset('with_issue')
        switchOpsView('payments')
      }
    }
  ]

  const heroCopy = roleCopy[role]

  const renderOverview = () => (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ['Health status', health === 'healthy' ? 'Healthy' : health === 'at_risk' ? 'At risk' : 'Critical'],
          ['Pending actions', String(reviewQueueCount + paymentFailureCount + waitingAcceptanceCount)],
          ['Missing requirement links', String(missingRequirementLinks)],
          ['Completed payouts', String(paidTaskCount)],
          ['Exportable evidence', String(payments.length)]
        ].map(([label, value]) => (
          <div key={label} className="panel metric-card rounded-2xl p-5">
            <p className="section-title">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="panel rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-title">Today First</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Top priorities today</h2>
            </div>
            <span className="chip">{topPriorities.length || 1} priorities</span>
          </div>
          <div className="mt-5 space-y-3">
            {topPriorities.length === 0 ? (
              <div className="rounded-xl border border-apple-green/25 bg-apple-green/10 p-5 text-sm text-apple-green">
                No high-priority blockers right now
              </div>
            ) : topPriorities.map((item) => (
              <div key={item.title} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">{item.owner}</span>
                  <span className="chip">{item.value} items</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{item.title}</p>
                <p className="mt-3 text-sm text-white">{item.action}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-title">Ownership</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Ownership now</h2>
            </div>
            <span className={`chip border ${statusTone(health)}`}>{health}</span>
          </div>
          <div className="mt-5 grid gap-3">
            {ownershipCards.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <span className="chip">{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ExecutiveOverviewBoard />
    </div>
  )

  const renderOperations = () => {
    if (operationsView === 'tasks') {
      return (
        <TaskBountyBoard
          tasks={tasks}
          onRefresh={fetchData}
          userRole={role}
          companyRole={companyRole}
          initialSourceFilter={taskQueuePreset.source}
          initialStatusFilter={taskQueuePreset.status}
          initialSearch={taskQueuePreset.search}
          initialNeedsRequirementBinding={taskQueuePreset.needsRequirementBinding}
        />
      )
    }
    if (operationsView === 'reviews') {
      return <ManualReviewBoard tasks={tasks} onRefresh={fetchData} initialFilter={reviewQueuePreset} />
    }
    if (operationsView === 'payments') {
      return (
        <div className="space-y-4">
          <TreasuryFundingHistory items={treasuryFundings} />
          <PaymentHistory payments={payments} filter={paymentQueuePreset} />
        </div>
      )
    }
    if (operationsView === 'alerts') return <NotificationCenter />
    if (operationsView === 'setup') {
      const renderSetupStage = () => {
        if (setupStage === 'company') return (role === 'admin' || hasCompanyCapability(companyRole, 'company.manage')) ? <CompanyBoard /> : <div className="panel rounded-2xl p-8 text-center subtle">Your role does not have company configuration access.</div>
        if (setupStage === 'members') return (role === 'admin' || hasCompanyCapability(companyRole, 'member.manage')) ? <CompanyMembershipBoard /> : <div className="panel rounded-2xl p-8 text-center subtle">Your role does not have member management access.</div>
        if (setupStage === 'repos') return (role === 'admin' || hasCompanyCapability(companyRole, 'repo.manage')) ? <RepoConfigBoard /> : <div className="panel rounded-2xl p-8 text-center subtle">Your role does not have repository configuration access.</div>
        if (setupStage === 'wallets') return (role === 'admin' || hasCompanyCapability(companyRole, 'wallet.manage')) ? <CompanyWalletBoard /> : <div className="panel rounded-2xl p-8 text-center subtle">Your role does not have wallet configuration access.</div>
        return (
          <TaskBountyBoard
            tasks={tasks}
            onRefresh={fetchData}
            userRole={role}
            companyRole={companyRole}
            initialSourceFilter="internal"
            initialStatusFilter="all"
            initialSearch=""
            initialNeedsRequirementBinding={false}
          />
        )
      }

      return (
        <div className="space-y-4">
          <CompanyOnboardingGuide
            activeStage={setupStage}
            onStageChange={setSetupStage}
            onNavigateToTasks={() => switchOpsView('tasks')}
            onNavigateToPublish={() => {
              switchLayer('operations')
              switchOpsView('tasks')
              setTaskQueuePreset({ source: 'internal', status: 'all', search: '', needsRequirementBinding: false })
            }}
            onOpenStage={openSetupStage}
          />
          <div id="setup-stage-panel">
            {renderSetupStage()}
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Manual review', String(reviewQueueCount)],
            ['Awaiting acceptance', String(waitingAcceptanceCount)],
            ['Payment failures', String(paymentFailureCount)],
            ['Unassigned', String(missingOwners)]
          ].map(([label, value]) => (
            <div key={label} className="panel rounded-2xl p-5">
              <p className="section-title">{label}</p>
              <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </section>

        <section className="panel rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-title">Today 3 Actions</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">What to execute first</h3>
            </div>
            <span className="chip">{topPriorities.length || 1} actions</span>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {(topPriorities.length > 0 ? topPriorities : [
              { title: 'No critical blockers', value: 0, owner: 'System', action: 'Continue monitoring and process incoming tasks.' }
            ]).map((item) => (
              <div key={item.title} className="core-action">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <span className="chip">{item.value}</span>
                </div>
                <p className="mt-2 text-xs subtle">{item.owner}</p>
                <p className="mt-2 text-sm text-white/85">{item.action}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="panel rounded-2xl p-6">
            <p className="section-title">External Flow</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Current stage distribution</h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {externalFlowGroups.map((group) => (
                <button key={group.key} onClick={group.action} className="core-action text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{group.title}</p>
                    <span className="chip">{group.count}</span>
                  </div>
                  <p className="mt-2 text-xs subtle">{group.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="panel rounded-2xl p-6">
            <p className="section-title">Quick Redirect</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Open queue by intent</h3>
            <div className="mt-5 grid gap-3">
              {[
                {
                  title: 'Review decisions',
                  count: reviewQueueCount,
                  action: () => {
                    setReviewQueuePreset('review')
                    switchOpsView('reviews')
                  }
                },
                {
                  title: 'Settlement queue',
                  count: paymentFailureCount,
                  action: () => {
                    setPaymentQueuePreset('high_value')
                    switchOpsView('payments')
                  }
                },
                {
                  title: 'Acceptance queue',
                  count: waitingAcceptanceCount,
                  action: () => {
                    setTaskQueuePreset({ source: 'all', status: 'awaiting_acceptance', search: '', needsRequirementBinding: false })
                    switchOpsView('tasks')
                  }
                },
                {
                  title: 'Requirements fix',
                  count: missingRequirementLinks,
                  action: () => {
                    setTaskQueuePreset({ source: 'external', status: 'all', search: '', needsRequirementBinding: true })
                    switchOpsView('tasks')
                  }
                }
              ].map((item) => (
                <button key={item.title} onClick={item.action} className="core-action text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <span className="chip">{item.count}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    )
  }

  const renderEvidence = () => {
    if (evidenceView === 'ledger') {
      return (
        <div className="space-y-4">
          <TreasuryFundingHistory items={treasuryFundings} />
          <PaymentHistory payments={payments} />
        </div>
      )
    }
    if (evidenceView === 'audit') return <AuditLogBoard />
    if (evidenceView === 'health') return <IntegrationHealthBoard />
    return (
      <div className="space-y-4">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Client-ready', `${paidTaskCount}/${tasks.length || 1}`],
            ['Payment evidence', String(payments.length)],
            ['Pending audit', String(reviewQueueCount)],
            ['Payment failures', String(paymentFailureCount)]
          ].map(([label, value]) => (
            <div key={label} className="panel rounded-2xl p-5">
              <p className="section-title">{label}</p>
              <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="panel rounded-2xl p-6">
            <p className="section-title">Export Ready</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Export reports for clients and stakeholders</h3>
            <div className="mt-5 grid gap-3">
              {[
                {
                  title: 'Client report',
                  href: exportLinks.customer,
                  description: 'For client leads to review outcomes, risks, and next steps.'
                },
                {
                  title: 'Daily ops report',
                  href: exportLinks.daily,
                  description: 'For syncing today\'s blockers, owners, and resolution progress.'
                },
                {
                  title: 'Weekly project report',
                  href: exportLinks.weekly,
                  description: 'For exec, project owners, and weekly client reviews.'
                },
                {
                  title: 'KPI summary',
                  href: exportLinks.kpis,
                  description: 'Export overall metrics for leadership trend views.'
                }
              ].map((item) => (
                <a
                  key={item.title}
                  href={item.href}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4 transition-colors hover:bg-white/[0.08]"
                >
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-3 text-sm text-apple-blue">Export now</p>
                </a>
              ))}
            </div>
          </div>

          <div className="panel rounded-2xl p-6">
            <p className="section-title">Evidence Pack</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">One-click evidence pack download</h3>
            <div className="mt-5 grid gap-3">
              {[
                {
                  title: 'Payment ledger CSV',
                  href: exportLinks.payments,
                  description: 'Export settlement records, Issue/PR links, claimers, and tx hashes.'
                },
                {
                  title: 'Audit log CSV',
                  href: exportLinks.audit,
                  description: 'Export actor, action, target, and summary fields.'
                }
              ].map((item) => (
                <a
                  key={item.title}
                  href={item.href}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4 transition-colors hover:bg-white/[0.08]"
                >
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-3 text-sm text-apple-blue">Download</p>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="panel rounded-2xl p-6">
          <p className="section-title">Evidence Quality</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Evidence gaps to close</h3>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ['Missing requirement source', missingRequirementLinks],
              ['Unresolved payment failures', paymentFailureCount],
              ['Manual review without decision', reviewQueueCount]
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <span className="chip">{value}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  const layerTabs: Array<{ key: ProductLayer; count?: number }> = [
    { key: 'overview', count: reviewQueueCount + paymentFailureCount + waitingAcceptanceCount },
    { key: 'operations', count: tasks.length },
    { key: 'evidence', count: payments.length }
  ]

  const activeLayerCopy = layerCopy[activeLayer]
  const isDevAdminSession = role === 'admin' && currentUserId === 'local-dev-admin'

  return (
    <div className="core-page">
      <div className="core-shell space-y-5">
        <header className="core-hero p-4 md:p-5">
          <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <span className="chip">tomo command center</span>
                {isDevAdminSession && <span className="chip border border-apple-orange/30 bg-apple-orange/12 text-apple-orange">DEV MODE</span>}
                <span className="chip">{heroCopy.label}</span>
                <span className={`chip border ${statusTone(health)}`}>{health}</span>
              </div>
              <div>
                <p className="section-title">Product Layer</p>
                <h1 className="mt-2.5 max-w-4xl text-2xl font-semibold leading-tight text-white md:text-4xl">
                  {activeLayerCopy.title}
                </h1>
              </div>
              <div className="flex flex-wrap gap-2">
                {layerTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => switchLayer(tab.key)}
                    className={`filter-chip ${activeLayer === tab.key ? 'filter-chip-active' : ''}`}
                  >
                    {layerCopy[tab.key].label}
                    {typeof tab.count === 'number' ? ` (${tab.count})` : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel rounded-2xl p-5">
                  <p className="section-title">Today Health</p>
                  <p className="mt-3 text-xl font-semibold text-white">{health === 'healthy' ? 'Healthy' : health === 'at_risk' ? 'At risk' : 'Critical attention'}</p>
                </div>
                <div className="panel rounded-2xl p-5">
                  <p className="section-title">Export Readiness</p>
                  <p className="mt-3 text-xl font-semibold text-white">{payments.length > 0 || paidTaskCount > 0 ? 'Exportable now' : 'Evidence incomplete'}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {activeLayer === 'operations' && (
          <section className="panel rounded-2xl p-3">
            <div className="flex flex-wrap gap-2">
              {operationsViews.map((view) => (
                <button
                  key={view.key}
                  onClick={() => switchOpsView(view.key)}
                  className={`filter-chip ${operationsView === view.key ? 'filter-chip-active' : ''}`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {activeLayer === 'evidence' && (
          <section className="panel rounded-2xl p-3">
            <div className="flex flex-wrap gap-2">
              {evidenceViews.map((view) => (
                <button
                  key={view.key}
                  onClick={() => switchEvidenceView(view.key)}
                  className={`filter-chip ${evidenceView === view.key ? 'filter-chip-active' : ''}`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : loadError ? (
          <div className="panel rounded-[20px] p-12 text-center">
            <div className="text-lg font-semibold text-white">Dashboard failed to load</div>
            <p className="mt-3 subtle">{loadError}</p>
            <button className="btn-primary mt-6" onClick={() => { void fetchData() }}>Reload</button>
          </div>
        ) : activeLayer === 'overview' ? (
          renderOverview()
        ) : activeLayer === 'operations' ? (
          renderOperations()
        ) : (
          renderEvidence()
        )}
      </div>
    </div>
  )
}
