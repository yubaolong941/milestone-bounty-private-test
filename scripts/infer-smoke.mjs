import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

async function main() {
  loadEnvLocal()
  const apiKey = process.env.INFER_API_KEY || process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api-infer.agentsey.ai/v1'
  const model = process.env.AI_MODEL || 'gpt-5'

  if (!apiKey) {
    throw new Error('Missing INFER_API_KEY / OPENAI_API_KEY')
  }

  const startedAt = Date.now()
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a connectivity check assistant.' },
        { role: 'user', content: 'Reply exactly: pong' }
      ],
      temperature: 0
    })
  })

  const elapsedMs = Date.now() - startedAt
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Infer smoke failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content || ''
  console.log(JSON.stringify({
    ok: true,
    elapsedMs,
    model,
    baseUrl,
    preview: String(content).slice(0, 120).trim()
  }, null, 2))
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2))
  process.exit(1)
})
