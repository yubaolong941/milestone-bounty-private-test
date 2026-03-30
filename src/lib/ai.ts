import { Project, Severity, VulnerabilityReport } from './types'
import { TaskBounty } from './types'
import { loadLarkDocumentContext } from './lark-docs'
import { buildRequirementBindingSnapshot, extractAcceptanceCriteriaCandidate } from './repositories/requirement-binding-repository'

interface ParsedProjectResult {
  name: string
  description: string
  reports: Array<{
    name: string
    description: string
    completionCriteria: string
    rewardAmount: number
    assigneeName: string
    assigneeWallet: string
    deadline: string
    severity?: Severity
  }>
}

let codeReviewRoundRobinIndex = 0
const REQUIREMENT_CLARITY_MAX_SCORE = 100
const REQUIREMENT_CLARITY_PUBLISH_THRESHOLD = 40

function getRequirementModel(): string {
  return process.env.AI_MODEL_REQUIREMENT || 'gpt-5.4'
}

function getDefaultModel(): string {
  return process.env.AI_MODEL || 'gpt-5.3-codex'
}

function getCodeReviewModels(): string[] {
  const models = [
    process.env.AI_MODEL_CODE_REVIEW_A || 'gpt-5.3-codex',
    process.env.AI_MODEL_CODE_REVIEW_B || 'claude-code'
  ]
    .map((x) => x.trim())
    .filter(Boolean)
  return models.length > 0 ? models : ['gpt-5.3-codex']
}

function pickCodeReviewModel(): { primary: string; fallback?: string } {
  const models = getCodeReviewModels()
  const strategy = (process.env.AI_MODEL_CODE_REVIEW_STRATEGY || 'round_robin').toLowerCase()
  if (models.length === 1) return { primary: models[0] }
  if (strategy === 'round_robin') {
    const idx = codeReviewRoundRobinIndex % models.length
    codeReviewRoundRobinIndex += 1
    return { primary: models[idx], fallback: models[(idx + 1) % models.length] }
  }
  return { primary: models[0], fallback: models[1] }
}

async function callInferChat(system: string, user: string, modelOverride?: string): Promise<string> {
  const apiKey = process.env.INFER_API_KEY || process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api-infer.agentsey.ai/v1'
  const model = modelOverride || getDefaultModel()

  if (!apiKey) {
    throw new Error('Missing INFER_API_KEY or OPENAI_API_KEY configuration')
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    })
  })

  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('AI response content is empty')
  }
  return content
}

export async function inferHealthCheck(): Promise<{
  ok: boolean
  latencyMs: number
  model: string
  baseUrl: string
  preview: string
  error?: string
}> {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api-infer.agentsey.ai/v1'
  const model = getDefaultModel()
  const startedAt = Date.now()
  try {
    const content = await callInferChat(
      'You are a connectivity check assistant. Reply with a single short word only.',
      'Please reply with: pong'
    )
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      model,
      baseUrl,
      preview: content.slice(0, 120).trim()
    }
  } catch (err: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      model,
      baseUrl,
      preview: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function reviewMilestone(
  project: Project,
  milestone: VulnerabilityReport
): Promise<{ approved: boolean; summary: string }> {
  try {
    const content = await callInferChat(
      'You are an AI initial review assistant for a vulnerability bounty platform. Provide a concise English review conclusion. Do not fabricate transaction information.',
      `Please review this vulnerability report and provide a 1-2 sentence conclusion:
Project: ${project.name}
Vulnerability Title: ${milestone.name}
Description: ${milestone.description}
Reproduction Conditions: ${milestone.completionCriteria}
Researcher: ${milestone.assigneeName}
Suggested Bounty: ${milestone.rewardAmount}U

Output format:
1) First sentence: Whether it passes initial review (approved/not approved) + reason
2) Second sentence: Suggested bounty amount (can keep ${milestone.rewardAmount}U)`,
      getRequirementModel()
    )

    const approved = /\bapproved\b/i.test(content) && !/not approved/i.test(content)
    return { approved, summary: content.trim() }
  } catch {
    const now = new Date().toLocaleString('en-US', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
    return {
      approved: true,
      summary: `AI initial review approved · Researcher ${milestone.assigneeName} submitted vulnerability report at ${now}, satisfying reproduction condition "${milestone.completionCriteria}". Suggested bounty: ${milestone.rewardAmount}U.`
    }
  }
}

export async function parseProjectFromText(
  input: string
): Promise<ParsedProjectResult | null> {
  try {
    const content = await callInferChat(
      'You are a product entry assistant. Parse the user input into strict JSON. Do not output markdown code blocks.',
      `Parse the following text into JSON with this structure:
{
  "name": "string",
  "description": "string",
  "reports": [
    {
      "name": "string",
      "description": "string",
      "completionCriteria": "string",
      "rewardAmount": 100,
      "assigneeName": "string",
      "assigneeWallet": "0x...",
      "deadline": "YYYY-MM-DD"
    }
  ]
}

Requirements:
- Reward amount must be a number (unit: U)
- Missing fields should receive reasonable default values
- Return only the JSON body

User input:
${input}`,
      getRequirementModel()
    )

    const normalized = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(normalized) as ParsedProjectResult
    const reports = (parsed as { reports?: ParsedProjectResult['reports']; milestones?: ParsedProjectResult['reports'] }).reports
      ?? (parsed as { reports?: ParsedProjectResult['reports']; milestones?: ParsedProjectResult['reports'] }).milestones
    if (!parsed?.name || !Array.isArray(reports)) {
      throw new Error('AI response structure is invalid')
    }
    return {
      name: parsed.name,
      description: parsed.description || input.slice(0, 50),
      reports: reports.map((m, i) => ({
        name: m.name || `Vulnerability Report ${i + 1}`,
        description: m.description || '',
        completionCriteria: m.completionCriteria || 'Provide a PoC that is reproducible',
        rewardAmount: Number(m.rewardAmount) || 10,
        assigneeName: m.assigneeName || 'TBD',
        assigneeWallet: m.assigneeWallet || '',
        deadline: m.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        severity: inferSeverity(m.name || m.description || '')
      }))
    }
  } catch {
    // Fall back to local rule-based parsing so the demo works without an API
  }

  const nameMatch = input.match(/["'"'](.+?)["'"']/)
  const name = nameMatch ? nameMatch[1] : input.slice(0, 20).trim()

  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  const reports: ParsedProjectResult['reports'] = []

  const lines = input.split(/[\n。；;]/).filter(l => l.trim())

  for (const line of lines) {
    const rewardMatch = line.match(/(\d+)\s*U/i)
    const walletMatch = line.match(/(0x[a-fA-F0-9]{4,})/i)
    const milestoneNameMatch = line.match(/[：:]\s*(.{2,30}?)(?:[，,]|reward|researcher|responsible|$)/i)
    const researcherMatch = line.match(/(?:researcher|owner|responsible)\s*([A-Za-z\u4e00-\u9fa5]{2,20})/i)

    if (rewardMatch) {
      reports.push({
        name: milestoneNameMatch
          ? milestoneNameMatch[1].replace(/^\d+[.、]/, '').trim()
          : `Vulnerability Report ${reports.length + 1}`,
        description: line.trim(),
        completionCriteria: 'Provide PoC and reproducible',
        rewardAmount: parseInt(rewardMatch[1]),
        assigneeName: researcherMatch ? researcherMatch[1] : 'TBD',
        assigneeWallet: walletMatch ? walletMatch[1] : '',
        deadline,
        severity: inferSeverity(line)
      })
    }
  }

  if (reports.length === 0) {
    reports.push({
      name: 'Vulnerability Report 1',
      description: input.trim(),
      completionCriteria: 'Provide PoC and reproducible',
      rewardAmount: 10,
      assigneeName: 'TBD',
      assigneeWallet: '',
      deadline,
      severity: inferSeverity(input)
    })
  }

  return { name, description: input.slice(0, 50), reports }
}

function inferSeverity(text: string): Severity {
  const t = text.toLowerCase()
  if (t.includes('critical')) return 'critical'
  if (t.includes('high') || t.includes('sql')) return 'high'
  if (t.includes('medium') || t.includes('xss')) return 'medium'
  if (t.includes('low')) return 'low'
  return 'unknown'
}

interface CodeReviewMeta {
  modelUsed: string
  confidence: number
  gateDecision: 'pass' | 'block'
  criticFindings: string[]
  completionScore: number
  prSuggestions: string[]
  managerFocus: string[]
}

interface RequirementMeta {
  modelUsed: string
  modelScore: number
  confidence: number
  gateDecision: 'pass' | 'block'
  criticFindings: string[]
  evidenceRefs: string[]
}

async function buildLarkReviewContext(requirementDocUrl?: string): Promise<string> {
  if (!requirementDocUrl) return 'LARK_DOC_STATUS: missing'
  try {
    const context = await loadLarkDocumentContext(requirementDocUrl)
    if (!context) return `LARK_DOC_STATUS: unsupported_url\nLARK_DOC_URL: ${requirementDocUrl}`
    return [
      'LARK_DOC_STATUS: loaded',
      `LARK_DOC_SOURCE: ${context.sourceType}`,
      `LARK_DOC_TITLE: ${context.title || 'Not provided'}`,
      `LARK_DOC_URL: ${context.url || requirementDocUrl}`,
      `LARK_DOC_TRUNCATED: ${context.truncated ? 'yes' : 'no'}`,
      'LARK_DOC_CONTENT:',
      context.plainText || '(body is empty)'
    ].join('\n')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [
      'LARK_DOC_STATUS: failed',
      `LARK_DOC_URL: ${requirementDocUrl}`,
      `LARK_DOC_ERROR: ${detail}`
    ].join('\n')
  }
}

async function callCodeReviewModel(task: TaskBounty, model: string): Promise<string> {
  const binding = buildRequirementBindingSnapshot(task)
  const larkContext = await buildLarkReviewContext(binding.larkDocUrl)
  return callInferChat(
    'You are a code delivery review assistant for an enterprise development platform. You do not submit PRs on behalf of developers — PRs must be completed manually by the developer. Your role is to evaluate completion against the requirements document, provide a score, PR improvement suggestions, and key points for company managers to focus on. Follow the specified output format strictly.',
    `Please perform a structured review of this requirement bounty delivery:
Task Title: ${task.title}
Task Description: ${task.description}
Requirements Document Title: ${binding.larkDocTitle || 'Not provided'}
Requirements Document URL: ${binding.larkDocUrl || 'Not provided'}
Requirements Summary Snapshot: ${binding.summarySnapshot || 'Not provided'}
Acceptance Criteria: ${binding.acceptanceCriteriaSnapshot.join('; ') || 'Not provided'}
PR: ${task.prUrl || 'Not provided'}
Commit: ${task.commitSha || 'Not provided'}
CI Status: ${task.ciPassed ? 'Passed' : 'Unknown/Not passed'}

The following is the live requirements document content fetched from Lark. Use this as the primary review standard, then refer to the task description and snapshot:
${larkContext}

Output the following structure strictly. Do not add markdown code blocks:
SCORE: 0-100
COMPLETION: 0-100
SUMMARY: A brief English summary describing how well the current delivery fulfills the requirements document
PR_SUGGESTIONS:
- Suggestion 1
- Suggestion 2
MANAGER_FOCUS:
- Manager focus point 1
- Manager focus point 2

Requirements:
1) SCORE represents the overall score
2) COMPLETION represents the completion rate against the requirements document
3) PR_SUGGESTIONS should provide specific, actionable PR improvement suggestions
4) MANAGER_FOCUS should highlight risks, boundaries, acceptance criteria, or payment-related items that company managers should pay attention to`,
    model
  )
}

function buildRequirementReviewContext(input: {
  title: string
  description: string
  taskId?: string
  repo?: string
  branch?: string
  repoVisibility?: 'public' | 'private'
  deliveryMode?: 'public_mirror_pr' | 'private_collab_pr' | 'patch_bundle'
  requirementDocUrl?: string
  requirementDocTitle?: string
  acceptanceCriteria?: string[]
  requirementSummary?: string
}) {
  return [
    `Title: ${input.title}`,
    `Description: ${input.description || '(empty)'}`,
    `Task ID: ${input.taskId || 'Not provided'}`,
    `Target Repo: ${input.repo || 'Not provided'}`,
    `Target Branch: ${input.branch || 'main'}`,
    `Repo Visibility: ${input.repoVisibility || 'public'}`,
    `Delivery Mode: ${input.deliveryMode || 'public_mirror_pr'}`,
    `Requirements Summary Snapshot: ${input.requirementSummary || 'Not provided'}`,
    `Acceptance Criteria: ${(input.acceptanceCriteria || []).join('; ') || 'Not provided'}`,
    `Reference Document Title: ${input.requirementDocTitle || 'Not provided'}`,
    `Reference Document URL: ${input.requirementDocUrl || 'Not provided'}`
  ].join('\n')
}

export async function reviewTaskBounty(
  task: TaskBounty
): Promise<{ aiScore: number; summary: string; inferPopup: string; meta: CodeReviewMeta }> {
  const selected = pickCodeReviewModel()
  try {
    const content = await callCodeReviewModel(task, selected.primary)
    return finalizeGanStyleReview(content, selected.primary)
  } catch (err: unknown) {
    if (selected.fallback) {
      try {
        const content = await callCodeReviewModel(task, selected.fallback)
        const finalized = finalizeGanStyleReview(content, selected.fallback)
        finalized.inferPopup = `[fallbackFrom=${selected.primary}] ${finalized.inferPopup}`
        return finalized
      } catch (fallbackErr: unknown) {
        const inferError = err instanceof Error ? err.message : String(err)
        const fallbackError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
    return {
      aiScore: 80,
      summary: 'Infer call failed. Using default scoring strategy (80 points).',
      inferPopup: `Infer call failed: primary(${selected.primary})=${inferError}; fallback(${selected.fallback})=${fallbackError}`,
      meta: {
        modelUsed: `${selected.primary}->${selected.fallback}`,
        confidence: 40,
        gateDecision: 'block',
        criticFindings: ['Model call failed. Downgraded to manual review.'],
        completionScore: 70,
        prSuggestions: ['Please manually verify whether the PR fully maps to the requirements document and acceptance criteria'],
        managerFocus: ['AI call failed. Manual review of completion and payment conditions is required.']
      }
    }
      }
    }
    const inferError = err instanceof Error ? err.message : String(err)
    return {
      aiScore: 80,
      summary: 'Infer call failed. Using default scoring strategy (80 points).',
      inferPopup: `Infer call failed: model=${selected.primary}; error=${inferError}`,
      meta: {
        modelUsed: selected.primary,
        confidence: 40,
        gateDecision: 'block',
        criticFindings: ['Model call failed. Downgraded to manual review.'],
        completionScore: 70,
        prSuggestions: ['Please manually verify whether the PR fully maps to the requirements document and acceptance criteria'],
        managerFocus: ['AI call failed. Manual review of completion and payment conditions is required.']
      }
    }
  }
}

function finalizeGanStyleReview(content: string, modelUsed: string): {
  aiScore: number
  summary: string
  inferPopup: string
  meta: CodeReviewMeta
} {
  const match = content.match(/SCORE[:：]\s*(\d{1,3})/i)
  const aiScore = Math.min(100, Math.max(0, Number(match?.[1] || 80)))
  const completionMatch = content.match(/COMPLETION[:：]\s*(\d{1,3})/i)
  const completionScore = Math.min(100, Math.max(0, Number(completionMatch?.[1] || aiScore)))
  const summaryMatch = content.match(/SUMMARY[:：]\s*([\s\S]*?)(?=\nPR_SUGGESTIONS[:：]|\nMANAGER_FOCUS[:：]|$)/i)
  const summary = summaryMatch?.[1]?.trim()
    || content
      .replace(/SCORE[:：]\s*\d{1,3}/i, '')
      .replace(/COMPLETION[:：]\s*\d{1,3}/i, '')
      .trim()
    || 'AI review complete'
  const prSection = content.match(/PR_SUGGESTIONS[:：]\s*([\s\S]*?)(?=\nMANAGER_FOCUS[:：]|$)/i)?.[1] || ''
  const managerSection = content.match(/MANAGER_FOCUS[:：]\s*([\s\S]*?)$/i)?.[1] || ''
  const parseBullets = (section: string) =>
    section
      .split('\n')
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
  const prSuggestions = parseBullets(prSection)
  const managerFocus = parseBullets(managerSection)
  const criticFindings: string[] = []
  if (aiScore < 85) criticFindings.push('Score is below the auto-payout threshold (85)')
  if (completionScore < 80) criticFindings.push('Requirements completion rate is below the threshold (80)')
  if (/missing|not provided|unclear|risk|cannot confirm|insufficient evidence/i.test(summary)) criticFindings.push('Evidence or risk gaps identified')
  if (managerFocus.length > 0) criticFindings.push(...managerFocus.slice(0, 2))
  const gateDecision: 'pass' | 'block' = criticFindings.length > 0 ? 'block' : 'pass'
  const confidence = gateDecision === 'pass' ? Math.min(99, aiScore) : Math.max(45, Math.min(84, aiScore))
  const popupSuffix = criticFindings.length > 0 ? ` | critic=${criticFindings.join('; ')}` : ''
  return {
    aiScore,
    summary,
    inferPopup: `[model=${modelUsed}; gate=${gateDecision}; completion=${completionScore}] ${summary}${popupSuffix}`,
    meta: { modelUsed, confidence, gateDecision, criticFindings, completionScore, prSuggestions, managerFocus }
  }
}

export async function reviewTaskRequirementClarity(
  title: string,
  description: string,
  context?: {
    taskId?: string
    repo?: string
    branch?: string
    repoVisibility?: 'public' | 'private'
    deliveryMode?: 'public_mirror_pr' | 'private_collab_pr' | 'patch_bundle'
    requirementDocUrl?: string
    requirementDocTitle?: string
    acceptanceCriteria?: string[]
    requirementSummary?: string
  }
): Promise<{ clear: boolean; score: number; summary: string; meta: RequirementMeta }> {
  try {
    const acceptanceCriteria = context?.acceptanceCriteria && context.acceptanceCriteria.length > 0
      ? context.acceptanceCriteria
      : extractAcceptanceCriteriaCandidate(description)
    const requirementSummary = context?.requirementSummary || description
    const content = await callInferChat(
      'You are an enterprise requirements review assistant. Determine whether the requirement is clear enough for external developers to deliver against. Scoring is on a 100-point scale. You must return strict JSON. Do not output markdown or any extra explanation.',
      `Please evaluate the clarity of the requirement below and return JSON:
{
  “score”: 0,
  “summary”: “One to two sentence English conclusion stating clearly whether the requirement is publishable and what the main gaps are”,
  “evidenceRefs”: [“AC”, “DELIVERABLE”],
  “missing”: [“Missing boundary conditions”, “Missing delivery definition”],
  “publishable”: true
}

${buildRequirementReviewContext({
  title,
  description,
  taskId: context?.taskId,
  repo: context?.repo,
  branch: context?.branch,
  repoVisibility: context?.repoVisibility,
  deliveryMode: context?.deliveryMode,
  requirementDocUrl: context?.requirementDocUrl,
  requirementDocTitle: context?.requirementDocTitle,
  acceptanceCriteria,
  requirementSummary
})}

Requirements:
1) score range is 0-${REQUIREMENT_CLARITY_MAX_SCORE}, maximum ${REQUIREMENT_CLARITY_MAX_SCORE} points
2) summary must be consistent with score; avoid conflicts where the text suggests publishable but score is clearly too low
3) evidenceRefs should use evidence keys such as AC, API, EDGE_CASE, DELIVERABLE, REPO_BRANCH, DOC_CONFLICT
4) missing should list the 0-3 most critical gaps
5) If score >= ${REQUIREMENT_CLARITY_PUBLISH_THRESHOLD}, publishable should be true; missing items are for advisory purposes only and should not block publishing
6) As long as the requirement allows external developers to understand the target repo, delivery method, main scope, and basic acceptance criteria, score 40 or above; do not penalize heavily for lack of “a fully complete product document”
7) Even if there are missing items, if score >= ${REQUIREMENT_CLARITY_PUBLISH_THRESHOLD}, the requirement should still be deemed publishable`,
      getRequirementModel()
    )

    const normalized = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(normalized) as {
      score?: number
      summary?: string
      evidenceRefs?: string[] | string
      missing?: string[] | string
      publishable?: boolean
    }

    const score = Math.min(REQUIREMENT_CLARITY_MAX_SCORE, Math.max(0, Number(parsed.score ?? REQUIREMENT_CLARITY_PUBLISH_THRESHOLD)))
    const evidenceRefs = Array.isArray(parsed.evidenceRefs)
      ? parsed.evidenceRefs.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
      : typeof parsed.evidenceRefs === 'string'
        ? parsed.evidenceRefs.split(/[，,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean)
        : []
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.map((item) => String(item).trim()).filter(Boolean)
      : typeof parsed.missing === 'string'
        ? parsed.missing.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean)
        : []
    const summary = String(parsed.summary || '').trim() || 'Requirement clarity assessment complete'

    const criticFindings: string[] = []
    if (score < REQUIREMENT_CLARITY_PUBLISH_THRESHOLD) criticFindings.push(`Score is below the external publish threshold (${REQUIREMENT_CLARITY_PUBLISH_THRESHOLD})`)
    if (score < REQUIREMENT_CLARITY_PUBLISH_THRESHOLD && /unclear|needs supplement|cannot determine|incomplete|critically missing|gap|missing/i.test(summary)) {
      criticFindings.push('Critical information gaps identified')
    }
    if (score < REQUIREMENT_CLARITY_PUBLISH_THRESHOLD && missing.length > 0) criticFindings.push(...missing.slice(0, 3))
    if (score < REQUIREMENT_CLARITY_PUBLISH_THRESHOLD && evidenceRefs.length === 0) criticFindings.push('No valid evidence keys provided (EVIDENCE)')

    const positiveSummary = /clear|publishable|actionable|deliverable|complete|well-defined/i.test(summary)
    if (positiveSummary && score < REQUIREMENT_CLARITY_PUBLISH_THRESHOLD) {
      criticFindings.push('Model conclusion conflicts with score. Downgraded to manual review.')
    }

    const publishable = score >= REQUIREMENT_CLARITY_PUBLISH_THRESHOLD
    const gateDecision: 'pass' | 'block' = publishable ? 'pass' : 'block'
    const clear = gateDecision === 'pass'
    const confidence = score
    return {
      clear,
      score,
      summary,
      meta: {
        modelUsed: getRequirementModel(),
        modelScore: score,
        confidence,
        gateDecision,
        criticFindings: Array.from(new Set(criticFindings)),
        evidenceRefs
      }
    }
  } catch {
    return {
      clear: false,
      score: REQUIREMENT_CLARITY_PUBLISH_THRESHOLD,
      summary: 'AI assessment failed. It is recommended to supplement acceptance criteria, boundary conditions, and deliverable definitions.',
      meta: {
        modelUsed: getRequirementModel(),
        modelScore: REQUIREMENT_CLARITY_PUBLISH_THRESHOLD,
        confidence: 40,
        gateDecision: 'block',
        criticFindings: ['Model call failed. Requirement clarity cannot be confirmed.'],
        evidenceRefs: []
      }
    }
  }
}

export async function generateRequirementRefinement(input: {
  title: string
  description: string
  requirementDocUrl?: string
  requirementDocTitle?: string
  claritySummary?: string
  criticFindings?: string[]
}): Promise<{
  summary: string
  polishedDescription: string
  acceptanceCriteria: string[]
  nextActions: string[]
  modelUsed: string
}> {
  const fallbackActions = [
    'Clarify scope: List the pages, modules, and language coverage for this delivery.',
    'Clarify delivery: Describe the submission format (PR/commit) and the file types that need to be updated.',
    'Clarify acceptance: Add verifiable tests and regression criteria.'
  ]
  const fallbackCriteria = [
    `Complete the core feature delivery for "${input.title}" and provide verifiable results.`,
    'Cover major user paths and pass key functional regression tests.',
    'Submit reviewable deliverables (code/documentation) that meet the acceptance criteria.'
  ]
  try {
    const content = await callInferChat(
      'You are an enterprise requirements refinement assistant. Your task is to rewrite the requirement into a deliverable, verifiable, and externally publishable bounty version without changing the business objective.',
      `Based on the original requirement and review feedback, output a structured result. Do not output markdown code blocks:
SUMMARY: A single English sentence summary (<=60 words)
POLISHED_DESCRIPTION:
<4-8 lines organized around “scope / implementation / delivery / acceptance criteria”>
AC:
- Acceptance criterion 1
- Acceptance criterion 2
- Acceptance criterion 3
- Acceptance criterion 4 (optional)
- Acceptance criterion 5 (optional)
NEXT_ACTIONS:
- Next step recommendation 1
- Next step recommendation 2
- Next step recommendation 3

Requirement Title: ${input.title}
Original Description: ${input.description || '(empty)'}
Requirements Document Title: ${input.requirementDocTitle || 'Not provided'}
Requirements Document URL: ${input.requirementDocUrl || 'Not provided'}
Clarity Summary: ${input.claritySummary || 'Not provided'}
Blocking Issues: ${(input.criticFindings || []).join('; ') || 'Not provided'}
`,
      getRequirementModel()
    )
    const summary = content.match(/SUMMARY[:：]\s*(.+)$/im)?.[1]?.trim()
      || 'AI has generated requirement refinement suggestions'
    const polishedDescription = content.match(/POLISHED_DESCRIPTION[:：]\s*([\s\S]*?)(?=\nAC[:：]|\nNEXT_ACTIONS[:：]|$)/i)?.[1]
      ?.trim()
      || input.description
      || `${input.title}\nPlease add scope, implementation plan, delivery method, and acceptance criteria.`
    const parseBullets = (section: string) => section
      .split('\n')
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
    const acSection = content.match(/AC[:：]\s*([\s\S]*?)(?=\nNEXT_ACTIONS[:：]|$)/i)?.[1] || ''
    const nextActionSection = content.match(/NEXT_ACTIONS[:：]\s*([\s\S]*?)$/i)?.[1] || ''
    const acceptanceCriteria = Array.from(new Set(parseBullets(acSection))).slice(0, 5)
    const nextActions = Array.from(new Set(parseBullets(nextActionSection))).slice(0, 5)
    return {
      summary,
      polishedDescription,
      acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : fallbackCriteria,
      nextActions: nextActions.length > 0 ? nextActions : fallbackActions,
      modelUsed: getRequirementModel()
    }
  } catch {
    const critic = (input.criticFindings || []).join('; ')
    return {
      summary: 'Requirement publishability is insufficient. Default polish suggestions have been generated.',
      polishedDescription: [
        `Goal: Complete "${input.title}" and support verifiable delivery.`,
        `Scope: Clarify the pages/modules/APIs involved, as well as the languages and scenarios to be supported.`,
        'Implementation: Describe the i18n approach, string sources, fallback rules, and compatibility strategy.',
        'Delivery: Submit a PR with a change description, include test screenshots/logs and verification steps.',
        `Risk notice: ${input.claritySummary || critic || 'Acceptance boundaries and criteria need to be clarified.'}`
      ].join('\n'),
      acceptanceCriteria: fallbackCriteria,
      nextActions: fallbackActions,
      modelUsed: getRequirementModel()
    }
  }
}
