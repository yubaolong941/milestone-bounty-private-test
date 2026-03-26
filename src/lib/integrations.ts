interface GitHubPRInfo {
  owner: string
  repo: string
  pullNumber: number
}

import crypto from 'crypto'

export function parseGitHubPrUrl(prUrl: string): GitHubPRInfo | null {
  const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i)
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    pullNumber: Number(match[3])
  }
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
  const parsed = parseGitHubPrUrl(prUrl)
  if (!parsed) return { merged: false, detail: 'PR URL 非法' }

  const token = process.env.GITHUB_TOKEN
  if (!token) return { merged: false, detail: '未配置 GITHUB_TOKEN' }

  const res = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    }
  )
  if (!res.ok) return { merged: false, detail: `GitHub API 失败: ${res.status}` }

  const data = await res.json()
  return { merged: Boolean(data?.merged), detail: Boolean(data?.merged) ? 'PR 已合并' : 'PR 未合并' }
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

export async function fetchMeegleIssuesFromMcp(): Promise<{ issues: MeegleIssue[]; detail: string }> {
  const url = process.env.MEEGLE_MCP_URL || 'https://meegle.com/mcp_server/v1'
  const token = process.env.MEEGLE_MCP_TOKEN
  if (!token) return { issues: [], detail: '未配置 MEEGLE_MCP_TOKEN' }

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
    return { issues: [], detail: `MCP 请求失败: ${res.status} ${text}` }
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
  const hasViewTool = tools.some((t) => t?.name === 'get_view_detail')
  const hasIssueListTool = tools.some((t) => t?.name === 'issues.list')
  if (!hasViewTool && !hasIssueListTool) {
    return { issues: [], detail: 'MCP 工具集中未发现 issue 查询能力，请在 Meegle 开启对应 MCP 功能权限' }
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
          arguments: { limit: 100 }
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
            title: String(obj.title || 'Meegle 外部悬赏任务'),
            description: String(obj.description || obj.content || ''),
            labels: normalizeLabels(obj.labels),
            assignee: typeof obj.assignee === 'string' ? obj.assignee : undefined
          })
        }
        return { issues, detail: `MCP issues.list 同步成功，共 ${issues.length} 条` }
      }
    }
  }

  // Fallback: use get_view_detail if user provides a view URL
  const viewUrl = process.env.MEEGLE_MCP_VIEW_URL
  if (!viewUrl) {
    return {
      issues: [],
      detail: 'MCP 已连通，但缺少可直接拉 issue 的工具。请配置 MEEGLE_MCP_VIEW_URL，或在 Meegle 开启 issue list MCP 功能'
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
  if (!viewRes.ok) return { issues: [], detail: `get_view_detail 调用失败: ${viewRes.status}` }
  const viewData = (await viewRes.json()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }
  const text = viewData?.result?.content?.map((x) => x.text || '').join('\n') || ''
  if (viewData?.result?.isError) return { issues: [], detail: `get_view_detail 返回错误: ${text}` }
  const parsed = parseIssuesFromViewText(text)
  return { issues: parsed, detail: `MCP get_view_detail 同步成功，共 ${parsed.length} 条` }
}

export async function updateMeegleIssueStatusByMcp(
  issueId: string,
  toStatus: 'in_progress' | 'resolved'
): Promise<{ success: boolean; detail: string }> {
  const url = process.env.MEEGLE_MCP_URL || 'https://meegle.com/mcp_server/v1'
  const token = process.env.MEEGLE_MCP_TOKEN
  if (!token) return { success: false, detail: '未配置 MEEGLE_MCP_TOKEN' }

  const statusFieldKey = process.env.MEEGLE_STATUS_FIELD_KEY || 'status'
  const inProgressValue = process.env.MEEGLE_STATUS_IN_PROGRESS_VALUE || '进行中'
  const resolvedValue = process.env.MEEGLE_STATUS_RESOLVED_VALUE || '已解决'
  const statusValue = toStatus === 'resolved' ? resolvedValue : inProgressValue

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Mcp-Token': token
  }

  const projectKey = process.env.MEEGLE_PROJECT_KEY
  const args: Record<string, unknown> = {
    work_item_id: issueId,
    fields: [
      {
        field_key: statusFieldKey,
        field_value: statusValue
      }
    ]
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
  if (!res.ok) return { success: false, detail: `Meegle 状态回写失败: ${res.status}` }
  const data = await res.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }
  const text = data?.result?.content?.map((x) => x.text || '').join('\n') || ''
  if (data?.result?.isError) return { success: false, detail: text || 'Meegle 状态回写返回错误' }
  return { success: true, detail: text || `状态已更新为 ${statusValue}` }
}

function parseIssuesFromViewText(text: string): MeegleIssue[] {
  const lines = text.split('\n')
  const issues: MeegleIssue[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (trimmed.includes('名称') && trimmed.includes('工作项 ID')) continue
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
