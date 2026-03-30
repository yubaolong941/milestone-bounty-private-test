interface LarkAccessTokenCache {
  token: string
  expiresAt: number
}

export interface LarkDocumentContext {
  sourceType: 'docx' | 'wiki'
  documentToken: string
  originalToken: string
  title?: string
  url?: string
  plainText: string
  truncated: boolean
}

let appAccessTokenCache: LarkAccessTokenCache | null = null

const DOCX_URL_PATTERN = /https?:\/\/[^\s]+\/docx\/([A-Za-z0-9]+)(?:[/?#].*)?$/i
const WIKI_URL_PATTERN = /https?:\/\/[^\s]+\/wiki\/([A-Za-z0-9]+)(?:[/?#].*)?$/i
const MAX_TEXT_LENGTH = 8000

function getLarkBaseUrl(): string {
  return process.env.LARK_OPEN_BASE_URL || process.env.LARK_DOMAIN || 'https://open.larksuite.com'
}

function getLarkAppCredentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.LARK_APP_ID || ''
  const appSecret = process.env.LARK_APP_SECRET || ''
  if (!appId || !appSecret) return null
  return { appId, appSecret }
}

function parseLarkUrl(url: string): { type: 'docx' | 'wiki'; token: string } | null {
  const docxMatch = url.match(DOCX_URL_PATTERN)
  if (docxMatch?.[1]) return { type: 'docx', token: docxMatch[1] }
  const wikiMatch = url.match(WIKI_URL_PATTERN)
  if (wikiMatch?.[1]) return { type: 'wiki', token: wikiMatch[1] }
  return null
}

async function getAppAccessToken(): Promise<string> {
  const now = Date.now()
  if (appAccessTokenCache && appAccessTokenCache.expiresAt > now + 30_000) {
    return appAccessTokenCache.token
  }

  const credentials = getLarkAppCredentials()
  if (!credentials) {
    throw new Error('Missing LARK_APP_ID / LARK_APP_SECRET configuration')
  }

  const res = await fetch(`${getLarkBaseUrl()}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: credentials.appId,
      app_secret: credentials.appSecret
    })
  })
  if (!res.ok) {
    throw new Error(`Failed to obtain Lark access token: ${res.status}`)
  }

  const data = await res.json() as {
    code?: number
    msg?: string
    app_access_token?: string
    expire?: number
  }
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`Failed to obtain Lark access token: ${data.msg || data.code || 'unknown error'}`)
  }

  appAccessTokenCache = {
    token: data.app_access_token,
    expiresAt: now + ((data.expire || 7200) * 1000)
  }
  return data.app_access_token
}

async function larkGet<T>(path: string): Promise<T> {
  const token = await getAppAccessToken()
  const res = await fetch(`${getLarkBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    cache: 'no-store'
  })
  if (!res.ok) {
    throw new Error(`Lark API request failed: ${res.status} ${path}`)
  }
  const data = await res.json() as { code?: number; msg?: string } & T
  if (typeof data.code === 'number' && data.code !== 0) {
    throw new Error(`Lark API error: ${data.msg || data.code}`)
  }
  return data
}

async function resolveWikiNode(token: string): Promise<{ documentToken: string; title?: string; url?: string }> {
  const data = await larkGet<{
    data?: {
      node?: {
        obj_token?: string
        title?: string
        url?: string
      }
    }
  }>(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`)

  const node = data.data?.node
  if (!node?.obj_token) {
    throw new Error('Failed to resolve Lark wiki node')
  }
  return {
    documentToken: node.obj_token,
    title: node.title,
    url: node.url
  }
}

function extractTextRunsFromUnknown(value: unknown): string[] {
  if (!value) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextRunsFromUnknown(item))
  }
  if (typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  const pieces: string[] = []
  if (typeof record.text === 'string') pieces.push(record.text)
  if (record.text_run) pieces.push(...extractTextRunsFromUnknown(record.text_run))
  if (record.reminder) pieces.push(...extractTextRunsFromUnknown(record.reminder))
  if (record.elements) pieces.push(...extractTextRunsFromUnknown(record.elements))
  if (record.content) pieces.push(...extractTextRunsFromUnknown(record.content))
  if (record.children) pieces.push(...extractTextRunsFromUnknown(record.children))
  if (record.property && typeof record.property === 'object') {
    pieces.push(...extractTextRunsFromUnknown(record.property))
  }
  if (record.text_element_style && typeof record.text_element_style === 'object') {
    pieces.push(...extractTextRunsFromUnknown(record.text_element_style))
  }
  return pieces.map((item) => item.trim()).filter(Boolean)
}

function extractBlockText(block: Record<string, unknown>): string {
  const textParts: string[] = []
  const knownKeys = [
    'text',
    'heading1',
    'heading2',
    'heading3',
    'bullet',
    'ordered',
    'quote',
    'callout',
    'todo',
    'code',
    'equation'
  ]

  for (const key of knownKeys) {
    if (key in block) {
      textParts.push(...extractTextRunsFromUnknown(block[key]))
    }
  }

  if (!textParts.length) {
    textParts.push(...extractTextRunsFromUnknown(block))
  }

  return textParts.join(' ').replace(/\s+/g, ' ').trim()
}

async function fetchDocumentTitle(documentToken: string): Promise<string | undefined> {
  const data = await larkGet<{
    data?: {
      document?: {
        title?: string
      }
    }
  }>(`/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}`)

  return data.data?.document?.title
}

async function fetchDocumentText(documentToken: string): Promise<{ plainText: string; truncated: boolean }> {
  const visited = new Set<string>()
  const lines: string[] = []
  let truncated = false

  async function walk(blockId: string, pageToken?: string): Promise<void> {
    if (truncated) return
    const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
    const data = await larkGet<{
      data?: {
        items?: Array<Record<string, unknown>>
        has_more?: boolean
        page_token?: string
      }
    }>(`/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}/blocks/${encodeURIComponent(blockId)}/children?page_size=100${suffix}`)

    const items = data.data?.items || []
    for (const item of items) {
      const currentBlockId = typeof item.block_id === 'string' ? item.block_id : ''
      if (currentBlockId && visited.has(currentBlockId)) continue
      if (currentBlockId) visited.add(currentBlockId)

      const text = extractBlockText(item)
      if (text) {
        lines.push(text)
        if (lines.join('\n').length >= MAX_TEXT_LENGTH) {
          truncated = true
          break
        }
      }

      if (currentBlockId) {
        await walk(currentBlockId)
      }
    }

    if (!truncated && data.data?.has_more && data.data.page_token) {
      await walk(blockId, data.data.page_token)
    }
  }

  await walk(documentToken)
  const plainText = lines.join('\n').slice(0, MAX_TEXT_LENGTH).trim()
  return { plainText, truncated: truncated || plainText.length >= MAX_TEXT_LENGTH }
}

export async function loadLarkDocumentContext(url: string | undefined): Promise<LarkDocumentContext | null> {
  if (!url) return null
  const parsed = parseLarkUrl(url)
  if (!parsed) return null

  let documentToken = parsed.token
  let title: string | undefined
  let resolvedUrl = url

  if (parsed.type === 'wiki') {
    const resolved = await resolveWikiNode(parsed.token)
    documentToken = resolved.documentToken
    title = resolved.title
    resolvedUrl = resolved.url || url
  }

  const [docTitle, docText] = await Promise.all([
    fetchDocumentTitle(documentToken).catch(() => undefined),
    fetchDocumentText(documentToken)
  ])

  return {
    sourceType: parsed.type,
    documentToken,
    originalToken: parsed.token,
    title: docTitle || title,
    url: resolvedUrl,
    plainText: docText.plainText,
    truncated: docText.truncated
  }
}
