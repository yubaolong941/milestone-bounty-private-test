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

export interface RepoConfig {
  id: string
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

export interface InternalMemberBinding {
  id: string
  meegleAssignee: string
  githubLogin: string
  repoConfigId?: string
  repo?: string
  enabled: boolean
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
  reports: VulnerabilityReport[]
  // legacy compatibility for old data snapshots
  milestones?: VulnerabilityReport[]
}

export interface PaymentRecord {
  id: string
  projectId: string
  projectName: string
  reportId: string
  reportTitle: string
  severity?: Severity
  amount: number
  toAddress: string
  toName: string
  txHash: string
  memo: string
  timestamp: string
  // legacy fields for old records compatibility
  milestoneId?: string
  milestoneName?: string
  moduleType?: ModuleType
}

export type TaskBountyStatus =
  | 'open'
  | 'in_progress'
  | 'submitted'
  | 'ai_reviewing'
  | 'awaiting_acceptance'
  | 'accepted'
  | 'paid'
  | 'disputed'
  | 'cancelled'

export interface TaskBounty {
  id: string
  title: string
  description: string
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
  backportStatus?: 'pending' | 'done'
  backportCommitSha?: string
  prUrl?: string
  commitSha?: string
  claimedByGithubLogin?: string
  developerName: string
  meegleAssignee?: string
  internalGithubLogin?: string
  meegleIssueId?: string
  pendingMeegleStatus?: 'in_progress' | 'resolved'
  externalUserId?: string
  developerWallet: string
  aiScore?: number
  aiReviewSummary?: string
  aiModelUsed?: string
  aiConfidence?: number
  aiGateDecision?: 'pass' | 'block'
  aiCriticFindings?: string[]
  ciPassed?: boolean
  riskDecision?: 'pass' | 'blocked'
  status: TaskBountyStatus
  txHash?: string
  paidAt?: string
  createdAt: string
  updatedAt: string
}

export function getReports(project: Project): VulnerabilityReport[] {
  return project.reports ?? project.milestones ?? []
}
