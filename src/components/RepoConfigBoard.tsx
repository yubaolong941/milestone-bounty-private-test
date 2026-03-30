'use client'

import { useEffect, useMemo, useState } from 'react'
import { RepoConfig } from '@/lib/types'
import { useFeedback } from '@/lib/use-feedback'
import ConfirmDialog from '@/components/ConfirmDialog'

type FeedbackState =
  | { tone: 'success' | 'warning' | 'danger'; text: string }
  | null

type WizardStep = 1 | 2 | 3

export default function RepoConfigBoard() {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  const [showManualForm, setShowManualForm] = useState(false)
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [tokenRef, setTokenRef] = useState('')
  const [step, setStep] = useState<WizardStep>(1)
  const { feedback, setFeedback, dismiss } = useFeedback<{ tone: 'success' | 'warning' | 'danger'; text: string }>()
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG

  const notifySetupUpdated = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('wlfi:setup-updated'))
  }

  const load = async () => {
    const res = await fetch('/api/repo-configs')
    const data = await res.json().catch(() => [])
    setConfigs(Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    load()
  }, [])

  // Check for GitHub App callback result in URL
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const ghApp = params.get('github_app')
    if (ghApp === 'installed') {
      setFeedback({ tone: 'success', text: 'GitHub App installed. Repositories have been imported automatically.' })
      load()
      notifySetupUpdated()
    } else if (ghApp === 'error') {
      const detail = params.get('detail') || 'unknown error'
      setFeedback({ tone: 'danger', text: `GitHub App setup failed: ${detail}` })
    }
  }, [])

  const canGoNext = useMemo(() => {
    if (step === 1) return Boolean(owner.trim() && repo.trim())
    if (step === 2) return Boolean(defaultBranch.trim())
    return true
  }, [defaultBranch, owner, repo, step])

  const create = async () => {
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        owner,
        repo,
        defaultBranch,
        tokenRef: tokenRef || undefined,
        enabled: true
      })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to create repository.' })
      return
    }
    setOwner('')
    setRepo('')
    setDefaultBranch('main')
    setTokenRef('')
    setStep(1)
    setShowManualForm(false)
    setFeedback({ tone: 'success', text: `Repository ${data?.owner || owner}/${data?.repo || repo} connected.` })
    await load()
    notifySetupUpdated()
  }

  const toggleEnabled = async (c: RepoConfig) => {
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: c.id, enabled: !c.enabled })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to update repository.' })
      return
    }
    setFeedback({ tone: 'success', text: `Repository ${c.enabled ? 'disabled' : 'enabled'}.` })
    await load()
    notifySetupUpdated()
  }

  const remove = async (id: string) => {
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to delete repository.' })
      return
    }
    setFeedback({ tone: 'success', text: 'Repository configuration deleted.' })
    await load()
    notifySetupUpdated()
  }

  const testConnection = async (id: string) => {
    setTestingId(id)
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', id })
    })
    const data = await res.json().catch(() => ({}))
    setTestingId(null)
    if (!res.ok || !data?.success) {
      setFeedback({ tone: 'danger', text: data?.error || 'Connection test failed.' })
      notifySetupUpdated()
      return
    }
    setFeedback({ tone: 'success', text: data?.detail || 'Connection test passed.' })
    notifySetupUpdated()
  }

  const githubAppConnected = configs.some((c) => c.tokenRef?.startsWith('ghapp:'))

  return (
    <div className="space-y-4">
      {/* Primary: GitHub App connection */}
      <div className="panel rounded-2xl p-6">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="chip">repository setup</span>
              <span className="chip">{configs.length} connected</span>
              {githubAppConnected && <span className="chip border border-apple-green/25 bg-apple-green/10 text-apple-green">App installed</span>}
            </div>
            <div>
              <p className="section-title">Connect Repositories</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Authorize via GitHub App</h2>
              <p className="mt-2 text-sm leading-6 subtle">
                Install the tomo GitHub App on your organization to automatically import repositories. The platform will use the App installation token for all API calls — no manual PAT management required.
              </p>
            </div>

            {appSlug ? (
              <div className="space-y-3">
                <a
                  href={`https://github.com/apps/${appSlug}/installations/new`}
                  className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.39l-.01-1.37c-2.23.49-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82A7.7 7.7 0 0 1 8 4.88c.68 0 1.36.09 2 .28 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.47l-.01 2.18c0 .22.14.47.55.39A8 8 0 0 0 8 0Z" />
                  </svg>
                  {githubAppConnected ? 'Manage GitHub App' : 'Connect GitHub'}
                </a>
                <p className="text-xs subtle">
                  {githubAppConnected
                    ? 'Click to manage which repositories the App has access to.'
                    : 'You will be redirected to GitHub to select an organization and repositories.'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-apple-orange/25 bg-apple-orange/10 p-4 text-sm text-apple-orange">
                NEXT_PUBLIC_GITHUB_APP_SLUG is not configured. Set it in your environment to enable GitHub App integration.
              </div>
            )}
          </div>

          {/* Right side — how it works */}
          <div className="space-y-3">
            <p className="section-title">How it works</p>
            {[
              ['1', 'Install the App', 'Select your GitHub organization and choose which repositories to authorize.'],
              ['2', 'Auto-import', 'Authorized repositories are automatically added to your company configuration.'],
              ['3', 'Managed tokens', 'The platform uses GitHub App installation tokens — no PAT rotation needed.']
            ].map(([num, title, desc]) => (
              <div key={title} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-apple-blue/15 text-xs font-semibold text-apple-blue">{num}</div>
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-1 text-xs leading-5 subtle">{desc}</p>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setShowManualForm(!showManualForm)}
              className="mt-2 text-xs text-apple-blue transition-colors hover:text-white"
            >
              {showManualForm ? 'Hide manual form' : 'Or add a repository manually'}
            </button>
          </div>
        </div>
      </div>

      {/* Manual fallback form (collapsed by default) */}
      {showManualForm && (
        <div className="panel rounded-2xl p-6 overlay-enter">
          <p className="section-title">Manual Repository Setup</p>
          <p className="mt-1 text-sm subtle">Add a repository by entering owner and repo name directly.</p>
          <div className="mt-4 space-y-4">
            {step === 1 && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="field-owner" className="label">Owner</label>
                  <input id="field-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" className="input mt-2" />
                </div>
                <div>
                  <label htmlFor="field-repo" className="label">Repo</label>
                  <input id="field-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" className="input mt-2" />
                </div>
              </div>
            )}
            {step === 2 && (
              <div>
                <label htmlFor="field-default-branch" className="label">Default Branch</label>
                <input id="field-default-branch" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="default branch" className="input mt-2" />
              </div>
            )}
            {step === 3 && (
              <div>
                <label htmlFor="field-token-ref" className="label">Token Ref</label>
                <input id="field-token-ref" value={tokenRef} onChange={(e) => setTokenRef(e.target.value)} placeholder="tokenRef (optional, e.g. ghapp:12345678)" className="input mt-2" />
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {step > 1 && <button onClick={() => setStep((prev) => (prev === 3 ? 2 : 1))} className="btn-ghost">Back</button>}
              {step < 3 ? (
                <button onClick={() => setStep((prev) => (prev === 1 ? 2 : 3))} className="btn-primary" disabled={!canGoNext}>Next</button>
              ) : (
                <button onClick={create} className="btn-primary" disabled={!canGoNext}>Add Repository</button>
              )}
              <button onClick={() => setShowManualForm(false)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div aria-live="polite" role="status" className={`feedback-banner feedback-${feedback.tone}`}>
          <div className="text-sm text-white">{feedback.text}</div>
          <button onClick={dismiss} className="btn-ghost px-4 py-2 text-xs">Dismiss</button>
        </div>
      )}

      {/* Connected repos list */}
      <div className="space-y-3">
        {configs.length === 0 ? (
          <div className="panel rounded-2xl p-8 text-center subtle">No repositories connected yet. Use the GitHub App button above to get started.</div>
        ) : configs.map((c) => (
          <div key={c.id} className="panel rounded-2xl p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-white">{c.owner}/{c.repo}</p>
                  {c.tokenRef?.startsWith('ghapp:') && (
                    <span className="rounded-full border border-apple-blue/20 bg-apple-blue/10 px-2 py-0.5 text-[0.625rem] font-medium text-apple-blue">App</span>
                  )}
                </div>
                <p className="mt-1.5 text-sm subtle">
                  Branch: {c.defaultBranch}
                  {c.tokenRef && !c.tokenRef.startsWith('ghapp:') ? ` | Token: ${c.tokenRef}` : ''}
                  {' | '}{c.enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => testConnection(c.id)} className="btn-secondary" disabled={testingId === c.id}>
                  {testingId === c.id ? 'Testing...' : 'Test'}
                </button>
                <button onClick={() => toggleEnabled(c)} className="btn-ghost">{c.enabled ? 'Disable' : 'Enable'}</button>
                <button onClick={() => setDeleteTarget(c.id)} className="btn-ghost">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete repository"
        message="This will permanently remove this repository configuration."
        confirmLabel="Delete"
        onConfirm={() => { remove(deleteTarget!); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
