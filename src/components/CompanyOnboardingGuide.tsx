'use client'

import { useEffect, useMemo, useState } from 'react'
import { CompanyOnboardingState } from '@/lib/types'
import { SkeletonCard } from '@/components/SkeletonLoader'

export type SetupStage = 'company' | 'members' | 'repos' | 'wallets' | 'publish'

interface Props {
  activeStage: SetupStage
  onStageChange: (stage: SetupStage) => void
  onNavigateToTasks: () => void
  onNavigateToPublish: () => void
  onOpenStage: (stage: SetupStage) => void
}

interface SessionPayload {
  session?: {
    activeCompanyId?: string
  } | null
}

interface CompanySummary {
  id: string
  name: string
  status: string
  githubOrgLogin?: string
  meegleWorkspaceId?: string
  meegleProjectKey?: string
  onboarding?: CompanyOnboardingState
}

export default function CompanyOnboardingGuide({ activeStage, onStageChange, onNavigateToTasks, onNavigateToPublish, onOpenStage }: Props) {
  const [loading, setLoading] = useState(true)
  const [activeCompanyId, setActiveCompanyId] = useState<string | undefined>()
  const [companies, setCompanies] = useState<CompanySummary[]>([])

  const load = async () => {
    setLoading(true)
    const [meRes, companiesRes] = await Promise.all([
      fetch('/api/auth/me').then((r) => r.json()).catch(() => ({} as SessionPayload)),
      fetch('/api/companies').then((r) => r.json()).catch(() => [])
    ])

    const nextCompanies = Array.isArray(companiesRes) ? companiesRes : []
    const nextActiveCompanyId = meRes?.session?.activeCompanyId || nextCompanies[0]?.id
    setActiveCompanyId(nextActiveCompanyId)
    setCompanies(nextCompanies)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleSetupUpdated = () => {
      load()
    }
    window.addEventListener('wlfi:setup-updated', handleSetupUpdated)
    return () => {
      window.removeEventListener('wlfi:setup-updated', handleSetupUpdated)
    }
  }, [])

  const activeCompany = useMemo(
    () => companies.find((item) => item.id === activeCompanyId) || companies[0] || null,
    [activeCompanyId, companies]
  )
  const onboarding = activeCompany?.onboarding
  const nextVisibleStage = useMemo<SetupStage>(() => {
    if (!activeCompany) return 'company'
    return ([
      { key: 'company', complete: Boolean(activeCompany) },
      { key: 'members', complete: onboarding?.completedStages.includes('membership_ready') || false },
      { key: 'repos', complete: onboarding?.completedStages.includes('repo_ready') || false },
      { key: 'wallets', complete: onboarding?.completedStages.includes('wallet_ready') || false },
      { key: 'publish', complete: onboarding?.completedStages.includes('first_task_published') || false }
    ].find((item) => !item.complete)?.key || 'publish') as SetupStage
  }, [activeCompany, onboarding])
  const completeByStage = useMemo<Record<SetupStage, boolean>>(() => ({
    company: Boolean(activeCompany),
    members: onboarding?.completedStages.includes('membership_ready') || false,
    repos: onboarding?.completedStages.includes('repo_ready') || false,
    wallets: onboarding?.completedStages.includes('wallet_ready') || false,
    publish: onboarding?.completedStages.includes('first_task_published') || false
  }), [activeCompany, onboarding])
  const isStageAccessible = (stage: SetupStage) => completeByStage[stage] || stage === nextVisibleStage
  const effectiveStage = useMemo<SetupStage>(() => (
    isStageAccessible(activeStage) ? activeStage : nextVisibleStage
  ), [activeStage, nextVisibleStage, completeByStage])
  const openStageDirectly = (stage: SetupStage) => {
    onStageChange(stage)
    onOpenStage(stage)
  }

  useEffect(() => {
    if (!onboarding) return
    const derivedStage = effectiveStage
    if (derivedStage !== activeStage) {
      onStageChange(derivedStage)
    }
  }, [activeStage, effectiveStage, onboarding, onStageChange])

  const steps: Array<{ key: SetupStage; title: string; complete: boolean; autoConfigured: boolean; detail: string; action: string }> = [
    {
      key: 'company',
      title: 'Company context',
      complete: Boolean(activeCompany),
      autoConfigured: Boolean(activeCompany),
      detail: activeCompany
        ? `${activeCompany.name} was created when you signed in. You can edit company details anytime.`
        : 'Tell the platform which company these settings belong to.',
      action: 'Review company setup'
    },
    {
      key: 'members',
      title: 'Team roles',
      complete: onboarding?.completedStages.includes('membership_ready') || false,
      autoConfigured: (onboarding?.completedStages.includes('membership_ready') || false) && (onboarding?.counts.activeMemberships || 0) <= 1,
      detail: onboarding?.completedStages.includes('membership_ready')
        ? `${onboarding?.counts.activeMemberships || 1} member configured. Your owner role was assigned on sign-in.`
        : 'Define who publishes bounties, provides review decisions, and executes payments.',
      action: 'Invite and assign members'
    },
    {
      key: 'repos',
      title: 'Connect repositories',
      complete: onboarding?.completedStages.includes('repo_ready') || false,
      autoConfigured: false,
      detail: onboarding?.counts.enabledRepos
        ? `${onboarding.counts.enabledRepos} repository connected. PR, CI, and review evidence is now available.`
        : 'Link a GitHub repository so that PRs, CI checks, and code reviews become verifiable evidence.',
      action: 'Connect GitHub repositories'
    },
    {
      key: 'wallets',
      title: 'Link payout wallet',
      complete: onboarding?.completedStages.includes('wallet_ready') || false,
      autoConfigured: false,
      detail: onboarding?.counts.activeWallets
        ? 'Payout wallet is active. The platform can execute settlements.'
        : 'Without a linked wallet, completed tasks will stall before payment.',
      action: 'Link corporate wallet'
    },
    {
      key: 'publish',
      title: 'Publish first bounty',
      complete: onboarding?.completedStages.includes('first_task_published') || false,
      autoConfigured: false,
      detail: (onboarding?.counts.publishedExternalTasks || 0) > 0
        ? `${onboarding?.counts.publishedExternalTasks || 0} bounty published. The end-to-end loop is live.`
        : 'Publish your first bounty to validate the full claim-to-payout pipeline.',
      action: 'Publish first bounty'
    }
  ]

  const totalSteps = steps.length
  const completedSteps = steps.filter((s) => s.complete).length
  const manualSteps = steps.filter((s) => !s.autoConfigured)
  const manualCompleted = manualSteps.filter((s) => s.complete).length
  const progressPercent = Math.round((completedSteps / totalSteps) * 100)

  const stackSteps = [
    {
      title: 'Project Management Tool',
      complete: onboarding?.completedStages.includes('integration_ready') || false,
      detail: onboarding?.integrationChecks.meegleReady
        ? 'Meegle project management is connected. Task status can sync naturally with the project board.'
        : onboarding?.integrationChecks.githubReady
          ? 'A GitHub organization is configured. Recommended to start with a GitHub issue-driven bounty workflow.'
          : 'The platform works best with Meegle + GitHub, plus an optional documentation tool. Other tools can use manual mode for now — but users should be clearly informed of the difference.',
      action: 'Confirm PM tool and org context in the company setup step'
    },
    {
      title: 'Documentation Tool',
      complete: true,
      detail: 'Prepare a linkable reference documentation tool. Lark / Feishu or Notion both work. Slack is better for notifications than for capturing requirements.',
      action: 'Confirm documentation tool in the company setup step'
    }
  ]

  if (loading) {
    return <SkeletonCard />
  }

  return (
    <div className="space-y-5">
      <section className="hero-card rounded-[20px] p-6">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">company onboarding</span>
              {activeCompany && <span className="chip">{activeCompany.name}</span>}
              <span className="chip">{completedSteps}/{totalSteps} steps</span>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white/90">{progressPercent}% complete</span>
                <span className="subtle">{totalSteps - completedSteps} remaining</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-apple-blue transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-semibold text-white">
                {completedSteps === totalSteps ? 'Setup complete' : `Next: ${steps.find((s) => !s.complete)?.title || 'Continue setup'}`}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 subtle">
                {completedSteps === totalSteps
                  ? 'All onboarding steps are finished. Your bounty pipeline is ready.'
                  : manualCompleted === 0 && completedSteps > 0
                    ? 'Company and role were configured automatically when you signed in. Complete the remaining steps to go live.'
                    : `${manualSteps.length - manualCompleted} manual step(s) left before your bounty pipeline is fully operational.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => openStageDirectly(nextVisibleStage)}
                className="btn-primary"
              >
                Continue
              </button>
              <button onClick={onNavigateToTasks} className="btn-ghost">View task workflow</button>
            </div>
          </div>

          <div className="panel rounded-2xl p-5">
            <p className="section-title">Current Focus</p>
            <p className="mt-3 text-xl font-semibold text-white">
              {steps.find((item) => item.key === effectiveStage)?.title || 'Continue setup'}
            </p>
            <p className="mt-3 text-sm leading-6 subtle">
              {onboarding?.blockedReasons[0] || steps.find((item) => item.key === effectiveStage)?.detail}
            </p>
            <div className="mt-5 space-y-3">
              {stackSteps.map((item) => (
                <div key={item.title} className={`rounded-xl border p-4 ${item.complete ? 'border-apple-green/25 bg-apple-green/10' : 'border-white/[0.08] bg-white/[0.05]'}`}>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 subtle">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="panel rounded-2xl p-5">
          <p className="section-title">Setup Navigator</p>
          <div className="mt-4 space-y-3">
            {steps.map((item, index) => (
              <button
                key={item.key}
                onClick={() => {
                  if (!isStageAccessible(item.key)) return
                  openStageDirectly(item.key)
                }}
                disabled={!isStageAccessible(item.key)}
                className={`w-full rounded-xl border p-4 text-left ${effectiveStage === item.key ? 'border-apple-blue/30 bg-apple-blue/10' : 'border-white/[0.08] bg-white/[0.05]'} ${!isStageAccessible(item.key) ? 'cursor-not-allowed opacity-55' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      item.complete && item.autoConfigured
                        ? 'bg-apple-green text-white'
                        : item.complete
                          ? 'bg-apple-blue text-white'
                          : 'bg-white/10 text-white'
                    }`}>
                      {item.complete ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16"><path d="M4 8.5L7 11.5L12 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      ) : (
                        index + 1
                      )}
                    </div>
                    <div>
                      <p className="section-title">{`Step ${index + 1}`}</p>
                      <h3 className="mt-2 text-base font-semibold text-white">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 subtle">{item.action}</p>
                    </div>
                  </div>
                  <span className={`chip ${item.complete && item.autoConfigured ? 'border-apple-green/25 bg-apple-green/10 text-apple-green' : ''}`}>
                    {item.complete && item.autoConfigured ? 'Pre-configured' : item.complete ? 'Done' : 'Pending'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel rounded-2xl p-5">
          <p className="section-title">Step Detail</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">{steps.find((item) => item.key === effectiveStage)?.title}</h3>
          <p className="mt-3 text-sm leading-7 subtle">{steps.find((item) => item.key === effectiveStage)?.detail}</p>
          <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
            <p className="text-sm text-white">Current action</p>
            <button
              onClick={() => (effectiveStage === 'publish' ? onNavigateToPublish() : openStageDirectly(effectiveStage))}
              className="mt-2 text-left text-sm leading-6 text-apple-blue transition-colors hover:text-apple-blue"
            >
              {steps.find((item) => item.key === effectiveStage)?.action}
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
