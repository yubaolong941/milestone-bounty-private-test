export type ReportStatus =
  | 'pending'
  | 'reviewing'
  | 'awaiting_manual_review'
  | 'approved'
  | 'paid'
  | 'overdue'
  | 'rejected'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'
export type ModuleType = 'bounty' | 'milestone' | 'bounty_task'
export type PlatformRole = 'platform_admin' | 'platform_ops' | 'auditor' | 'none'
export type ProjectManagementTool = 'meegle' | 'jira' | 'linear' | 'github_projects' | 'other'
export type DocumentationTool = 'lark' | 'slack' | 'notion' | 'other'
export type CompanyOnboardingStage =
  | 'company_created'
  | 'membership_ready'
  | 'repo_ready'
  | 'wallet_ready'
  | 'integration_ready'
  | 'first_task_published'
export type CompanyRole =
  | 'company_owner'
  | 'company_admin'
  | 'company_finance'
  | 'company_reviewer'
  | 'company_maintainer'
  | 'company_viewer'

export interface CompanyOnboardingState {
  stage: CompanyOnboardingStage
  completedStages: CompanyOnboardingStage[]
  pendingStages: CompanyOnboardingStage[]
  blockedReasons: string[]
  counts: {
    activeMemberships: number
    enabledRepos: number
    activeWallets: number
    publishedExternalTasks: number
  }
  integrationChecks: {
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
  completed: boolean
  updatedAt: string
}

export interface Company {
  id: string
  slug: string
  name: string
  status: 'pending' | 'active' | 'suspended'
  githubOrgLogin?: string
  githubOrgId?: string
  projectManagementTool?: ProjectManagementTool
  projectManagementToolLabel?: string
  meegleWorkspaceId?: string
  meegleProjectKey?: string
  meegleViewUrl?: string
  meegleMcpToken?: string
  documentationTool?: DocumentationTool
  documentationToolLabel?: string
  larkWebhookUrl?: string
  larkWebhookSecret?: string
  larkDefaultReceiveId?: string
  description?: string
  websiteUrl?: string
  contactEmail?: string
  defaultRepoConfigId?: string
  activeWalletId?: string
  onboarding?: CompanyOnboardingState
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface CompanyMembership {
  id: string
  companyId: string
  userId: string
  githubLogin?: string
  githubUserId?: string
  walletAddress?: string
  role: CompanyRole
  status: 'active' | 'invited' | 'disabled'
  invitedByUserId?: string
  invitedAt?: string
  acceptedAt?: string
  createdAt: string
  updatedAt: string
}

export interface AuditLog {
  id: string
  companyId?: string
  actorUserId: string
  actorRole?: string
  action: string
  targetType: string
  targetId: string
  summary: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface NotificationEvent {
  id: string
  companyId?: string
  severity: 'info' | 'warning' | 'critical'
  channel: 'inbox' | 'lark'
  category: 'task_status' | 'manual_review' | 'payment_failure' | 'escrow' | 'integration'
  title: string
  message: string
  taskId?: string
  taskTitle?: string
  actionUrl?: string
  acknowledged: boolean
  metadata?: Record<string, unknown>
  createdAt: string
}

export type PaymentFailureCode =
  | 'ONCHAIN_FAILURE'
  | 'SIGNATURE_FAILURE'
  | 'INSUFFICIENT_ESCROW_BALANCE'
  | 'REVIEW_NOT_APPROVED'
  | 'CI_NOT_PASSED'
  | 'AI_GATE_BLOCKED'
  | 'MERGE_NOT_COMPLETE'
  | 'ESCROW_VERIFICATION_FAILED'
  | 'PAYER_WALLET_MISMATCH'
  | 'RECIPIENT_IDENTITY_MISMATCH'
  | 'UNKNOWN_FAILURE'

export type PaymentRetryStrategy = 'auto_retry' | 'manual_retry' | 'no_retry'
export type PaymentRetryJobStatus = 'pending' | 'processing' | 'completed' | 'dead_letter' | 'cancelled'
export type ExternalAuthType = 'github_code_bounty' | 'wallet_security_bounty'
export type WalletActorRole = 'company_operator' | 'bounty_claimer'
export type SettlementFundingState = 'not_required' | 'pending_lock' | 'locked' | 'lock_failed' | 'released' | 'cancelled'
export type SettlementPayoutState = 'not_ready' | 'ready' | 'processing' | 'paid' | 'failed'
export type RequirementBindingSource = 'task_create' | 'task_promote' | 'meegle_sync' | 'github_issue_sync' | 'manual'

export interface PaymentRetryJob {
  id: string
  taskId: string
  companyId?: string
  taskTitle: string
  failureCode: PaymentFailureCode
  retryStrategy: PaymentRetryStrategy
  status: PaymentRetryJobStatus
  source: 'auto_payout' | 'manual_retry' | 'github_webhook' | 'github_issue_sync' | 'lark_callback' | 'scheduler'
  attempts: number
  maxAttempts: number
  scheduledAt: string
  lastAttemptAt?: string
  completedAt?: string
  lockedAt?: string
  lastError?: string
  nextAction?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface SettlementCase {
  id: string
  taskId: string
  companyId?: string
  companyName?: string
  amount: number
  allocatedAmount?: number
  token: string
  treasuryFundingId?: string
  treasuryFundingTxHash?: string
  payerWalletId?: string
  payerWalletAddress?: string
  recipientGithubLogin?: string
  recipientWalletAddress?: string
  recipientWalletFrozenAt?: string
  recipientWalletSource?: 'session_wallet' | 'claim_label' | 'identity_binding' | 'task_snapshot' | 'manual_override'
  fundingLockId?: string
  fundingTxHash?: string
  fundingReservedAt?: string
  releaseTxHash?: string
  fundingState: SettlementFundingState
  payoutState: SettlementPayoutState
  payoutTxHash?: string
  failureCode?: PaymentFailureCode
  retryStrategy?: PaymentRetryStrategy
  lastError?: string
  lastAttemptAt?: string
  paidAt?: string
  sourceTaskStatus: TaskBountyStatus
  createdAt: string
  updatedAt: string
}

export interface RequirementBinding {
  id: string
  requirementId: string
  title: string
  companyId?: string
  companyName?: string
  larkDocUrl: string
  larkDocTitle?: string
  meegleIssueId?: string
  meegleUrl?: string
  meegleStatus?: string
  githubRepo?: string
  githubIssueNumber?: number
  githubIssueUrl?: string
  acceptanceCriteriaSnapshot: string[]
  summarySnapshot: string
  contentVersion?: string
  statusVersion?: string
  source: RequirementBindingSource
  createdAt: string
  updatedAt: string
}

export interface RepoConfig {
  id: string
  companyId?: string
  provider: 'github'
  owner: string
  repo: string
  defaultBranch: string
  tokenRef?: string
  enabled: boolean
  syncIntervalSec?: number
  createdAt: string
  updatedAt: string
}

export type IntegrationKey = 'meegle_sync' | 'github_issue_sync' | 'lark_notify'
export type IntegrationRunStatus = 'success' | 'failure'
export type WorkflowEventActorType = 'user' | 'system' | 'webhook' | 'cron'
export type WorkflowEventStatus = 'processing' | 'processed' | 'dead_letter'
export type PayoutAttemptStatus = 'processing' | 'succeeded' | 'failed' | 'cancelled'
export type PayoutAttemptContext = 'auto_payout' | 'manual_execute' | 'manual_retry' | 'github_webhook' | 'lark_callback' | 'scheduler'

export interface IntegrationHealthState {
  integration: IntegrationKey
  lastStatus: IntegrationRunStatus
  lastSuccessAt?: string
  lastFailureAt?: string
  lastDetail: string
  consecutiveFailures: number
  updatedAt: string
}

export interface WorkflowEvent {
  id: string
  taskId?: string
  companyId?: string
  eventType: string
  actorType: WorkflowEventActorType
  actorId?: string
  idempotencyKey: string
  status: WorkflowEventStatus
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  replayCount: number
  lastReplayedAt?: string
  processedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PayoutAttempt {
  id: string
  settlementCaseId: string
  taskId: string
  companyId?: string
  payoutContext: PayoutAttemptContext
  idempotencyKey: string
  status: PayoutAttemptStatus
  amount: number
  token: string
  recipientWalletAddress?: string
  provider?: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key' | 'escrow'
  txHash?: string
  error?: string
  activeExecution?: boolean
  requestPayload: Record<string, unknown>
  resultPayload?: Record<string, unknown>
  startedAt: string
  finishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface InternalMemberBinding {
  id: string
  companyId?: string
  meegleAssignee: string
  githubLogin: string
  repoConfigId?: string
  repo?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CompanyWalletConfig {
  id: string
  companyId?: string
  companyName: string
  walletLabel?: string
  walletAddress: string
  network: string
  tokenSymbol: string
  tokenAddress?: string
  active: boolean
  verificationMethod: 'wallet_signature' | 'manual'
  verifiedSignatureAddress?: string
  verifiedByUserId: string
  verifiedByGithubLogin?: string
  verifiedAt: string
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}

export interface RecipientProfile {
  id: string
  type: 'individual' | 'team'
  displayName: string
  githubLogin?: string
  githubUserId?: string
  walletAddress?: string
  externalUserId: string
  identitySource?: ExternalAuthType | 'hybrid'
  ownerUserId: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export interface WalletIdentityBinding {
  id: string
  actorRole: WalletActorRole
  githubLogin?: string
  walletAddress: string
  externalUserId?: string
  authSource: 'github_oauth_wallet_signature' | 'wallet_signature'
  status: 'active' | 'revoked'
  verifiedAt: string
  createdAt: string
  updatedAt: string
}

export interface BountyFundingLock {
  id: string
  taskId: string
  issueNumber?: number
  issueUrl?: string
  rewardAmount: number
  rewardToken: string
  payerCompanyWalletId?: string
  payerCompanyName?: string
  payerWalletAddress?: string
  fundingTxHash?: string
  lockContractAddress?: string
  lockTransactionHash?: string
  releaseTransactionHash?: string
  onchainLockId?: string
  onchainVerifiedAt?: string
  status: 'locked' | 'released' | 'cancelled'
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface VulnerabilityReport {
  id: string
  name: string
  description: string
  completionCriteria: string
  rewardAmount: number
  assigneeName: string
  assigneeWallet: string
  deadline: string
  status: ReportStatus
  severity?: Severity
  isDuplicate?: boolean
  duplicateOf?: string
  aiReviewSummary?: string
  manualReviewSummary?: string
  reviewer?: string
  reviewedAt?: string
  txHash?: string
  paidAt?: string
  completedAt?: string
}

export interface Project {
  id: string
  name: string
  description: string
  totalBudget: number
  spentAmount: number
  createdAt: string
  updatedAt?: string
  reports: VulnerabilityReport[]
  // legacy compatibility for old data snapshots
  milestones?: VulnerabilityReport[]
}

export interface PaymentRecord {
  id: string
  projectId: string
  projectName: string
  companyId?: string
  companyName?: string
  reportId: string
  reportTitle: string
  severity?: Severity
  amount: number
  toAddress: string
  toName: string
  txHash: string
  memo: string
  timestamp: string
  fromAddress?: string
  fromName?: string
  claimId?: string
  repo?: string
  issueNumber?: number
  issueUrl?: string
  prUrl?: string
  claimerGithubLogin?: string
  aiModelUsed?: string
  walletBindingId?: string
  fundingLockId?: string
  rewardToken?: string
  verificationSnapshot?: {
    merged?: boolean
    ciPassed?: boolean
    aiPassed?: boolean
    aiGatePassed?: boolean
    riskPassed?: boolean
    lockChecked?: boolean
    budgetChecked?: boolean
    reviewApproved?: boolean
    reviewDecision?: string
    reviewStates?: string[]
    checksDetail?: string
    failureCode?: PaymentFailureCode
    retryStrategy?: PaymentRetryStrategy
    nextAction?: string
    claimedBy?: string | null
    prAuthor?: string | null
  }
  // legacy fields for old records compatibility
  milestoneId?: string
  milestoneName?: string
  moduleType?: ModuleType
}

export interface TreasuryFundingRecord {
  id: string
  companyId?: string
  companyName?: string
  txHash: string
  amount: number
  tokenSymbol: string
  network?: string
  fromAddress?: string
  toAddress?: string
  taskId?: string
  taskTitle?: string
  status: 'recorded' | 'applied'
  source: 'wallet_payment' | 'task_publish'
  createdAt: string
  recordedByUserId?: string
}

export type TreasuryFundingStatus =
  | 'received'
  | 'allocated'
  | 'partially_allocated'
  | 'released'
  | 'exhausted'
  | 'refunded'

export interface TreasuryFunding {
  id: string
  companyId?: string
  companyName?: string
  txHash: string
  amount: number
  allocatedAmount: number
  remainingAmount: number
  tokenSymbol: string
  network?: string
  fromAddress?: string
  toAddress?: string
  status: TreasuryFundingStatus
  source: 'wallet_payment' | 'task_publish'
  linkedTaskIds: string[]
  linkedTaskTitles: string[]
  verifiedAt?: string
  recordedByUserId?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type TaskBountyStatus =
  | 'open'
  | 'in_progress'
  | 'submitted'
  | 'ai_reviewing'
  | 'awaiting_acceptance'
  | 'awaiting_manual_review'
  | 'awaiting_finance_review'
  | 'payment_failed'
  | 'accepted'
  | 'paid'
  | 'disputed'
  | 'cancelled'

export interface TaskBounty {
  id: string
  title: string
  description: string
  requirementBindingId?: string
  requirementId?: string
  requirementDocUrl?: string
  requirementDocTitle?: string
  requirementSummarySnapshot?: string
  acceptanceCriteriaSnapshot?: string[]
  companyId?: string
  companyName?: string
  createdByUserId?: string
  createdByRole?: string
  currentClaimId?: string
  source: 'internal' | 'external'
  rewardAmount: number
  rewardToken: string
  labels: string[]
  repo?: string
  repoConfigId?: string
  repoVisibility?: 'public' | 'private'
  deliveryMode?: 'public_mirror_pr' | 'private_collab_pr' | 'patch_bundle'
  mirrorRepoUrl?: string
  requirementClarityScore?: number
  requirementClaritySummary?: string
  requirementClarityStatus?: 'clear' | 'needs_refinement'
  requirementModelUsed?: string
  requirementConfidence?: number
  requirementGateDecision?: 'pass' | 'block'
  requirementCriticFindings?: string[]
  requirementEvidenceRefs?: string[]
  prUrl?: string
  commitSha?: string
  claimedByGithubLogin?: string
  prAuthorGithubLogin?: string
  githubReviewApproved?: boolean
  githubReviewDecision?: string
  githubReviewStates?: string[]
  githubCheckSummary?: string
  payerCompanyWalletId?: string
  payerCompanyName?: string
  payerWalletAddress?: string
  rewardLockId?: string
  rewardLockStatus?: 'locked' | 'released' | 'cancelled'
  rewardLockedAmount?: number
  rewardLockedToken?: string
  rewardLockContractAddress?: string
  rewardLockTxHash?: string
  rewardReleaseTxHash?: string
  rewardLockOnchainVerifiedAt?: string
  payoutProvider?: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key' | 'escrow'
  payoutWalletBindingId?: string
  githubRepoOwner?: string
  githubRepoName?: string
  githubIssueNumber?: number
  githubIssueId?: string
  githubIssueUrl?: string
  githubPrNumber?: number
  developerName: string
  meegleAssignee?: string
  internalGithubLogin?: string
  meegleIssueId?: string
  meegleUrl?: string
  pendingMeegleStatus?: 'in_progress' | 'resolved'
  externalUserId?: string
  developerWallet: string
  aiScore?: number
  aiCompletionScore?: number
  aiReviewSummary?: string
  aiPrSuggestions?: string[]
  aiManagerFocus?: string[]
  aiModelUsed?: string
  aiConfidence?: number
  aiGateDecision?: 'pass' | 'block'
  aiCriticFindings?: string[]
  ciPassed?: boolean
  riskDecision?: 'pass' | 'blocked'
  lastAutoPayoutError?: string
  lastAutoPayoutFailureCode?: PaymentFailureCode
  lastAutoPayoutRetryStrategy?: PaymentRetryStrategy
  lastAutoPayoutChecks?: Record<string, unknown>
  manualReviewRequired?: boolean
  manualReviewReason?: string
  manualReviewDecision?: 'approved' | 'rejected' | 'pending'
  manualReviewedByUserId?: string
  manualReviewedAt?: string
  paymentFailureCount?: number
  lastPaymentAttemptAt?: string
  nextAutoRetryAt?: string
  autoRetryJobId?: string
  treasuryFundingStatus?: 'pending' | 'confirmed' | 'failed'
  treasuryFundingTxHash?: string
  treasuryFundingVerifiedAt?: string
  treasuryFundingNetwork?: string
  treasuryFundingAddress?: string
  treasuryFundingAmount?: number
  treasuryFundingToken?: string
  lastNotificationAt?: string
  status: TaskBountyStatus
  txHash?: string
  paidAt?: string
  createdAt: string
  updatedAt: string
}

export function getReports(project: Project): VulnerabilityReport[] {
  return project.reports ?? project.milestones ?? []
}
