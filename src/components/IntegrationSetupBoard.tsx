'use client'

import { useEffect, useMemo, useState } from 'react'

interface Company {
  id: string
  name: string
  slug: string
  githubOrgLogin?: string
  meegleWorkspaceId?: string
  meegleProjectKey?: string
  meegleViewUrl?: string
  meegleMcpToken?: string
  defaultRepoConfigId?: string
  contactEmail?: string
  larkWebhookUrl?: string
  larkWebhookSecret?: string
  larkDefaultReceiveId?: string
  onboarding?: {
    integrationChecks?: {
      githubReady: boolean
      meegleReady: boolean
      larkReady: boolean
      githubHealth?: 'ok' | 'degraded' | 'stale' | 'unknown' | 'missing'
      meegleHealth?: 'ok' | 'degraded' | 'stale' | 'unknown' | 'missing'
      larkHealth?: 'ok' | 'degraded' | 'stale' | 'unknown' | 'missing'
      githubDetail?: string
      meegleDetail?: string
      larkDetail?: string
    }
  }
}

interface RepoConfig {
  id: string
  owner: string
  repo: string
  defaultBranch: string
  enabled: boolean
}

interface SessionPayload {
  session?: {
    activeCompanyId?: string
  }
}

interface LarkNotifyStatus {
  configured?: boolean
  mode?: string
  callbackSecretConfigured?: boolean
  defaultReceiveIdConfigured?: boolean
}

interface ConnectivityResponse {
  success?: boolean
  connectivity?: {
    overallReady: boolean
    github: { ready: boolean; health: string; detail: string }
    meegle: { ready: boolean; health: string; detail: string }
    lark: { ready: boolean; health: string; detail: string }
  }
}

interface MeegleWebhookConfigResponse {
  success?: boolean
  webhookUrl?: string
}

const HEALTH_TONE: Record<string, string> = {
  ok: 'border-apple-green/25 bg-apple-green/10 text-apple-green',
  degraded: 'border-apple-red/25 bg-apple-red/10 text-apple-red',
  stale: 'border-apple-orange/25 bg-apple-orange/10 text-apple-orange',
  unknown: 'border-white/[0.08] bg-white/[0.05] text-white',
  missing: 'border-white/[0.08] bg-white/[0.05] text-white'
}

export default function IntegrationSetupBoard() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [repoConfigs, setRepoConfigs] = useState<RepoConfig[]>([])
  const [activeCompanyId, setActiveCompanyId] = useState('')
  const [form, setForm] = useState({
    githubOrgLogin: '',
    meegleWorkspaceId: '',
    meegleProjectKey: '',
    meegleViewUrl: '',
    meegleMcpToken: '',
    defaultRepoConfigId: '',
    contactEmail: '',
    larkWebhookUrl: '',
    larkWebhookSecret: '',
    larkDefaultReceiveId: ''
  })
  const [larkReceiveId, setLarkReceiveId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [larkStatus, setLarkStatus] = useState<LarkNotifyStatus | null>(null)
  const [connectivity, setConnectivity] = useState<ConnectivityResponse | null>(null)
  const [installationId, setInstallationId] = useState('')
  const [ghAppRepos, setGhAppRepos] = useState<Array<{ owner: string; repo: string; defaultBranch?: string }>>([])
  const [ghAppLoading, setGhAppLoading] = useState(false)
  const [ghAppError, setGhAppError] = useState('')
  const [meegleWebhookUrl, setMeegleWebhookUrl] = useState('')

  const load = async (companyIdOverride?: string) => {
    const [companiesRes, repoConfigsRes, meRes, larkStatusRes] = await Promise.all([
      fetch('/api/companies'),
      fetch('/api/repo-configs'),
      fetch('/api/auth/me').catch(() => null),
      fetch('/api/integrations/lark/notify').catch(() => null)
    ])
    const [companiesData, repoConfigsData, meData, larkStatusData] = await Promise.all([
      companiesRes.json().catch(() => []),
      repoConfigsRes.json().catch(() => []),
      meRes ? meRes.json().catch(() => ({})) : Promise.resolve({}),
      larkStatusRes ? larkStatusRes.json().catch(() => ({})) : Promise.resolve({})
    ])

    const nextCompanies: Company[] = Array.isArray(companiesData) ? companiesData : []
    const nextRepoConfigs: RepoConfig[] = Array.isArray(repoConfigsData) ? repoConfigsData : []
    const nextActiveCompanyId = (meData as SessionPayload)?.session?.activeCompanyId || nextCompanies[0]?.id || ''

    setCompanies(nextCompanies)
    setRepoConfigs(nextRepoConfigs)
    setActiveCompanyId(nextActiveCompanyId)
    setLarkStatus(larkStatusData as LarkNotifyStatus)

    const targetCompanyId = companyIdOverride || nextActiveCompanyId
    if (targetCompanyId) {
      const connectivityRes = await fetch(`/api/integrations/connectivity?companyId=${targetCompanyId}`).catch(() => null)
      const connectivityData = connectivityRes ? await connectivityRes.json().catch(() => ({})) : {}
      setConnectivity(connectivityData as ConnectivityResponse)
    } else {
      setConnectivity(null)
    }
  }

  useEffect(() => {
    load()
    try {
      const u = new URL(window.location.href)
      const ins = u.searchParams.get('installationId') || ''
      if (ins) setInstallationId(ins)
    } catch {}
  }, [])

  const activeCompany = useMemo(
    () => companies.find((item) => item.id === activeCompanyId) || null,
    [companies, activeCompanyId]
  )

  useEffect(() => {
    if (!activeCompanyId) {
      setMeegleWebhookUrl('')
      return
    }
    fetch(`/api/integrations/meegle/webhook-config?companyId=${encodeURIComponent(activeCompanyId)}`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => setMeegleWebhookUrl((data as MeegleWebhookConfigResponse)?.webhookUrl || ''))
      .catch(() => setMeegleWebhookUrl(''))
  }, [activeCompanyId])

  useEffect(() => {
    if (!activeCompany) return
    setForm({
      githubOrgLogin: activeCompany.githubOrgLogin || '',
      meegleWorkspaceId: activeCompany.meegleWorkspaceId || '',
      meegleProjectKey: activeCompany.meegleProjectKey || '',
      meegleViewUrl: activeCompany.meegleViewUrl || '',
      meegleMcpToken: activeCompany.meegleMcpToken || '',
      defaultRepoConfigId: activeCompany.defaultRepoConfigId || '',
      contactEmail: activeCompany.contactEmail || '',
      larkWebhookUrl: activeCompany.larkWebhookUrl || '',
      larkWebhookSecret: activeCompany.larkWebhookSecret || '',
      larkDefaultReceiveId: activeCompany.larkDefaultReceiveId || ''
    })
  }, [activeCompany])

  const switchCompany = async (companyId: string) => {
    setActiveCompanyId(companyId)
    await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switchActiveCompany', id: companyId })
    }).catch(() => null)
    await load(companyId)
  }

  const saveCompanyIntegration = async () => {
    if (!activeCompany) return
    setBusy(true)
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        id: activeCompany.id,
        githubOrgLogin: form.githubOrgLogin || undefined,
        meegleWorkspaceId: form.meegleWorkspaceId || undefined,
        meegleProjectKey: form.meegleProjectKey || undefined,
        meegleViewUrl: form.meegleViewUrl || undefined,
        meegleMcpToken: form.meegleMcpToken || undefined,
        defaultRepoConfigId: form.defaultRepoConfigId || undefined,
        contactEmail: form.contactEmail || undefined,
        larkWebhookUrl: form.larkWebhookUrl || undefined,
        larkWebhookSecret: form.larkWebhookSecret || undefined,
        larkDefaultReceiveId: form.larkDefaultReceiveId || undefined
      })
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMessage(data?.error || 'Failed to save integration settings')
      return
    }
    setMessage('Company integration settings saved')
    await load()
  }

  const runConnectivityCheck = async (action: 'checkAll' | 'checkGitHub' | 'checkMeegle' | 'checkLark') => {
    if (!activeCompany) return
    setBusy(true)
    const res = await fetch('/api/integrations/connectivity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        companyId: activeCompany.id,
        receiveId: larkReceiveId || undefined
      })
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setConnectivity(data as ConnectivityResponse)
    if (!res.ok) {
      setMessage(data?.error || 'Integration connectivity check failed')
      return
    }
    setMessage(action === 'checkAll' ? 'Integration connectivity check completed' : 'Connectivity check executed')
    await load(activeCompany.id)
  }

  return (
    <div className="panel rounded-xl p-5 space-y-5">
      <div>
        <p className="section-title">Integration Setup</p>
        <h2 className="mt-2 core-heading">Connect GitHub, Meegle, Lark, and default repo</h2>
        <p className="mt-2 core-subtle">
          Set company context and integration readiness here before moving tasks through delivery and payout flows.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div>
              <label htmlFor="field-active-company" className="label">Active Company</label>
            <select id="field-active-company" className="select mt-2" value={activeCompanyId} onChange={(e) => { void switchCompany(e.target.value) }}>
              {companies.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="field-github-org-login" className="label">GitHub Org Login</label>
              <input id="field-github-org-login" className="input mt-2" value={form.githubOrgLogin} onChange={(e) => setForm((prev) => ({ ...prev, githubOrgLogin: e.target.value }))} placeholder="e.g. tomo-labs" />
            </div>
            <div>
              <label htmlFor="field-default-repo-config" className="label">Default Repo Config</label>
              <select id="field-default-repo-config" className="select mt-2" value={form.defaultRepoConfigId} onChange={(e) => setForm((prev) => ({ ...prev, defaultRepoConfigId: e.target.value }))}>
                <option value="">Not set</option>
                {repoConfigs.map((item) => (
                  <option key={item.id} value={item.id}>{item.owner}/{item.repo} ({item.defaultBranch})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="field-meegle-workspace-id" className="label">Meegle Workspace ID</label>
              <input id="field-meegle-workspace-id" className="input mt-2" value={form.meegleWorkspaceId} onChange={(e) => setForm((prev) => ({ ...prev, meegleWorkspaceId: e.target.value }))} placeholder="workspace id" />
            </div>
            <div>
              <label htmlFor="field-meegle-project-key" className="label">Meegle Project/View Key</label>
              <input id="field-meegle-project-key" className="input mt-2" value={form.meegleProjectKey} onChange={(e) => setForm((prev) => ({ ...prev, meegleProjectKey: e.target.value }))} placeholder="legacy compatible" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="field-meegle-view-url" className="label">Meegle View URL</label>
              <input id="field-meegle-view-url" className="input mt-2" value={form.meegleViewUrl} onChange={(e) => setForm((prev) => ({ ...prev, meegleViewUrl: e.target.value }))} placeholder="recommended: full URL" />
            </div>
            <div className="md:col-span-2 rounded-xl border border-apple-blue/20 bg-apple-blue/8 p-4">
              <p className="text-sm font-semibold text-white">Meegle webhook</p>
              <p className="mt-2 text-sm leading-6 subtle">
                {activeCompanyId
                  ? 'Use this company-scoped webhook URL in Meegle so incoming events map to the correct company.'
                  : 'Select an active company first so a company-scoped Meegle webhook URL can be generated.'}
              </p>
              <p className={`mt-3 break-all text-sm ${activeCompanyId ? 'text-apple-blue' : 'text-white/70'}`}>
                {activeCompanyId
                  ? meegleWebhookUrl
                  : '/api/integrations/meegle/webhook?companyId=<select-company-first>&secret=<configured-webhook-secret>'}
              </p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="field-meegle-mcp-token" className="label">Meegle MCP Token</label>
              <input id="field-meegle-mcp-token" type="password" className="input mt-2" value={form.meegleMcpToken} onChange={(e) => setForm((prev) => ({ ...prev, meegleMcpToken: e.target.value }))} placeholder="stored for the active company only" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="field-contact-email" className="label">Contact Email</label>
              <input id="field-contact-email" className="input mt-2" value={form.contactEmail} onChange={(e) => setForm((prev) => ({ ...prev, contactEmail: e.target.value }))} placeholder="ops@company.com" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="field-lark-webhook-url" className="label">Lark Bot Webhook URL</label>
              <input id="field-lark-webhook-url" className="input mt-2" value={form.larkWebhookUrl} onChange={(e) => setForm((prev) => ({ ...prev, larkWebhookUrl: e.target.value }))} placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/..." />
            </div>
            <div>
              <label htmlFor="field-lark-webhook-secret" className="label">Lark Webhook Secret</label>
              <input id="field-lark-webhook-secret" className="input mt-2" value={form.larkWebhookSecret} onChange={(e) => setForm((prev) => ({ ...prev, larkWebhookSecret: e.target.value }))} placeholder="optional" />
            </div>
            <div>
              <label htmlFor="field-lark-default-receive-id" className="label">Lark Default Receive ID</label>
              <input id="field-lark-default-receive-id" className="input mt-2" value={form.larkDefaultReceiveId} onChange={(e) => setForm((prev) => ({ ...prev, larkDefaultReceiveId: e.target.value }))} placeholder="optional" />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={saveCompanyIntegration} className="btn-primary" disabled={busy || !activeCompany}>Save integration settings</button>
            <a href="/staff?layer=operations&ops=setup" className="btn-ghost">Open full setup</a>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
            <p className="section-title">GitHub App</p>
            <p className="mt-2 text-sm leading-6 subtle">
              Connect your GitHub organization via GitHub App and pick repositories without typing. Permissions: Issues RW, PR R, Contents R, Checks R.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="btn-secondary" href={`/api/auth/github-app/start?companyId=${encodeURIComponent(activeCompanyId)}&next=${encodeURIComponent('/staff?layer=operations&ops=setup')}`}>Connect via GitHub App</a>
              {installationId && (
                <button className="btn-ghost" disabled={ghAppLoading} onClick={async () => {
                  setGhAppError(''); setGhAppLoading(true)
                  try {
                    const res = await fetch(`/api/github/installations/repos?installationId=${encodeURIComponent(installationId)}`)
                    const data = await res.json()
                    if (!res.ok) throw new Error(data?.error || 'Failed to load installation repositories')
                    setGhAppRepos(Array.isArray(data?.items) ? data.items : [])
                  } catch (e: any) {
                    setGhAppError(e?.message || 'Failed to load installation repositories')
                  } finally { setGhAppLoading(false) }
                }}>Load installation repos</button>
              )}
            </div>
            {installationId && (
              <div className="mt-3 text-xs subtle">installationId: {installationId}</div>
            )}
            {ghAppError && <div className="mt-3 text-sm text-apple-red">{ghAppError}</div>}
            {ghAppRepos.length > 0 && (
              <div className="mt-3 space-y-2">
                {ghAppRepos.map((r) => (
                  <div key={`${r.owner}/${r.repo}`} className="flex items-center justify-between rounded-lg border border-white/[0.08] p-2">
                    <div className="text-sm">{r.owner}/{r.repo} {r.defaultBranch ? `(${r.defaultBranch})` : ''}</div>
                    <button className="btn-ghost" disabled={busy} onClick={async () => {
                      if (!activeCompany) return
                      setBusy(true)
                      try {
                        const res = await fetch('/api/repo-configs', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'create', owner: r.owner, repo: r.repo, companyId: activeCompany.id, defaultBranch: r.defaultBranch || 'main', tokenRef: `ghapp:${installationId}` })
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data?.error || 'Failed to create repo config')
                        setMessage(`Added repo config: ${r.owner}/${r.repo}`)
                        await load(activeCompany.id)
                      } catch (e: any) {
                        setMessage(e?.message || 'Failed to add repo config')
                      } finally { setBusy(false) }
                    }}>Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-title">Connectivity Check</p>
                <p className="mt-2 text-sm leading-6 subtle">
                  This distinguishes between a field being filled and the last real successful run. Only a genuine successful connection marks onboarding integration_ready.
                </p>
              </div>
              <button onClick={() => runConnectivityCheck('checkAll')} className="btn-primary" disabled={busy || !activeCompany}>
                Check all
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              {[
                { label: 'GitHub', item: connectivity?.connectivity?.github },
                { label: 'Meegle', item: connectivity?.connectivity?.meegle },
                { label: 'Lark', item: connectivity?.connectivity?.lark }
              ].map(({ label, item }) => (
                <div key={label} className={`rounded-xl border p-4 ${HEALTH_TONE[item?.health || 'missing']}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{label}</p>
                    <span className="chip">{item?.ready ? 'Connected' : item?.health || 'missing'}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6">{item?.detail || 'Check not yet executed'}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs subtle">
              Current onboarding state:
              {activeCompany?.onboarding?.integrationChecks?.githubReady ? ' GitHub ready;' : ' GitHub not ready;'}
              {activeCompany?.onboarding?.integrationChecks?.meegleReady ? ' Meegle ready;' : ' Meegle not ready;'}
              {activeCompany?.onboarding?.integrationChecks?.larkReady ? ' Lark ready.' : ' Lark not ready.'}
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
            <p className="section-title">Lark Callback</p>
            <p className="mt-2 text-sm leading-6 subtle">
              The callback URL is used to receive approval actions and challenge verification. The callback endpoint for this project is:
            </p>
            <p className="mt-3 break-all text-sm text-apple-blue">
              {typeof window !== 'undefined' ? `${window.location.origin}/api/integrations/lark/callback` : '/api/integrations/lark/callback'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="chip">Callback signing {larkStatus?.callbackSecretConfigured ? 'configured' : 'not configured'}</span>
              <span className="chip">Notify channel {larkStatus?.configured ? 'configured' : 'not configured'}</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
            <p className="section-title">Lark Notify Test</p>
            <p className="mt-2 text-sm leading-6 subtle">
              Supports sending test messages via bot webhook. receiveId is used only as a recipient label in the message; actual delivery depends on the server webhook configuration.
            </p>
            <label htmlFor="field-lark-receive-id" className="sr-only">Lark Receive ID</label>
            <input id="field-lark-receive-id" className="input mt-3" value={larkReceiveId} onChange={(e) => setLarkReceiveId(e.target.value)} placeholder="Optional: receiveId, leave blank to send directly via webhook" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => runConnectivityCheck('checkLark')} className="btn-secondary" disabled={busy}>Send test notification</button>
              <button onClick={() => runConnectivityCheck('checkGitHub')} className="btn-ghost" disabled={busy || !activeCompany}>Check GitHub</button>
              <button onClick={() => runConnectivityCheck('checkMeegle')} className="btn-ghost" disabled={busy || !activeCompany}>Check Meegle</button>
            </div>
            <p className="mt-3 text-xs subtle">
              Configure `LARK_BOT_WEBHOOK_URL`. If the bot has signing enabled, also add `LARK_BOT_WEBHOOK_SECRET`. Callback signing uses `LARK_CALLBACK_SECRET`.
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
            <p className="section-title">Repo Coverage</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="chip">Repo configs {repoConfigs.length}</span>
              <span className="chip">Enabled {repoConfigs.filter((item) => item.enabled).length}</span>
              <span className="chip">Current company {activeCompany?.name || '-'}</span>
              <span className="chip">Lark mode {larkStatus?.mode || 'unknown'}</span>
            </div>
            <p className="mt-3 text-sm leading-6 subtle">
              The default repo configuration affects task publishing, GitHub sync, and whether external bounty flows land in the correct repo.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-sm subtle">
          {message}
        </div>
      )}
    </div>
  )
}
