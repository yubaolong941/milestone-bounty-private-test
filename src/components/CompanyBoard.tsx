'use client'

import { useEffect, useMemo, useState } from 'react'
import { Company, DocumentationTool, ProjectManagementTool } from '@/lib/types'
import { useFeedback } from '@/lib/use-feedback'

type FeedbackState =
  | { tone: 'success' | 'warning' | 'danger'; text: string }
  | null

type WizardStep = 1 | 2 | 3
type CompanyDraft = Partial<Company>

interface AuthMeResponse {
  session?: {
    activeCompanyId?: string
  }
  companyContext?: {
    company?: Company
  }
}

interface MeegleWebhookConfigResponse {
  success?: boolean
  webhookUrl?: string
}

interface ToolOption<T extends string> {
  value: T
  label: string
  hint: string
  disabled?: boolean
  iconUrl?: string
  mono?: string
}

const PM_OPTIONS: Array<ToolOption<ProjectManagementTool>> = [
  { value: 'meegle', label: 'Meegle', hint: 'Smoothest experience. Supports task sync and status write-back.', mono: 'M' },
  { value: 'github_projects', label: 'GitHub Projects', hint: 'Best for issue and PR-centric management.', iconUrl: 'https://cdn.simpleicons.org/github/ffffff' },
  { value: 'jira', label: 'Jira', hint: 'Coming soon...', disabled: true, iconUrl: 'https://cdn.simpleicons.org/jira/ffffff' },
  { value: 'linear', label: 'Linear', hint: 'Coming soon...', disabled: true, iconUrl: 'https://cdn.simpleicons.org/linear/ffffff' }
]

const DOC_OPTIONS: Array<ToolOption<DocumentationTool>> = [
  { value: 'lark', label: 'Lark / Feishu', hint: 'Good for reference docs and notes. Not a hard process dependency.', mono: 'L' },
  { value: 'slack', label: 'Slack', hint: 'Better suited for notifications. Add at least one formal requirements doc.', iconUrl: 'https://cdn.simpleicons.org/slack/ffffff' },
  { value: 'notion', label: 'Notion', hint: 'Good for documentation. Manual link sync recommended for now.', iconUrl: 'https://cdn.simpleicons.org/notion/ffffff' },
  { value: 'other', label: 'Other', hint: 'Record the tool name and decide the integration approach later.', mono: 'O' }
]

function ToolBadge({ option }: { option: ToolOption<string> }) {
  if (option.iconUrl) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.05]">
        <img src={option.iconUrl} alt={`${option.label} icon`} className="h-4 w-4 opacity-90" />
      </span>
    )
  }
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.05] text-xs font-semibold text-white/90">
      {option.mono || option.label.slice(0, 1).toUpperCase()}
    </span>
  )
}

function emptyDraft(): CompanyDraft {
  return {
    name: '',
    description: '',
    githubOrgLogin: '',
    projectManagementTool: 'meegle',
    projectManagementToolLabel: '',
    meegleWorkspaceId: '',
    meegleProjectKey: '',
    meegleViewUrl: '',
    meegleMcpToken: '',
    documentationTool: 'lark',
    documentationToolLabel: '',
    websiteUrl: '',
    contactEmail: ''
  }
}

function draftFromCompany(company: Partial<Company>): CompanyDraft {
  return {
    name: company.name || '',
    description: company.description || '',
    githubOrgLogin: company.githubOrgLogin || '',
    projectManagementTool: company.projectManagementTool || 'meegle',
    projectManagementToolLabel: company.projectManagementToolLabel || '',
    meegleWorkspaceId: company.meegleWorkspaceId || '',
    meegleProjectKey: company.meegleProjectKey || '',
    meegleViewUrl: company.meegleViewUrl || '',
    meegleMcpToken: company.meegleMcpToken || '',
    documentationTool: company.documentationTool || 'lark',
    documentationToolLabel: company.documentationToolLabel || '',
    websiteUrl: company.websiteUrl || '',
    contactEmail: company.contactEmail || ''
  }
}

export default function CompanyBoard() {
  const [items, setItems] = useState<Company[]>([])
  const [step, setStep] = useState<WizardStep>(1)
  const [draft, setDraft] = useState<CompanyDraft>(emptyDraft())
  const [activeCompanyId, setActiveCompanyId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, CompanyDraft>>({})
  const { feedback, setFeedback, dismiss } = useFeedback<{ tone: 'success' | 'warning' | 'danger'; text: string }>()
  const [submitting, setSubmitting] = useState(false)
  const [scopedMeegleWebhookUrl, setScopedMeegleWebhookUrl] = useState('')

  const load = async () => {
    const [companiesRes, meRes] = await Promise.all([
      fetch('/api/companies').catch(() => null),
      fetch('/api/auth/me').catch(() => null)
    ])
    const [companiesData, meData] = await Promise.all([
      companiesRes ? companiesRes.json().catch(() => []) : Promise.resolve([]),
      meRes ? meRes.json().catch(() => ({})) : Promise.resolve({})
    ])
    const companies = Array.isArray(companiesData) ? companiesData as Company[] : []
    setItems(companies)

    const me = meData as AuthMeResponse
    const nextActiveCompanyId = me.session?.activeCompanyId || me.companyContext?.company?.id || ''
    setActiveCompanyId(nextActiveCompanyId)

    const activeCompany = companies.find((item) => item.id === nextActiveCompanyId) || me.companyContext?.company
    setDraft(activeCompany ? draftFromCompany(activeCompany) : emptyDraft())
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!activeCompanyId) {
      setScopedMeegleWebhookUrl('')
      return
    }
    fetch(`/api/integrations/meegle/webhook-config?companyId=${encodeURIComponent(activeCompanyId)}`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => setScopedMeegleWebhookUrl((data as MeegleWebhookConfigResponse)?.webhookUrl || ''))
      .catch(() => setScopedMeegleWebhookUrl(''))
  }, [activeCompanyId])

  const canGoNext = useMemo(() => {
    if (step === 1) return Boolean(String(draft.name || '').trim())
    if (step === 2) {
      if (!draft.projectManagementTool || !draft.documentationTool) return false
      if (draft.projectManagementTool === 'meegle') {
        return Boolean(
          String(draft.meegleViewUrl || '').trim()
          || (String(draft.meegleWorkspaceId || '').trim() && String(draft.meegleProjectKey || '').trim())
        )
      }
      return true
    }
    return true
  }, [draft, step])

  const nextStepBlocker = useMemo(() => {
    if (step === 1 && !String(draft.name || '').trim()) {
      return 'Please enter the company name first.'
    }
    if (step === 2) {
      if (!draft.projectManagementTool) return 'Please select a project management tool.'
      if (!draft.documentationTool) return 'Please select a documentation tool.'
      if (draft.projectManagementTool === 'meegle') {
        if (
          !String(draft.meegleViewUrl || '').trim()
          && !String(draft.meegleWorkspaceId || '').trim()
          && !String(draft.meegleProjectKey || '').trim()
        ) {
          return 'You selected Meegle. Please provide a Meegle View URL, or at least a Workspace ID and Project Key.'
        }
        if (!String(draft.meegleViewUrl || '').trim()) {
          if (!String(draft.meegleWorkspaceId || '').trim()) {
            return 'Meegle Workspace ID is required.'
          }
          if (!String(draft.meegleProjectKey || '').trim()) {
            return 'Meegle Project Key is required.'
          }
        }
      }
    }
    return ''
  }, [draft, step])

  const create = async () => {
    setSubmitting(true)
    const payload = {
      name: String(draft.name || '').trim(),
      description: draft.description || undefined,
      githubOrgLogin: draft.githubOrgLogin || undefined,
      projectManagementTool: draft.projectManagementTool || undefined,
      projectManagementToolLabel: draft.projectManagementTool === 'other' ? draft.projectManagementToolLabel || undefined : undefined,
      meegleWorkspaceId: draft.projectManagementTool === 'meegle' ? draft.meegleWorkspaceId || undefined : undefined,
      meegleProjectKey: draft.projectManagementTool === 'meegle' ? draft.meegleProjectKey || undefined : undefined,
      meegleViewUrl: draft.projectManagementTool === 'meegle' ? draft.meegleViewUrl || undefined : undefined,
      meegleMcpToken: draft.projectManagementTool === 'meegle' ? draft.meegleMcpToken || undefined : undefined,
      documentationTool: draft.documentationTool || undefined,
      documentationToolLabel: draft.documentationTool === 'other' ? draft.documentationToolLabel || undefined : undefined,
      websiteUrl: draft.websiteUrl || undefined,
      contactEmail: draft.contactEmail || undefined
    }
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activeCompanyId
        ? { action: 'update', id: activeCompanyId, ...payload }
        : { action: 'create', ...payload })
    })
    const data = await res.json().catch(() => ({}))
    setSubmitting(false)

    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || `Failed to ${activeCompanyId ? 'update' : 'create'} company.` })
      return
    }

    setFeedback({
      tone: 'success',
      text: activeCompanyId
        ? `Company "${data?.company?.name || draft.name}" updated. Continue configuring members, repositories, and wallets.`
        : `Company "${data?.company?.name || draft.name}" created. Next, configure members, repositories, and wallets.`
    })
    setStep(1)
    await load()
  }

  const switchActive = async (id: string) => {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switchActiveCompany', id })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to switch company.' })
      return
    }
    window.location.reload()
  }

  const startEdit = (item: Company) => {
    setEditingId(item.id)
    setDrafts((prev) => ({
      ...prev,
      [item.id]: {
        name: item.name,
        description: item.description || '',
        githubOrgLogin: item.githubOrgLogin || '',
        projectManagementTool: item.projectManagementTool || 'meegle',
        projectManagementToolLabel: item.projectManagementToolLabel || '',
        meegleWorkspaceId: item.meegleWorkspaceId || '',
        meegleProjectKey: item.meegleProjectKey || '',
        meegleViewUrl: item.meegleViewUrl || '',
        meegleMcpToken: item.meegleMcpToken || '',
        documentationTool: item.documentationTool || 'lark',
        documentationToolLabel: item.documentationToolLabel || '',
        websiteUrl: item.websiteUrl || '',
        contactEmail: item.contactEmail || ''
      }
    }))
  }

  const save = async (id: string) => {
    const current = drafts[id] || {}
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, ...current })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to update company.' })
      return
    }
    setEditingId(null)
    setFeedback({ tone: 'success', text: `Company "${data?.company?.name || ''}" updated successfully.` })
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="panel rounded-[1.7rem] p-6">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="chip">company wizard</span>
              <span className="chip">step {step}/3</span>
              <span className="chip">{items.length} companies</span>
            </div>
            <div>
              <p className="section-title">Company Setup</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Company onboarding as a structured step-by-step flow</h2>
              <p className="mt-2 text-sm leading-6 subtle">
                Start by creating the company entity, then select your project management and documentation tools, and finally confirm the code and payment prerequisites for external bounties so you are never overwhelmed by scattered fields up front.
              </p>
            </div>
            <div className="space-y-3">
              {[
                ['1', 'Basic Info', 'Company identity, GitHub organization, and contact details.'],
                ['2', 'Collaboration Stack', 'Project management and documentation tools (Meegle/GitHub Projects, plus Lark/Notion/Slack).'],
                ['3', 'Launch Readiness', 'Confirm this company is ready for bounty publishing and settlement.']
              ].map(([num, title, desc], index) => (
                <div
                  key={title}
                  className={`rounded-xl border p-4 ${
                    step === index + 1
                      ? 'border-apple-blue/30 bg-apple-blue/10'
                      : 'border-white/[0.08] bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                        step > index
                          ? 'bg-white text-slate-950'
                          : step === index + 1
                            ? 'bg-apple-blue text-white'
                            : 'bg-white/10 text-white'
                      }`}
                    >
                      {num}
                    </div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 subtle">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="command-card space-y-4">
            {step === 1 && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="field-company-name" className="label">Company Name</label>
                    <input id="field-company-name" className="input mt-2" value={String(draft.name || '')} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Company name" />
                  </div>
                  <div>
                    <label htmlFor="field-github-org" className="label">GitHub Org</label>
                    <input id="field-github-org" className="input mt-2" value={String(draft.githubOrgLogin || '')} onChange={(e) => setDraft((prev) => ({ ...prev, githubOrgLogin: e.target.value }))} placeholder="GitHub Org Login (optional)" />
                  </div>
                  <div>
                    <label htmlFor="field-website" className="label">Website</label>
                    <input id="field-website" className="input mt-2" value={String(draft.websiteUrl || '')} onChange={(e) => setDraft((prev) => ({ ...prev, websiteUrl: e.target.value }))} placeholder="Website (optional)" />
                  </div>
                  <div>
                    <label htmlFor="field-contact-email" className="label">Contact Email</label>
                    <input id="field-contact-email" className="input mt-2" value={String(draft.contactEmail || '')} onChange={(e) => setDraft((prev) => ({ ...prev, contactEmail: e.target.value }))} placeholder="Contact email (optional)" />
                  </div>
                </div>
                <div>
                  <label htmlFor="field-description" className="label">Description</label>
                  <textarea id="field-description" className="textarea mt-2" rows={4} value={String(draft.description || '')} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} placeholder="Describe how this company will use the platform, e.g. code bounties, security bug bounties, or milestone delivery." />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <label id="label-pm-tool" className="label">Project Management Tool</label>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {PM_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={option.disabled}
                        onClick={() => {
                          if (option.disabled) return
                          setDraft((prev) => ({ ...prev, projectManagementTool: option.value }))
                        }}
                        className={`rounded-xl border p-4 text-left ${draft.projectManagementTool === option.value ? 'border-apple-blue/30 bg-apple-blue/10' : 'border-white/[0.08] bg-white/[0.05]'} ${option.disabled ? 'cursor-not-allowed opacity-55' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <ToolBadge option={option} />
                          <p className="text-sm font-semibold text-white">{option.label}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 subtle">{option.hint}</p>
                      </button>
                    ))}
                  </div>
                  {draft.projectManagementTool === 'meegle' && (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-apple-blue/20 bg-apple-blue/8 p-4">
                        <p className="text-sm font-semibold text-white">Meegle webhook</p>
                        <p className="mt-2 text-sm leading-6 subtle">
                          {activeCompanyId
                            ? 'Configure the following company-scoped webhook URL in Meegle so task updates can sync back into the platform.'
                            : 'The final webhook URL must carry a companyId so incoming events can be mapped to the correct company. Save the company first, then copy the generated URL here.'}
                        </p>
                        {activeCompanyId ? (
                          <p className="mt-3 break-all text-sm text-apple-blue">
                            {scopedMeegleWebhookUrl}
                          </p>
                        ) : (
                          <p className="mt-3 break-all text-sm text-white/70">
                            {'/api/integrations/meegle/webhook?companyId=<save-company-first>&secret=<configured-webhook-secret>'}
                          </p>
                        )}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input className="input md:col-span-2" value={String(draft.meegleViewUrl || '')} onChange={(e) => setDraft((prev) => ({ ...prev, meegleViewUrl: e.target.value }))} placeholder="Meegle View URL (recommended, e.g. https://meegle.com/.../storyView/...)" />
                        <input className="input" value={String(draft.meegleWorkspaceId || '')} onChange={(e) => setDraft((prev) => ({ ...prev, meegleWorkspaceId: e.target.value }))} placeholder="Meegle Workspace ID" />
                        <input className="input" value={String(draft.meegleProjectKey || '')} onChange={(e) => setDraft((prev) => ({ ...prev, meegleProjectKey: e.target.value }))} placeholder="Meegle Project Key / View Key (compatible)" />
                        <input className="input md:col-span-2" type="password" value={String(draft.meegleMcpToken || '')} onChange={(e) => setDraft((prev) => ({ ...prev, meegleMcpToken: e.target.value }))} placeholder="Meegle MCP Token for this company" />
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label id="label-doc-tool" className="label">Documentation Tool</label>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {DOC_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, documentationTool: option.value }))}
                        className={`rounded-xl border p-4 text-left ${draft.documentationTool === option.value ? 'border-apple-blue/30 bg-apple-blue/10' : 'border-white/[0.08] bg-white/[0.05]'}`}
                      >
                        <div className="flex items-center gap-3">
                          <ToolBadge option={option} />
                          <p className="text-sm font-semibold text-white">{option.label}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 subtle">{option.hint}</p>
                      </button>
                    ))}
                  </div>
                  {draft.documentationTool === 'other' && (
                    <input className="input mt-3" value={String(draft.documentationToolLabel || '')} onChange={(e) => setDraft((prev) => ({ ...prev, documentationToolLabel: e.target.value }))} placeholder="Enter documentation tool name" />
                  )}
                </div>
              </>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                  <p className="section-title">Launch Summary</p>
                  <div className="mt-3 space-y-2 text-sm subtle">
                    <p>Company: {draft.name || '(not set)'}</p>
                    <p>Code: GitHub {draft.githubOrgLogin ? `(${draft.githubOrgLogin})` : '(not set)'}</p>
                    <p>Project mgmt: {draft.projectManagementTool || '(not selected)'}</p>
                    <p>Docs: {draft.documentationTool || '(not selected)'}{draft.documentationTool === 'other' && draft.documentationToolLabel ? ` · ${draft.documentationToolLabel}` : ''}</p>
                    <p>Meegle: {draft.projectManagementTool === 'meegle' ? `${draft.meegleViewUrl || '-'}${draft.meegleViewUrl ? '' : ` | ${draft.meegleWorkspaceId || '-'} / ${draft.meegleProjectKey || '-'}`}` : 'Not used'}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-apple-orange/25 bg-apple-orange/10 p-4">
                  <p className="text-sm font-semibold text-white">Recommended next steps after creating the company</p>
                  <div className="mt-3 space-y-2 text-sm subtle">
                    <p>1. Invite members in the maintainer, reviewer, and finance roles.</p>
                    <p>2. Connect at least one GitHub repository so PR/CI becomes verifiable evidence.</p>
                    <p>3. Link a corporate wallet — without it, bounties will be stuck in a publishable but unpayable state.</p>
                  </div>
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
                  {submitting ? (activeCompanyId ? 'Saving...' : 'Creating...') : (activeCompanyId ? 'Save Company' : 'Create Company')}
                </button>
              )}
            </div>
            {!canGoNext && nextStepBlocker && (
              <div className="rounded-[10px] border border-apple-orange/25 bg-apple-orange/10 p-3 text-sm text-apple-orange/90">
                {nextStepBlocker}
              </div>
            )}
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
            {editingId === item.id ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <input className="input" value={String(drafts[item.id]?.name || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], name: e.target.value } }))} placeholder="Company name" />
                  <input className="input" value={String(drafts[item.id]?.githubOrgLogin || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], githubOrgLogin: e.target.value } }))} placeholder="GitHub Org Login" />
                  <select className="select" value={String(drafts[item.id]?.projectManagementTool || 'meegle')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], projectManagementTool: e.target.value as ProjectManagementTool } }))}>
                    {PM_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                  </select>
                  <select className="select" value={String(drafts[item.id]?.documentationTool || 'lark')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], documentationTool: e.target.value as DocumentationTool } }))}>
                    {DOC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input className="input md:col-span-2" value={String(drafts[item.id]?.meegleViewUrl || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], meegleViewUrl: e.target.value } }))} placeholder="Meegle View URL (recommended)" />
                  <input className="input" value={String(drafts[item.id]?.meegleWorkspaceId || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], meegleWorkspaceId: e.target.value } }))} placeholder="Meegle Workspace ID" />
                  <input className="input" value={String(drafts[item.id]?.meegleProjectKey || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], meegleProjectKey: e.target.value } }))} placeholder="Meegle Project Key / View Key (compatible)" />
                  <input className="input md:col-span-2" type="password" value={String(drafts[item.id]?.meegleMcpToken || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], meegleMcpToken: e.target.value } }))} placeholder="Meegle MCP Token for this company" />
                  <input className="input" value={String(drafts[item.id]?.websiteUrl || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], websiteUrl: e.target.value } }))} placeholder="Website" />
                  <input className="input" value={String(drafts[item.id]?.contactEmail || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], contactEmail: e.target.value } }))} placeholder="Contact email" />
                </div>
                <textarea className="textarea" value={String(drafts[item.id]?.description || '')} onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], description: e.target.value } }))} placeholder="Company description" />
                <div className="flex gap-3">
                  <button onClick={() => save(item.id)} className="btn-primary">Save Configuration</button>
                  <button onClick={() => setEditingId(null)} className="btn-ghost">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-semibold text-white">{item.name}</p>
                    <span className="chip">{item.status}</span>
                  </div>
                  <p className="mt-1 text-sm subtle">{item.slug}</p>
                  {item.description && <p className="mt-2 text-sm subtle">{item.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.githubOrgLogin && <span className="chip">GitHub {item.githubOrgLogin}</span>}
                    {item.projectManagementTool && <span className="chip">PM {item.projectManagementTool}{item.projectManagementToolLabel ? ` · ${item.projectManagementToolLabel}` : ''}</span>}
                    {item.documentationTool && <span className="chip">Doc {item.documentationTool}{item.documentationToolLabel ? ` · ${item.documentationToolLabel}` : ''}</span>}
                    {item.meegleViewUrl && <span className="chip">Meegle View URL</span>}
                    {item.meegleWorkspaceId && <span className="chip">Meegle WS {item.meegleWorkspaceId}</span>}
                    {item.meegleProjectKey && <span className="chip">Meegle Project {item.meegleProjectKey}</span>}
                    {item.contactEmail && <span className="chip">{item.contactEmail}</span>}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => startEdit(item)} className="btn-secondary">Edit Config</button>
                  <button onClick={() => switchActive(item.id)} className="btn-ghost">Switch to this company</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
