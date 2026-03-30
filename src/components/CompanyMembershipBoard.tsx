'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFeedback } from '@/lib/use-feedback'

interface Membership {
  id: string
  userId: string
  role: string
  status: string
  githubLogin?: string
  walletAddress?: string
}

type FeedbackState =
  | { tone: 'success' | 'warning' | 'danger'; text: string }
  | null

type WizardStep = 1 | 2 | 3

const ROLE_OPTIONS = [
  ['company_maintainer', 'Maintainer', 'Responsible for publishing tasks, maintaining requirements, and driving delivery.'],
  ['company_reviewer', 'Reviewer', 'Responsible for manual review, acceptance, and approval decisions.'],
  ['company_finance', 'Finance', 'Responsible for payment approval, retries, and reconciliation.'],
  ['company_admin', 'Admin', 'Responsible for company configuration and member management.'],
  ['company_viewer', 'Viewer', 'Read-only access. Not involved in critical actions.']
] as const

export default function CompanyMembershipBoard() {
  const [items, setItems] = useState<Membership[]>([])
  const [userId, setUserId] = useState('')
  const [githubLogin, setGithubLogin] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [role, setRole] = useState('company_viewer')
  const [step, setStep] = useState<WizardStep>(1)
  const [submitting, setSubmitting] = useState(false)
  const { feedback, setFeedback, dismiss } = useFeedback<{ tone: 'success' | 'warning' | 'danger'; text: string }>()

  const load = async () => {
    const res = await fetch('/api/company-memberships')
    const data = await res.json().catch(() => [])
    setItems(Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    load()
  }, [])

  const hasAtLeastOneMember = items.length > 0

  const canGoNext = useMemo(() => {
    if (step === 1) return hasAtLeastOneMember || Boolean(userId.trim())
    if (step === 2) return Boolean(role)
    return true
  }, [hasAtLeastOneMember, role, step, userId])

  const create = async () => {
    setSubmitting(true)
    const res = await fetch('/api/company-memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', userId, githubLogin, walletAddress, role })
    })
    const data = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to invite member.' })
      return
    }
    setUserId('')
    setGithubLogin('')
    setWalletAddress('')
    setRole('company_viewer')
    setStep(1)
    setFeedback({ tone: 'success', text: `Member "${userId}" has been invited. Consider also adding reviewer and finance roles.` })
    await load()
  }

  const updateRole = async (id: string, nextRole: string) => {
    const res = await fetch('/api/company-memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateRole', id, role: nextRole })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to update role.' })
      return
    }
    setFeedback({ tone: 'success', text: 'Member role updated.' })
    await load()
  }

  const disable = async (id: string) => {
    const res = await fetch('/api/company-memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', id })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to disable member.' })
      return
    }
    setFeedback({ tone: 'success', text: 'Member disabled.' })
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="panel rounded-[1.7rem] p-6">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="chip">member wizard</span>
              <span className="chip">step {step}/3</span>
              <span className="chip">{items.length} members</span>
            </div>
            <div>
              <p className="section-title">Team Setup</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Define who publishes, reviews, and approves payment</h2>
              <p className="mt-2 text-sm leading-6 subtle">
                Without clear role assignments, the bounty workflow gets stuck in a state where everyone can view but nobody owns the next step. This wizard helps you establish clear ownership first.
              </p>
            </div>
            <div className="space-y-3">
              {[
                ['1', 'Member Identity', hasAtLeastOneMember ? 'This company already has members. You may proceed to the next step.' : 'Specify who to invite into the company context.'],
                ['2', 'Role Assignment', 'Choose whether they handle publishing, review, payment, or view-only access.'],
                ['3', 'Identity Binding', 'Optionally add GitHub and wallet information for later mapping.']
              ].map(([num, title, desc], index) => (
                <div key={title} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${step > index ? 'bg-white text-slate-950' : 'bg-white/10 text-white'}`}>{num}</div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 subtle">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="command-card space-y-4">
            {step === 1 && (
              <div>
                <label htmlFor="field-work-email" className="label">Work Email</label>
                <input id="field-work-email" className="input mt-2" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. name@company.com" />
                {hasAtLeastOneMember && (
                  <p className="mt-2 text-xs subtle">This company already has members. You can proceed to the next step without adding a new one.</p>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3">
                {ROLE_OPTIONS.map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRole(value)}
                    className={`rounded-xl border p-4 text-left ${role === value ? 'border-apple-blue/30 bg-apple-blue/10' : 'border-white/[0.08] bg-white/[0.05]'}`}
                  >
                    <p className="text-sm font-semibold text-white">{label}</p>
                    <p className="mt-2 text-sm leading-6 subtle">{hint}</p>
                  </button>
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="field-github-login" className="label">GitHub Login</label>
                  <input id="field-github-login" className="input mt-2" value={githubLogin} onChange={(e) => setGithubLogin(e.target.value)} placeholder="GitHub Login (optional)" />
                </div>
                <div>
                  <label htmlFor="field-wallet-address" className="label">Wallet Address</label>
                  <input id="field-wallet-address" className="input mt-2" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="Wallet address (optional)" />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {step > 1 && <button onClick={() => setStep((prev) => (prev === 3 ? 2 : 1))} className="btn-ghost">Back</button>}
              {step < 3 ? (
                <button onClick={() => setStep((prev) => (prev === 1 ? 2 : 3))} className="btn-primary" disabled={!canGoNext}>
                  Next
                </button>
              ) : (
                <button onClick={create} className="btn-primary" disabled={submitting || !canGoNext}>
                  {submitting ? 'Inviting...' : 'Invite Member'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div aria-live="polite" role="status" className={`feedback-banner feedback-${feedback.tone}`}>
          <div className="text-sm text-white">{feedback.text}</div>
          <button onClick={dismiss} className="btn-ghost px-4 py-2 text-xs">Dismiss</button>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="panel rounded-2xl p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold">{item.userId}</p>
                  <span className="chip">{item.role}</span>
                  <span className="chip">{item.status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.githubLogin && <span className="chip">@{item.githubLogin}</span>}
                  {item.walletAddress && <span className="chip">{item.walletAddress}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <select className="select min-w-[220px]" value={item.role} onChange={(e) => updateRole(item.id, e.target.value)}>
                  {ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {item.status !== 'disabled' && <button onClick={() => disable(item.id)} className="btn-ghost">Disable</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
