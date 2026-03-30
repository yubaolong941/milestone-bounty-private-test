import {
  Company,
  CompanyMembership,
  CompanyOnboardingStage,
  CompanyOnboardingState,
  IntegrationHealthState,
  CompanyWalletConfig,
  RepoConfig,
  TaskBounty
} from '@/lib/types'
import { deriveCompanyIntegrationConnectivity } from '@/lib/integration-connectivity'

const ONBOARDING_ORDER: CompanyOnboardingStage[] = [
  'company_created',
  'membership_ready',
  'repo_ready',
  'wallet_ready',
  'integration_ready',
  'first_task_published'
]

export function mapOnboardingStageToSetupStage(stage: CompanyOnboardingStage): 'company' | 'members' | 'repos' | 'wallets' | 'publish' {
  if (stage === 'company_created') return 'company'
  if (stage === 'membership_ready') return 'members'
  if (stage === 'repo_ready' || stage === 'integration_ready') return 'repos'
  if (stage === 'wallet_ready') return 'wallets'
  return 'publish'
}

export function deriveCompanyOnboardingState(input: {
  company: Company
  memberships: CompanyMembership[]
  repos: RepoConfig[]
  wallets: CompanyWalletConfig[]
  tasks: TaskBounty[]
  integrationStates?: IntegrationHealthState[]
}): CompanyOnboardingState {
  const { company, memberships, repos, wallets, tasks, integrationStates = [] } = input
  const activeMemberships = memberships.filter((item) => item.status === 'active')
  const enabledRepos = repos.filter((item) => item.enabled)
  const activeWallets = wallets.filter((item) => item.active)
  const publishedExternalTasks = tasks.filter((item) => item.source === 'external' && item.status !== 'cancelled').length

  const connectivity = deriveCompanyIntegrationConnectivity({
    company,
    repos,
    integrationStates
  })

  const completedStages: CompanyOnboardingStage[] = []
  const blockedReasons: string[] = []

  completedStages.push('company_created')

  if (activeMemberships.length > 0) {
    completedStages.push('membership_ready')
  } else if (activeMemberships.length === 0) {
    blockedReasons.push('No active members found. Cannot establish internal ownership roles.')
  }

  if (enabledRepos.length > 0) {
    completedStages.push('repo_ready')
  } else {
    blockedReasons.push('No enabled GitHub repository configuration found.')
  }

  if (activeWallets.length > 0 || company.activeWalletId) {
    completedStages.push('wallet_ready')
  } else {
    blockedReasons.push('No active wallet configured. Cannot enter the real settlement pipeline.')
  }

  if (connectivity.overallReady) {
    completedStages.push('integration_ready')
  } else {
    if (!connectivity.github.ready) blockedReasons.push(connectivity.github.detail)
    if (!connectivity.meegle.ready && !connectivity.lark.ready) {
      blockedReasons.push(connectivity.meegle.configured ? connectivity.meegle.detail : connectivity.lark.detail)
      if (connectivity.meegle.configured && connectivity.lark.configured) {
        blockedReasons.push(connectivity.lark.detail)
      }
    }
  }

  if (publishedExternalTasks > 0) {
    completedStages.push('first_task_published')
  } else {
    blockedReasons.push('No external bounty has been published yet. Cannot verify the full client delivery loop.')
  }

  const pendingStages = ONBOARDING_ORDER.filter((stage) => !completedStages.includes(stage))
  const stage = pendingStages[0] || 'first_task_published'

  return {
    stage,
    completedStages,
    pendingStages,
    blockedReasons,
    counts: {
      activeMemberships: activeMemberships.length,
      enabledRepos: enabledRepos.length,
      activeWallets: activeWallets.length,
      publishedExternalTasks
    },
    integrationChecks: {
      githubReady: connectivity.github.ready,
      meegleReady: connectivity.meegle.ready,
      larkReady: connectivity.lark.ready,
      githubHealth: connectivity.github.health,
      meegleHealth: connectivity.meegle.health,
      larkHealth: connectivity.lark.health,
      githubDetail: connectivity.github.detail,
      meegleDetail: connectivity.meegle.detail,
      larkDetail: connectivity.lark.detail
    },
    completed: pendingStages.length === 0,
    updatedAt: new Date().toISOString()
  }
}
