import { Project, Severity, VulnerabilityReport } from './types'
import { TaskBounty } from './types'

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
    throw new Error('未配置 INFER_API_KEY 或 OPENAI_API_KEY')
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
    throw new Error(`AI 请求失败: ${res.status}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('AI 返回内容为空')
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
      '你是连通性检查助手。只回答一个短词。',
      '请只回复：pong'
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
      '你是漏洞赏金平台的 AI 初审助手。请给出简洁中文审核结论，不要编造交易信息。',
      `请审核这条漏洞报告并给出 1-2 句结论：
项目：${project.name}
漏洞标题：${milestone.name}
描述：${milestone.description}
复现条件：${milestone.completionCriteria}
研究员：${milestone.assigneeName}
建议赏金：${milestone.rewardAmount}U

输出格式要求：
1）第一句：是否通过初审（通过/不通过）+ 原因
2）第二句：建议赏金额度（可沿用 ${milestone.rewardAmount}U）`,
      getRequirementModel()
    )

    const approved = /通过/.test(content) && !/不通过/.test(content)
    return { approved, summary: content.trim() }
  } catch {
    const now = new Date().toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
    return {
      approved: true,
      summary: `AI 初审通过 · 研究员 ${milestone.assigneeName} 于 ${now} 提交漏洞报告，满足复现条件「${milestone.completionCriteria}」，建议按 ${milestone.rewardAmount}U 发放赏金。`
    }
  }
}

export async function parseProjectFromText(
  input: string
): Promise<ParsedProjectResult | null> {
  try {
    const content = await callInferChat(
      '你是产品录入助手。把用户输入解析为严格 JSON，不要输出 markdown 代码块。',
      `将下面文本解析成 JSON，结构如下：
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

要求：
- 奖励金额必须是数字（单位 U）
- 缺失字段要给合理默认值
- 仅返回 JSON 本体

用户输入：
${input}`,
      getRequirementModel()
    )

    const normalized = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(normalized) as ParsedProjectResult
    const reports = (parsed as { reports?: ParsedProjectResult['reports']; milestones?: ParsedProjectResult['reports'] }).reports
      ?? (parsed as { reports?: ParsedProjectResult['reports']; milestones?: ParsedProjectResult['reports'] }).milestones
    if (!parsed?.name || !Array.isArray(reports)) {
      throw new Error('AI 结构不合法')
    }
    return {
      name: parsed.name,
      description: parsed.description || input.slice(0, 50),
      reports: reports.map((m, i) => ({
        name: m.name || `漏洞报告 ${i + 1}`,
        description: m.description || '',
        completionCriteria: m.completionCriteria || '提供 PoC 且可复现',
        rewardAmount: Number(m.rewardAmount) || 10,
        assigneeName: m.assigneeName || '待指定',
        assigneeWallet: m.assigneeWallet || '',
        deadline: m.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        severity: inferSeverity(m.name || m.description || '')
      }))
    }
  } catch {
    // 回退到本地规则解析，确保无 API 时也可演示
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
    const milestoneNameMatch = line.match(/[：:]\s*(.{2,30}?)(?:[，,]|奖励|研究员|负责|$)/)
    const researcherMatch = line.match(/(?:研究员|负责人)\s*([A-Za-z\u4e00-\u9fa5]{2,20})/)

    if (rewardMatch) {
      reports.push({
        name: milestoneNameMatch
          ? milestoneNameMatch[1].replace(/^\d+[.、]/, '').trim()
          : `漏洞报告 ${reports.length + 1}`,
        description: line.trim(),
        completionCriteria: '提供 PoC 且可复现',
        rewardAmount: parseInt(rewardMatch[1]),
        assigneeName: researcherMatch ? researcherMatch[1] : '待指定',
        assigneeWallet: walletMatch ? walletMatch[1] : '',
        deadline,
        severity: inferSeverity(line)
      })
    }
  }

  if (reports.length === 0) {
    reports.push({
      name: '漏洞报告 1',
      description: input.trim(),
      completionCriteria: '提供 PoC 且可复现',
      rewardAmount: 10,
      assigneeName: '待指定',
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
}

interface RequirementMeta {
  modelUsed: string
  confidence: number
  gateDecision: 'pass' | 'block'
  criticFindings: string[]
  evidenceRefs: string[]
}

async function callCodeReviewModel(task: TaskBounty, model: string): Promise<string> {
  return callInferChat(
    '你是企业研发平台的代码交付审核助手。输出简洁中文结论。',
    `请对这条需求悬赏交付做审核总结，并给出 0-100 分：
任务标题：${task.title}
任务描述：${task.description}
PR：${task.prUrl || '未提供'}
Commit：${task.commitSha || '未提供'}
CI状态：${task.ciPassed ? '通过' : '未知/未通过'}

请输出两行：
第一行：评分，例如 SCORE:88
第二行：审核摘要（1-2句）`,
    model
  )
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
          summary: 'Infer 调用失败，已使用默认评分策略（80分）',
          inferPopup: `Infer 调用失败：primary(${selected.primary})=${inferError}; fallback(${selected.fallback})=${fallbackError}`,
          meta: {
            modelUsed: `${selected.primary}->${selected.fallback}`,
            confidence: 40,
            gateDecision: 'block',
            criticFindings: ['模型调用失败，已降级人工复核']
          }
        }
      }
    }
    const inferError = err instanceof Error ? err.message : String(err)
    return {
      aiScore: 80,
      summary: 'Infer 调用失败，已使用默认评分策略（80分）',
      inferPopup: `Infer 调用失败：model=${selected.primary}; error=${inferError}`,
      meta: {
        modelUsed: selected.primary,
        confidence: 40,
        gateDecision: 'block',
        criticFindings: ['模型调用失败，已降级人工复核']
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
  const summary = content.replace(/SCORE[:：]\s*\d{1,3}/i, '').trim() || 'AI 审核完成'
  const criticFindings: string[] = []
  if (aiScore < 85) criticFindings.push('评分低于自动支付阈值（85）')
  if (/缺少|未提供|不明确|风险|无法确认|证据不足/i.test(summary)) criticFindings.push('存在证据或风险缺口')
  const gateDecision: 'pass' | 'block' = criticFindings.length > 0 ? 'block' : 'pass'
  const confidence = gateDecision === 'pass' ? Math.min(99, aiScore) : Math.max(45, Math.min(84, aiScore))
  const popupSuffix = criticFindings.length > 0 ? ` | critic=${criticFindings.join('；')}` : ''
  return {
    aiScore,
    summary,
    inferPopup: `[model=${modelUsed}; gate=${gateDecision}] ${content.trim()}${popupSuffix}`,
    meta: { modelUsed, confidence, gateDecision, criticFindings }
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
  }
): Promise<{ clear: boolean; score: number; summary: string; meta: RequirementMeta }> {
  try {
    const content = await callInferChat(
      '你是企业需求评审助手。判断需求是否足够明确以便外部开发者交付。',
      `请对下面需求做明确性评估，0-100分，输出两行：
第一行：SCORE:分数
第二行：结论（明确/不明确）+ 主要缺失点（1-2点）

标题：${title}
描述：${description || '（空）'}
任务ID：${context?.taskId || '未提供'}
目标仓库：${context?.repo || '未提供'}
目标分支：${context?.branch || 'main'}
仓库可见性：${context?.repoVisibility || 'public'}
交付模式：${context?.deliveryMode || 'public_mirror_pr'}

必须输出：
1）SCORE:0-100
2）结论（明确/不明确）+ 主要缺失点
3）EVIDENCE: 以逗号分隔的证据键（如 AC, API, EDGE_CASE, DELIVERABLE, REPO_BRANCH）。若无证据写 NONE`,
      getRequirementModel()
    )
    const score = Math.min(100, Math.max(0, Number(content.match(/SCORE[:：]\s*(\d{1,3})/i)?.[1] || 60)))
    const evidenceLine = content.match(/EVIDENCE[:：]\s*(.+)$/im)?.[1]?.trim() || 'NONE'
    const evidenceRefs = evidenceLine.toUpperCase() === 'NONE'
      ? []
      : evidenceLine.split(/[，,\s]+/).map((x) => x.trim()).filter(Boolean)
    const summary = content
      .replace(/SCORE[:：]\s*\d{1,3}/i, '')
      .replace(/EVIDENCE[:：].*$/im, '')
      .trim() || '需求明确性评估完成'
    const criticFindings: string[] = []
    if (score < 75) criticFindings.push('评分低于外部发布阈值（75）')
    if (/不明确|待补充|无法判断|不完整|严重缺失/i.test(summary)) criticFindings.push('存在关键信息缺口')
    if (evidenceRefs.length === 0) criticFindings.push('未提供有效证据键（EVIDENCE）')
    const gateDecision: 'pass' | 'block' = criticFindings.length > 0 ? 'block' : 'pass'
    const clear = gateDecision === 'pass'
    const confidence = clear ? Math.min(99, score) : Math.max(45, Math.min(84, score))
    return {
      clear,
      score,
      summary,
      meta: {
        modelUsed: getRequirementModel(),
        confidence,
        gateDecision,
        criticFindings,
        evidenceRefs
      }
    }
  } catch {
    return {
      clear: false,
      score: 60,
      summary: 'AI 评估失败，建议补充验收标准、边界条件与交付物定义。',
      meta: {
        modelUsed: getRequirementModel(),
        confidence: 40,
        gateDecision: 'block',
        criticFindings: ['模型调用失败，需求明确性无法确认'],
        evidenceRefs: []
      }
    }
  }
}
