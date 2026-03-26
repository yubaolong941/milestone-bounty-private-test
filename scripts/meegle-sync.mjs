#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx)
    const value = trimmed.slice(idx + 1)
    if (!(key in process.env)) process.env[key] = value
  }
}

async function runOnce(baseUrl) {
  const [meegleRes, githubRes] = await Promise.all([
    fetch(`${baseUrl}/api/integrations/meegle/webhook`),
    fetch(`${baseUrl}/api/integrations/github/sync`)
  ])
  const meeglePayload = await meegleRes.json().catch(() => ({}))
  const githubPayload = await githubRes.json().catch(() => ({}))
  const ok = Boolean(meeglePayload?.success) && Boolean(githubPayload?.success)
  const detail = `meegle=${meeglePayload?.detail || meeglePayload?.error || 'n/a'} | github=${githubPayload?.detail || githubPayload?.error || 'n/a'}`
  const created = meeglePayload?.created ?? 0
  const updated = (meeglePayload?.updated ?? 0) + (githubPayload?.updated ?? 0)
  const ts = new Date().toISOString()
  if (ok) {
    console.log(`[${ts}] sync ok created=${created} updated=${updated} detail=${detail}`)
    return true
  }
  console.error(`[${ts}] sync failed detail=${detail}`)
  return false
}

async function main() {
  loadEnvLocal()
  const baseUrl = process.env.SYNC_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  const intervalSec = Number(process.env.MEEGLE_SYNC_INTERVAL_SECONDS || '300')
  const once = process.argv.includes('--once')

  if (once) {
    const ok = await runOnce(baseUrl)
    process.exit(ok ? 0 : 1)
  }

  console.log(`[meegle-sync] start loop baseUrl=${baseUrl} interval=${intervalSec}s`)
  await runOnce(baseUrl)
  setInterval(() => {
    runOnce(baseUrl).catch((err) => {
      console.error(`[${new Date().toISOString()}] sync error: ${String(err)}`)
    })
  }, Math.max(10, intervalSec) * 1000)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
