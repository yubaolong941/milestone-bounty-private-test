import { z } from 'zod'
import { evmAddressSchema, githubPrUrlSchema } from '@/lib/validation'

// Base: every task POST body must have an action field (or defaults to 'create')
const baseTaskSchema = z.object({
  action: z.string().optional(),
  taskId: z.string().optional()
}).passthrough()

// create action
export const createTaskSchema = baseTaskSchema.extend({
  action: z.literal('create').optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  rewardAmount: z.number().optional(),
  rewardToken: z.string().optional(),
  labels: z.array(z.string()).optional(),
  repo: z.string().optional(),
  repoConfigId: z.string().optional(),
  developerName: z.string().optional(),
  developerWallet: evmAddressSchema.optional().or(z.literal('')),
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  requirementDocUrl: z.string().optional(),
  requirementDocTitle: z.string().optional(),
  requirementId: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional()
}).passthrough()

// promoteToExternal action
export const promoteTaskSchema = baseTaskSchema.extend({
  action: z.literal('promoteToExternal'),
  taskId: z.string().min(1, 'taskId is required'),
  rewardAmount: z.number().optional(),
  rewardToken: z.string().optional(),
  fundingTxHash: z.string().min(1, 'fundingTxHash is required'),
  description: z.string().optional(),
  requirementDocUrl: z.string().optional(),
  requirementDocTitle: z.string().optional(),
  requirementId: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  repo: z.string().optional(),
  repoConfigId: z.string().optional(),
  repoVisibility: z.enum(['public', 'private']).optional(),
  deliveryMode: z.enum(['public_mirror_pr', 'private_collab_pr', 'patch_bundle']).optional(),
  mirrorRepoUrl: z.string().optional(),
  claimGithubLogin: z.string().optional(),
  walletAddress: evmAddressSchema.optional().or(z.literal('')),
  payerWalletAddress: evmAddressSchema.optional().or(z.literal('')),
  fundingWalletAddress: evmAddressSchema.optional().or(z.literal('')),
  publishToGithub: z.boolean().optional(),
  autoPayout: z.boolean().optional(),
  companyId: z.string().optional(),
  companyName: z.string().optional()
}).passthrough()

// claim action
export const claimTaskSchema = baseTaskSchema.extend({
  action: z.literal('claim'),
  taskId: z.string().min(1, 'taskId is required')
}).passthrough()

// submit action
export const submitTaskSchema = baseTaskSchema.extend({
  action: z.literal('submit'),
  taskId: z.string().min(1, 'taskId is required'),
  prUrl: githubPrUrlSchema,
  commitSha: z.string().optional()
}).passthrough()

// lockReward action
export const lockRewardSchema = baseTaskSchema.extend({
  action: z.literal('lockReward'),
  taskId: z.string().min(1, 'taskId is required'),
  rewardAmount: z.number().optional(),
  rewardToken: z.string().optional(),
  fundingTxHash: z.string().optional(),
  lockContractAddress: evmAddressSchema.optional().or(z.literal(''))
}).passthrough()

// autoPayout action
export const autoPayoutSchema = baseTaskSchema.extend({
  action: z.literal('autoPayout'),
  taskId: z.string().min(1, 'taskId is required'),
  merged: z.boolean().optional(),
  riskPassed: z.boolean().optional(),
  idempotencyKey: z.string().optional()
}).passthrough()

// manualReviewApprove action
export const manualReviewApproveSchema = baseTaskSchema.extend({
  action: z.literal('manualReviewApprove'),
  taskId: z.string().min(1, 'taskId is required'),
  reason: z.string().optional()
}).passthrough()

// manualReviewReject action
export const manualReviewRejectSchema = baseTaskSchema.extend({
  action: z.literal('manualReviewReject'),
  taskId: z.string().min(1, 'taskId is required'),
  reason: z.string().optional()
}).passthrough()

// financeApprove action
export const financeApproveSchema = baseTaskSchema.extend({
  action: z.literal('financeApprove'),
  taskId: z.string().min(1, 'taskId is required'),
  reason: z.string().optional()
}).passthrough()

// executePayout action
export const executePayoutSchema = baseTaskSchema.extend({
  action: z.literal('executePayout'),
  taskId: z.string().min(1, 'taskId is required'),
  forceManualRelease: z.boolean().optional(),
  merged: z.boolean().optional(),
  riskPassed: z.boolean().optional(),
  idempotencyKey: z.string().optional()
}).passthrough()

// retryPayout action
export const retryPayoutSchema = baseTaskSchema.extend({
  action: z.literal('retryPayout'),
  taskId: z.string().min(1, 'taskId is required'),
  forceManualRelease: z.boolean().optional(),
  merged: z.boolean().optional(),
  riskPassed: z.boolean().optional(),
  idempotencyKey: z.string().optional()
}).passthrough()

// Map of action name -> schema for use in route.ts
export const taskActionSchemas: Record<string, z.ZodTypeAny> = {
  create: createTaskSchema,
  promoteToExternal: promoteTaskSchema,
  claim: claimTaskSchema,
  submit: submitTaskSchema,
  lockReward: lockRewardSchema,
  autoPayout: autoPayoutSchema,
  manualReviewApprove: manualReviewApproveSchema,
  manualReviewReject: manualReviewRejectSchema,
  financeApprove: financeApproveSchema,
  executePayout: executePayoutSchema,
  retryPayout: retryPayoutSchema
}
