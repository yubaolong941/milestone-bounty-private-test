import { describe, expect, it } from 'vitest'
import { deriveCompanyOnboardingState, mapOnboardingStageToSetupStage } from '@/lib/onboarding'
import type { Company, CompanyMembership, CompanyWalletConfig, IntegrationHealthState, RepoConfig, TaskBounty } from '@/lib/types'

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    slug: 'demo',
    name: 'Demo Co',
    status: 'active',
    createdByUserId: 'user-admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeMembership(overrides: Partial<CompanyMembership> = {}): CompanyMembership {
  return {
    id: 'membership-1',
    companyId: 'company-1',
    userId: 'user-1',
    role: 'company_owner',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    id: 'repo-1',
    provider: 'github',
    owner: 'acme',
    repo: 'platform',
    defaultBranch: 'main',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeWallet(overrides: Partial<CompanyWalletConfig> = {}): CompanyWalletConfig {
  return {
    id: 'wallet-1',
    companyId: 'company-1',
    companyName: 'Demo Co',
    walletAddress: '0x' + 'a'.repeat(40),
    network: 'base',
    tokenSymbol: 'USD1',
    active: true,
    verificationMethod: 'manual',
    verifiedByUserId: 'user-admin',
    verifiedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeTask(overrides: Partial<TaskBounty> = {}): TaskBounty {
  return {
    id: 'task-1',
    title: 'External delivery task',
    description: 'desc',
    source: 'external',
    rewardAmount: 100,
    rewardToken: 'USD1',
    labels: [],
    developerName: 'alice',
    developerWallet: '0x' + 'b'.repeat(40),
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeIntegration(overrides: Partial<IntegrationHealthState> = {}): IntegrationHealthState {
  return {
    integration: 'github_issue_sync',
    lastStatus: 'success',
    lastDetail: 'ok',
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

describe('mapOnboardingStageToSetupStage', () => {
  it('maps every onboarding stage to a setup stage as designed', () => {
    expect(mapOnboardingStageToSetupStage('company_created')).toBe('company')
    expect(mapOnboardingStageToSetupStage('membership_ready')).toBe('members')
    expect(mapOnboardingStageToSetupStage('repo_ready')).toBe('repos')
    expect(mapOnboardingStageToSetupStage('integration_ready')).toBe('repos')
    expect(mapOnboardingStageToSetupStage('wallet_ready')).toBe('wallets')
    expect(mapOnboardingStageToSetupStage('first_task_published')).toBe('publish')
  })
})

describe('deriveCompanyOnboardingState', () => {
  it('marks onboarding completed when membership/repo/wallet/integration/task are all ready', () => {
    const state = deriveCompanyOnboardingState({
      company: makeCompany({ larkWebhookUrl: 'https://open.feishu.cn/hook/test' }),
      memberships: [makeMembership()],
      repos: [makeRepo()],
      wallets: [makeWallet()],
      tasks: [makeTask()],
      integrationStates: [
        makeIntegration({ integration: 'github_issue_sync' }),
        makeIntegration({ integration: 'lark_notify' })
      ]
    })

    expect(state.completed).toBe(true)
    expect(state.stage).toBe('first_task_published')
    expect(state.pendingStages).toEqual([])
    expect(state.blockedReasons).toEqual([])
  })

  it('keeps stage at membership_ready when no active members and records blockers', () => {
    const state = deriveCompanyOnboardingState({
      company: makeCompany(),
      memberships: [makeMembership({ status: 'disabled' })],
      repos: [],
      wallets: [],
      tasks: [],
      integrationStates: []
    })

    expect(state.stage).toBe('membership_ready')
    expect(state.completed).toBe(false)
    expect(state.completedStages).toEqual(['company_created'])
    expect(state.blockedReasons).toContain('No active members found. Cannot establish internal ownership roles.')
    expect(state.blockedReasons).toContain('No enabled GitHub repository configuration found.')
    expect(state.blockedReasons).toContain('No active wallet configured. Cannot enter the real settlement pipeline.')
    expect(state.blockedReasons).toContain('No external bounty has been published yet. Cannot verify the full client delivery loop.')
  })

  it('adds both Meegle and Lark blockers when both are configured but not ready', () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const state = deriveCompanyOnboardingState({
      company: makeCompany({
        meegleWorkspaceId: 'w1',
        meegleProjectKey: 'p1',
        larkWebhookUrl: 'https://open.feishu.cn/hook/test'
      }),
      memberships: [makeMembership()],
      repos: [makeRepo()],
      wallets: [makeWallet()],
      tasks: [makeTask()],
      integrationStates: [
        makeIntegration({ integration: 'github_issue_sync' }),
        makeIntegration({ integration: 'meegle_sync', updatedAt: stale, lastDetail: 'meegle stale' }),
        makeIntegration({ integration: 'lark_notify', updatedAt: stale, lastDetail: 'lark stale' })
      ]
    })

    expect(state.integrationChecks.githubReady).toBe(true)
    expect(state.integrationChecks.meegleReady).toBe(false)
    expect(state.integrationChecks.larkReady).toBe(false)
    expect(state.completedStages).not.toContain('integration_ready')
    expect(state.blockedReasons).toContain('meegle stale')
    expect(state.blockedReasons).toContain('lark stale')
  })
})
