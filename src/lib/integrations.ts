interface GitHubPRInfo {
  owner: string
  repo: string
  pullNumber: number
}

import crypto from 'crypto'
import { extractLarkDocUrlCandidate, extractRequirementIdCandidate } from '@/lib/repositories/requirement-binding-repository'

interface GitHubPullRequestApiResponse {
  merged?: boolean
  state?: string
  user?: { login?: string } | null
  merge_commit_sha?: string | null
  head?: { sha?: string | null } | null
  base?: { sha?: string | null } | null
}

interface GitHubReviewApiItem {
  state?: string | null
  user?: { login?: string } | null
  submitted_at?: string | null
}

interface GitHubCheckRunApiItem {
  name?: string | null
  status?: string | null
  conclusion?: string | null
}

interface GitHubIssueApiResponse {
  id?: number
  number?: number
  html_url?: string
  title?: string
  body?: string | null
  state?: 'open' | 'closed'
}

export interface GitHubPullRequestVerification {
  merged: boolean
  detail: string
  owner: string
  repo: string
  pullNumber: number
  prAuthor: string | null
  mergeCommitSha: string | null
  headSha: string | null
  reviewApproved: boolean
  reviewDecision: string
  reviewStates: string[]
  ciPassed: boolean
  checkSummary: string
  checkRuns: Array<{ name: string; status: string; conclusion: string | null }>
}

export interface GitHubCreatedIssue {
  issueId: number
  issueNumber: number
  htmlUrl: string
  title: string
  body: string
  state: 'open' | 'closed'
}

function normalizeTokenRefKey(tokenRef: string) {
  return tokenRef
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

function looksLikeGitHubToken(value: string) {
  const normalized = value.trim()
  return /^(github_pat_|ghp_|gho_|ghs_|ghu_)/i.test(normalized)
}

export function resolveGitHubToken(tokenRef?: string): string | null {
  const normalizedRef = typeof tokenRef === 'string' ? tokenRef.trim() : ''
  if (normalizedRef) {
    if (looksLikeGitHubToken(normalizedRef)) return normalizedRef

    const exact = process.env[normalizedRef]
    if (exact) return exact

    const namespaced = process.env[`GITHUB_TOKEN_${normalizeTokenRefKey(normalizedRef)}`]
    if (namespaced) return namespaced
  }

  return process.env.GITHUB_TOKEN || null
}

function buildGitHubHeaders(tokenRef?: string): Record<string, string> | null {
  const token = resolveGitHubToken(tokenRef)
  if (!token) return null
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

// --- GitHub App support (Installation Token) ---
let ghAppTokenCache: Map<string, { token: string; expiresAt: number }> | null = null

function b64url(input: Buffer | string) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8')
  return raw.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function decodeBase64Maybe(input?: string): string | null {
  if (!input) return null
  try {
    return Buffer.from(input, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function normalizePrivateKeyPem(input?: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (raw.includes('-----BEGIN')) return raw.replace(/\\n/g, '\n')

  const decoded = decodeBase64Maybe(raw)?.trim() || ''
  if (decoded.includes('-----BEGIN')) return decoded.replace(/\\n/g, '\n')

  return raw.replace(/\\n/g, '\n')
}

function getGitHubAppConfig(): { appId: string; privateKeyPem: string } | null {
  const appId = (process.env.GITHUB_APP_ID || '').trim()
  const b64 = (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || '').trim()
  const raw = (process.env.GITHUB_APP_PRIVATE_KEY || '').trim()
  const pem = normalizePrivateKeyPem(b64 || raw)
  if (!appId || !pem) return null
  return { appId, privateKeyPem: pem }
}

function buildGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId }
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(encoded)
  const signature = signer.sign(privateKeyPem)
  return `${encoded}.${b64url(signature)}`
}

export async function getInstallationAccessToken(installationId: string): Promise<{ token: string; expiresAt: number } | null> {
  const config = getGitHubAppConfig()
  if (!config) return null
  if (!ghAppTokenCache) ghAppTokenCache = new Map()
  const cached = ghAppTokenCache.get(installationId)
  const now = Date.now()
  if (cached && cached.expiresAt - 120000 > now) return cached

  let jwt = ''
  try {
    jwt = buildGitHubAppJwt(config.appId, config.privateKeyPem)
  } catch {
    return null
  }
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) return null
  const data = await res.json() as { token?: string; expires_at?: string }
  if (!data.token || !data.expires_at) return null
  const expiresAt = new Date(data.expires_at).getTime()
  const value = { token: data.token, expiresAt }
  ghAppTokenCache.set(installationId, value)
  return value
}

async function buildGitHubHeadersAsync(tokenRef?: string): Promise<Record<string, string> | null> {
  const normalizedRef = typeof tokenRef === 'string' ? tokenRef.trim() : ''
  const ghappMatch = normalizedRef.match(/^ghapp:(\d+)$/)
  if (ghappMatch) {
    const installationId = ghappMatch[1]
    const minted = await getInstallationAccessToken(installationId)
    if (!minted) return null
    return {
      Authorization: `Bearer ${minted.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }
  return buildGitHubHeaders(tokenRef)
}

export async function resolveGitHubRequestHeaders(tokenRef?: string): Promise<Record<string, string> | null> {
  return buildGitHubHeadersAsync(tokenRef)
}

async function githubGet<T>(path: string, tokenRef?: string): Promise<{ ok: true; data: T } | { ok: false; detail: string }> {
  const headers = await buildGitHubHeadersAsync(tokenRef)
  if (!headers) return { ok: false, detail: tokenRef ? `No GitHub Token configured for tokenRef: ${tokenRef}` : 'Missing GITHUB_TOKEN configuration' }

  const res = await fetch(`https://api.github.com${path}`, { headers, cache: 'no-store' })
  if (!res.ok) return { ok: false, detail: `GitHub API error: ${res.status}` }
  return { ok: true, data: await res.json() as T }
}

async function githubPost<T>(path: string, body: Record<string, unknown>, tokenRef?: string): Promise<{ ok: true; data: T } | { ok: false; detail: string }> {
  const headers = await buildGitHubHeadersAsync(tokenRef)
  if (!headers) return { ok: false, detail: tokenRef ? `No GitHub Token configured for tokenRef: ${tokenRef}` : 'Missing GITHUB_TOKEN configuration' }

  const res = await fetch(`https://api.github.com${path}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, detail: `GitHub API error: ${res.status}${text ? ` ${text}` : ''}` }
  }
  return { ok: true, data: await res.json() as T }
}

async function githubPatch<T>(path: string, body: Record<string, unknown>, tokenRef?: string): Promise<{ ok: true; data: T } | { ok: false; detail: string }> {
  const headers = await buildGitHubHeadersAsync(tokenRef)
  if (!headers) return { ok: false, detail: tokenRef ? `No GitHub Token configured for tokenRef: ${tokenRef}` : 'Missing GITHUB_TOKEN configuration' }

  const res = await fetch(`https://api.github.com${path}`, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, detail: `GitHub API error: ${res.status}${text ? ` ${text}` : ''}` }
  }
  return { ok: true, data: await res.json() as T }
}

function normalizeReviewState(state: string | null | undefined): string {
  return (state || 'UNKNOWN').toUpperCase()
}

function summarizeChecks(checkRuns: GitHubCheckRunApiItem[], combinedState: string | null): {
  ciPassed: boolean
  summary: string
  normalized: Array<{ name: string; status: string; conclusion: string | null }>
} {
  const normalized = checkRuns.map((run) => ({
    name: run.name || 'unnamed-check',
    status: (run.status || 'unknown').toLowerCase(),
    conclusion: run.conclusion || null
  }))

  if (normalized.length > 0) {
    const unfinished = normalized.filter((run) => run.status !== 'completed')
    if (unfinished.length > 0) {
      return {
        ciPassed: false,
        summary: `Incomplete checks: ${unfinished.map((run) => run.name).join(', ')}`,
        normalized
      }
    }

    const allowed = new Set(['success', 'neutral', 'skipped'])
    const failed = normalized.filter((run) => !allowed.has((run.conclusion || '').toLowerCase()))
    if (failed.length > 0) {
      return {
        ciPassed: false,
        summary: `Checks failed: ${failed.map((run) => `${run.name}:${run.conclusion || 'null'}`).join(', ')}`,
        normalized
      }
    }

    return {
      ciPassed: true,
      summary: `All ${normalized.length} checks passed`,
      normalized
    }
  }

  const status = (combinedState || '').toLowerCase()
  if (status === 'success') {
    return { ciPassed: true, summary: 'Combined status is success', normalized }
  }
  if (status) {
    return { ciPassed: false, summary: `combined status=${status}`, normalized }
  }
  return { ciPassed: false, summary: 'No GitHub checks/status found', normalized }
}

export function parseGitHubPrUrl(prUrl: string): GitHubPRInfo | null {
  const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i)
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    pullNumber: Number(match[3])
  }
}

export function parseGitHubRepoRef(repoRef: string): { owner: string; repo: string } | null {
  const trimmed = repoRef.trim()
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i)
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] }
  }

  const refMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (refMatch) {
    return { owner: refMatch[1], repo: refMatch[2] }
  }

  return null
}

export function extractTaskIdsFromMessage(message: string): string[] {
  const ids: string[] = []
  const patterns = [
    /task[:#\s-]*([a-zA-Z0-9-]{8,})/gi,
    /\[task[:#]([a-zA-Z0-9-]{8,})\]/gi
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(message)) !== null) {
      ids.push(match[1])
    }
  }
  return Array.from(new Set(ids))
}

export async function checkGitHubPrMerged(prUrl: string): Promise<{ merged: boolean; detail: string }> {
  const verification = await fetchGitHubPullRequestVerification(prUrl)
  return { merged: verification.merged, detail: verification.detail }
}

export async function fetchGitHubPullRequestVerification(prUrl: string, tokenRef?: string): Promise<GitHubPullRequestVerification> {
  const parsed = parseGitHubPrUrl(prUrl)
  if (!parsed) {
    return {
      merged: false,
      detail: 'Invalid PR URL',
      owner: '',
      repo: '',
      pullNumber: 0,
      prAuthor: null,
      mergeCommitSha: null,
      headSha: null,
      reviewApproved: false,
      reviewDecision: 'missing',
      reviewStates: [],
      ciPassed: false,
      checkSummary: 'Invalid PR URL',
      checkRuns: []
    }
  }

  const [prRes, reviewRes] = await Promise.all([
    githubGet<GitHubPullRequestApiResponse>(`/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`, tokenRef),
    githubGet<GitHubReviewApiItem[]>(`/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}/reviews`, tokenRef)
  ])

  if (!prRes.ok) {
    return {
      merged: false,
      detail: prRes.detail,
      owner: parsed.owner,
      repo: parsed.repo,
      pullNumber: parsed.pullNumber,
      prAuthor: null,
      mergeCommitSha: null,
      headSha: null,
      reviewApproved: false,
      reviewDecision: 'missing',
      reviewStates: [],
      ciPassed: false,
      checkSummary: prRes.detail,
      checkRuns: []
    }
  }

  const pr = prRes.data
  const reviewStates = reviewRes.ok ? reviewRes.data.map((item) => normalizeReviewState(item.state)) : []
  const reviewApproved = reviewStates.includes('APPROVED')
  const reviewDecision = reviewApproved
    ? 'approved'
    : reviewStates.length > 0
      ? `not-approved:${reviewStates.join(',')}`
      : reviewRes.ok
        ? 'missing'
        : `review-fetch-failed:${reviewRes.detail}`

  const refSha = pr.head?.sha || pr.merge_commit_sha || null
  let checkRuns: GitHubCheckRunApiItem[] = []
  let combinedState: string | null = null
  if (refSha) {
    const [checkRunsRes, combinedStatusRes] = await Promise.all([
      githubGet<{ check_runs?: GitHubCheckRunApiItem[] }>(`/repos/${parsed.owner}/${parsed.repo}/commits/${refSha}/check-runs`, tokenRef),
      githubGet<{ state?: string }>(`/repos/${parsed.owner}/${parsed.repo}/commits/${refSha}/status`, tokenRef)
    ])
    if (checkRunsRes.ok) checkRuns = checkRunsRes.data.check_runs || []
    if (combinedStatusRes.ok) combinedState = combinedStatusRes.data.state || null
  }

  const checkSummary = summarizeChecks(checkRuns, combinedState)
  return {
    merged: Boolean(pr.merged),
    detail: Boolean(pr.merged) ? 'PR is merged' : `PR not merged (state=${pr.state || 'unknown'})`,
    owner: parsed.owner,
    repo: parsed.repo,
    pullNumber: parsed.pullNumber,
    prAuthor: pr.user?.login?.toLowerCase() || null,
    mergeCommitSha: pr.merge_commit_sha || null,
    headSha: pr.head?.sha || null,
    reviewApproved,
    reviewDecision,
    reviewStates,
    ciPassed: checkSummary.ciPassed,
    checkSummary: checkSummary.summary,
    checkRuns: checkSummary.normalized
  }
}

export async function createGitHubIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  tokenRef?: string
): Promise<{ success: boolean; detail: string }> {
  const result = await githubPost<{ id?: number }>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    { body },
    tokenRef
  )
  return result.ok
    ? { success: true, detail: 'GitHub comment posted successfully' }
    : { success: false, detail: result.detail }
}

export async function createGitHubIssue(input: {
  owner: string
  repo: string
  title: string
  body: string
  labels?: string[]
  tokenRef?: string
}): Promise<{ success: true; issue: GitHubCreatedIssue } | { success: false; detail: string }> {
  const result = await githubPost<GitHubIssueApiResponse>(
    `/repos/${input.owner}/${input.repo}/issues`,
    {
      title: input.title,
      body: input.body,
      labels: input.labels || []
    },
    input.tokenRef
  )
  if (!result.ok) return { success: false, detail: result.detail }

  const issue = result.data
  if (!issue.id || !issue.number || !issue.html_url) {
    return { success: false, detail: 'GitHub issue created but response data is incomplete' }
  }
  return {
    success: true,
    issue: {
      issueId: issue.id,
      issueNumber: issue.number,
      htmlUrl: issue.html_url,
      title: issue.title || input.title,
      body: issue.body || input.body,
      state: issue.state || 'open'
    }
  }
}

export async function updateGitHubIssue(input: {
  owner: string
  repo: string
  issueNumber: number
  title?: string
  body?: string
  labels?: string[]
  tokenRef?: string
}): Promise<{ success: true; issue: GitHubCreatedIssue } | { success: false; detail: string }> {
  const payload: Record<string, unknown> = {}
  if (typeof input.title === 'string') payload.title = input.title
  if (typeof input.body === 'string') payload.body = input.body
  if (Array.isArray(input.labels)) payload.labels = input.labels
  if (Object.keys(payload).length === 0) {
    return { success: false, detail: 'No fields provided for update' }
  }

  const result = await githubPatch<GitHubIssueApiResponse>(
    `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`,
    payload,
    input.tokenRef
  )
  if (!result.ok) return { success: false, detail: result.detail }

  const issue = result.data
  if (!issue.id || !issue.number || !issue.html_url) {
    return { success: false, detail: 'GitHub issue updated but response data is incomplete' }
  }
  return {
    success: true,
    issue: {
      issueId: issue.id,
      issueNumber: issue.number,
      htmlUrl: issue.html_url,
      title: issue.title || input.title || '',
      body: issue.body || input.body || '',
      state: issue.state || 'open'
    }
  }
}

export function formatGitHubVerificationComment(input: {
  title: string
  summary?: string
  issueNumber?: number
  changes?: string[]
  rewardAmount?: number
  rewardToken?: string
  walletAddress?: string
  claimerGithubLogin?: string
  agentLabel?: string
  aiScore?: number
  aiGateDecision?: string
  ciPassed?: boolean
  reviewApproved?: boolean
  payoutReady?: boolean
  blockers?: string[]
  txHash?: string
}): string {
  const changes = input.changes && input.changes.length > 0
    ? input.changes
    : (input.summary ? input.summary.split(/\n+/).map((line) => line.trim()).filter(Boolean) : [])

  const lines = [
    '## Summary',
    input.issueNumber ? `Fixes #${input.issueNumber}` : input.title,
    '',
    input.summary ? input.summary : 'BountyPay has recorded this delivery and is awaiting further verification.',
    '',
    '## Changes',
    ...(changes.length > 0 ? changes.map((item) => `- ${item}`) : ['- Awaiting implementation details']),
    '',
    '## BountyPay Claim',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Bounty | ${input.rewardAmount ?? '-'} ${input.rewardToken || ''}`.trimEnd() + ' |',
    `| Wallet | ${input.walletAddress || '-'} |`,
    `| Claimer | ${input.claimerGithubLogin ? `@${input.claimerGithubLogin}` : '-'} |`,
    `| Agent | ${input.agentLabel || 'BountyPay'} |`,
    '',
    `> Auto payout: ${typeof input.payoutReady === 'boolean' ? (input.payoutReady ? 'ready on merge' : 'blocked') : 'pending'}`,
    `> CI: ${typeof input.ciPassed === 'boolean' ? (input.ciPassed ? 'pass' : 'block') : '-'}`,
    `> Review: ${typeof input.reviewApproved === 'boolean' ? (input.reviewApproved ? 'approved' : 'missing/block') : '-'}`,
    `> AI gate: ${input.aiGateDecision || '-'}`,
    `> AI score: ${input.aiScore ?? '-'}`,
  ]

  if (input.blockers && input.blockers.length > 0) {
    lines.push('', '### Blockers', ...input.blockers.map((item) => `- ${item}`))
  }
  if (input.txHash) {
    lines.push('', `TxHash: ${input.txHash}`)
  }

  return lines.filter((line, index, array) => line !== '' || (index > 0 && array[index - 1] !== '')).join('\n')
}

export function verifySimpleWebhookSecret(provided: string | null, expected: string | undefined): boolean {
  if (!expected) return true
  if (!provided) return false
  return provided === expected
}

export function verifyGitHubWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return true
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const digest = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(digest, 'utf8')
  const b = Buffer.from(signatureHeader, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface MeegleIssue {
  id: string
  title: string
  description: string
  labels: string[]
  assignee?: string
  requirementId?: string
  larkDocUrl?: string
  larkDocTitle?: string
  url?: string
}

function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []
  return labels
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'name' in item && typeof (item as { name: unknown }).name === 'string') {
        return (item as { name: string }).name
      }
      return ''
    })
    .filter(Boolean)
}

export async function fetchMeegleIssuesFromMcp(input?: {
  projectKey?: string
  workspaceId?: string
  viewUrl?: string
  token?: string
}): Promise<{ issues: MeegleIssue[]; detail: string }> {
  const url = process.env.MEEGLE_MCP_URL || 'https://meegle.com/mcp_server/v1'
  const token = input?.token || process.env.MEEGLE_MCP_TOKEN
  if (!token) return { issues: [], detail: 'Missing company Meegle MCP Token and global MEEGLE_MCP_TOKEN fallback' }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Mcp-Token': token
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'sync-meegle-issues',
      method: 'tools/list',
      params: {}
    })
  })

  if (!res.ok) {
    const text = await res.text()
    return { issues: [], detail: `MCP request failed: ${res.status} ${text}` }
  }

  const data = (await res.json()) as {
    result?: {
      tools?: Array<{ name?: string }>
      issues?: unknown[]
      data?: unknown[]
      content?: unknown[]
    }
  }
  const tools = data?.result?.tools || []
  const hasIssueListTool = tools.some((t) => t?.name === 'issues.list')
  const allowViewFallback = String(process.env.MEEGLE_ALLOW_VIEW_FALLBACK || '').trim().toLowerCase() === 'true'
  if (!hasIssueListTool && !allowViewFallback) {
    return {
      issues: [],
      detail: 'MCP does not provide issues.list and view link fallback is disabled. Please enable issues.list in Meegle MCP, or set MEEGLE_ALLOW_VIEW_FALLBACK=true only for emergency use.'
    }
  }

  if (hasIssueListTool) {
    const listRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'sync-meegle-issues-call',
        method: 'tools/call',
        params: {
          name: 'issues.list',
          arguments: {
            limit: 100,
            ...(input?.workspaceId ? { workspace_id: input.workspaceId } : {}),
            ...(input?.projectKey ? { project_key: input.projectKey } : {})
          }
        }
      })
    })
    if (listRes.ok) {
      const listData = (await listRes.json()) as { result?: { issues?: unknown[]; data?: unknown[]; content?: unknown[] } }
      const rawIssues = listData?.result?.issues || listData?.result?.data || listData?.result?.content || []
      if (Array.isArray(rawIssues)) {
        const issues: MeegleIssue[] = []
        for (const raw of rawIssues) {
          if (!raw || typeof raw !== 'object') continue
          const obj = raw as Record<string, unknown>
          const id = String(obj.issueId || obj.id || '')
          if (!id) continue
          issues.push({
            id,
            title: String(obj.title || 'Meegle External Bounty Task'),
            description: String(obj.description || obj.content || ''),
            labels: normalizeLabels(obj.labels),
            assignee: typeof obj.assignee === 'string' ? obj.assignee : undefined,
            requirementId: extractRequirementIdCandidate(String(obj.title || ''), String(obj.description || obj.content || '')),
            larkDocUrl: extractLarkDocUrlCandidate(String(obj.description || obj.content || '')),
            larkDocTitle: typeof obj.title === 'string' ? obj.title : undefined,
            url: typeof obj.url === 'string' ? obj.url : undefined
          })
        }
        return { issues, detail: `MCP issues.list sync successful, ${issues.length} items retrieved` }
      }
    }
  }

  // Optional fallback: use get_view_detail only when explicitly enabled.
  if (!allowViewFallback) {
    return {
      issues: [],
      detail: 'issues.list is available but returned no parseable issues. View link fallback is currently disabled. Please check Meegle MCP issues.list permissions/parameters first.'
    }
  }

  const viewUrl = input?.viewUrl
    || (input?.workspaceId && input?.projectKey ? `https://meegle.com/${input.workspaceId}/storyView/${input.projectKey}` : undefined)
    || process.env.MEEGLE_MCP_VIEW_URL
  if (!viewUrl) {
    return {
      issues: [],
      detail: 'View fallback is enabled but no view URL is available. Please configure MEEGLE_MCP_VIEW_URL, or disable fallback and fix issues.list.'
    }
  }
  const viewRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'sync-meegle-view-call',
      method: 'tools/call',
      params: {
        name: 'get_view_detail',
        arguments: { url: viewUrl, page_num: 1 }
      }
    })
  })
  if (!viewRes.ok) return { issues: [], detail: `get_view_detail call failed: ${viewRes.status}` }
  const viewData = (await viewRes.json()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }
  const text = viewData?.result?.content?.map((x) => x.text || '').join('\n') || ''
  if (viewData?.result?.isError) return { issues: [], detail: `get_view_detail returned an error: ${text}` }
  const parsed = parseIssuesFromViewText(text)
  return { issues: parsed, detail: `MCP get_view_detail sync successful, ${parsed.length} items retrieved` }
}

export async function updateMeegleIssueStatusByMcp(
  issueId: string,
  toStatus: 'in_progress' | 'resolved',
  options?: { token?: string }
): Promise<{ success: boolean; detail: string }> {
  return updateMeegleIssueFieldsByMcp(issueId, [
    {
      field_key: process.env.MEEGLE_STATUS_FIELD_KEY || 'status',
      field_value: toStatus === 'resolved'
        ? (process.env.MEEGLE_STATUS_RESOLVED_VALUE || 'resolved')
        : (process.env.MEEGLE_STATUS_IN_PROGRESS_VALUE || 'in_progress')
    }
  ], options)
}

export async function updateMeegleIssueFieldsByMcp(
  issueId: string,
  fields: Array<{ field_key: string; field_value: string | number | boolean }>,
  options?: { token?: string }
): Promise<{ success: boolean; detail: string }> {
  const url = process.env.MEEGLE_MCP_URL || 'https://meegle.com/mcp_server/v1'
  const token = options?.token || process.env.MEEGLE_MCP_TOKEN
  if (!token) return { success: false, detail: 'Missing company Meegle MCP Token and global MEEGLE_MCP_TOKEN fallback' }
  if (!fields.length) return { success: true, detail: 'No fields to write back' }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Mcp-Token': token
  }

  const projectKey = process.env.MEEGLE_PROJECT_KEY
  const args: Record<string, unknown> = {
    work_item_id: issueId,
    fields
  }
  if (projectKey) args.project_key = projectKey

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `update-meegle-${issueId}`,
      method: 'tools/call',
      params: {
        name: 'update_field',
        arguments: args
      }
    })
  })
  if (!res.ok) return { success: false, detail: `Meegle status write-back failed: ${res.status}` }
  const data = await res.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }
  const text = data?.result?.content?.map((x) => x.text || '').join('\n') || ''
  if (data?.result?.isError) return { success: false, detail: text || 'Meegle status write-back returned an error' }
  return { success: true, detail: text || `Fields written back: ${fields.map((item) => item.field_key).join(', ')}` }
}

function parseIssuesFromViewText(text: string): MeegleIssue[] {
  const lines = text.split('\n')
  const issues: MeegleIssue[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (trimmed.includes('Name') && trimmed.includes('Work Item ID')) continue
    if (trimmed.includes('---')) continue
    const cells = trimmed
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean)
    if (cells.length < 2) continue
    let id = ''
    let title = ''
    if (/^\d+$/.test(cells[0])) {
      id = cells[0]
      title = cells[1]
    } else if (/^\d+$/.test(cells[1])) {
      id = cells[1]
      title = cells[0]
    } else {
      continue
    }
    issues.push({
      id,
      title,
      description: '',
      labels: ['internal-task']
    })
  }
  return issues
}
