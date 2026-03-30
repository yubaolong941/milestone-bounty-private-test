import { Company, IntegrationHealthState, RepoConfig } from '@/lib/types'

export type IntegrationConnectivityHealth = 'ok' | 'degraded' | 'stale' | 'unknown' | 'missing'

export interface CompanyIntegrationConnectivityCheck {
  configured: boolean
  ready: boolean
  health: IntegrationConnectivityHealth
  detail: string
  updatedAt?: string
}

export interface CompanyIntegrationConnectivityState {
  github: CompanyIntegrationConnectivityCheck
  meegle: CompanyIntegrationConnectivityCheck
  lark: CompanyIntegrationConnectivityCheck
  overallReady: boolean
}

function findIntegrationState(states: IntegrationHealthState[], integration: IntegrationHealthState['integration']) {
  return states.find((item) => item.integration === integration)
}

export function summarizeIntegrationHealth(state?: Pick<IntegrationHealthState, 'lastStatus' | 'updatedAt'>): IntegrationConnectivityHealth {
  if (!state?.updatedAt) return 'missing'
  const ageMs = Date.now() - new Date(state.updatedAt).getTime()
  if (Number.isNaN(ageMs)) return 'unknown'
  if (state.lastStatus === 'failure') return 'degraded'
  if (ageMs > 15 * 60 * 1000) return 'stale'
  return 'ok'
}

function buildConfiguredCheck(input: {
  configured: boolean
  configuredDetail: string
  missingConfigDetail: string
  state?: IntegrationHealthState
  successFallback: string
}): CompanyIntegrationConnectivityCheck {
  if (!input.configured) {
    return {
      configured: false,
      ready: false,
      health: 'missing',
      detail: input.missingConfigDetail
    }
  }

  if (!input.state) {
    return {
      configured: true,
      ready: false,
      health: 'unknown',
      detail: input.configuredDetail
    }
  }

  const health = summarizeIntegrationHealth(input.state)
  if (health === 'ok') {
    return {
      configured: true,
      ready: true,
      health,
      detail: input.state.lastDetail || input.successFallback,
      updatedAt: input.state.updatedAt
    }
  }

  if (health === 'stale') {
    return {
      configured: true,
      ready: false,
      health,
      detail: input.state.lastDetail || 'Last connectivity check has expired. Re-verification required.',
      updatedAt: input.state.updatedAt
    }
  }

  return {
    configured: true,
    ready: false,
    health,
    detail: input.state.lastDetail || input.configuredDetail,
    updatedAt: input.state.updatedAt
  }
}

export function deriveCompanyIntegrationConnectivity(input: {
  company: Company
  repos: RepoConfig[]
  integrationStates: IntegrationHealthState[]
}): CompanyIntegrationConnectivityState {
  const { company, repos, integrationStates } = input
  const enabledRepos = repos.filter((item) => item.enabled)

  const githubConfigured = Boolean(enabledRepos.length > 0 || company.defaultRepoConfigId || company.githubOrgLogin)
  const meegleConfigured = Boolean(company.meegleViewUrl || (company.meegleWorkspaceId && company.meegleProjectKey))
  const larkConfigured = Boolean(company.larkWebhookUrl)

  const github = buildConfiguredCheck({
    configured: githubConfigured,
    configuredDetail: 'GitHub is configured but no valid connectivity check has been completed recently',
    missingConfigDetail: 'GitHub organization or default repository is not fully configured',
    state: findIntegrationState(integrationStates, 'github_issue_sync'),
    successFallback: 'GitHub issue sync last run succeeded'
  })

  const meegle = buildConfiguredCheck({
    configured: meegleConfigured,
    configuredDetail: 'Meegle is configured but no valid connectivity check has been completed recently',
    missingConfigDetail: 'Missing Meegle View URL, or missing workspaceId / projectKey',
    state: findIntegrationState(integrationStates, 'meegle_sync'),
    successFallback: 'Meegle MCP last sync succeeded'
  })

  const lark = buildConfiguredCheck({
    configured: larkConfigured,
    configuredDetail: 'Lark webhook is configured but no test message has been sent recently',
    missingConfigDetail: 'Missing Lark webhook. Notification pipeline cannot be verified.',
    state: findIntegrationState(integrationStates, 'lark_notify'),
    successFallback: 'Lark test message last send succeeded'
  })

  return {
    github,
    meegle,
    lark,
    overallReady: github.ready && (meegle.ready || lark.ready)
  }
}
