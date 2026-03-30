import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const cwd = process.cwd()
const envPath = path.join(cwd, '.env.local')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnv(envPath)

const baseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || ''
const shouldSend = process.argv.includes('--send')

function signPayload(payload) {
  if (!webhookSecret) return ''
  return `sha256=${crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex')}`
}

async function postEvent(event, payload) {
  const body = JSON.stringify(payload)
  const headers = {
    'Content-Type': 'application/json',
    'x-github-event': event
  }
  const signature = signPayload(body)
  if (signature) headers['x-hub-signature-256'] = signature
  const res = await fetch(`${baseUrl}/api/integrations/github/webhook`, {
    method: 'POST',
    headers,
    body
  })
  const text = await res.text()
  return { status: res.status, text }
}

const issuePayload = {
  action: 'opened',
  issue: {
    id: 1001,
    number: 101,
    title: '[Bounty] Demo task',
    body: [
      'Task summary: Demo',
      'Bounty: $50',
      'RewardToken: USD1',
      'Claim: @octocat',
      'Wallet: 0x1234567890abcdef1234567890abcdef12345678',
      'Auto payout: yes'
    ].join('\n'),
    html_url: 'https://github.com/demo/repo/issues/101',
    state: 'open',
    labels: [{ name: 'external-task' }],
    user: { login: 'maintainer' }
  },
  repository: {
    owner: { login: 'demo' },
    name: 'repo'
  }
}

const commentPayload = {
  action: 'created',
  issue: {
    number: 101
  },
  comment: {
    body: '/claim\n/wallet 0x1234567890abcdef1234567890abcdef12345678\n/ready-for-review',
    user: { login: 'octocat' }
  },
  repository: {
    owner: { login: 'demo' },
    name: 'repo'
  }
}

const prPayload = {
  action: 'closed',
  number: 12,
  repository: {
    owner: { login: 'demo' },
    name: 'repo',
    full_name: 'demo/repo'
  },
  pull_request: {
    html_url: 'https://github.com/demo/repo/pull/12',
    title: 'fix: demo payout flow',
    body: 'Fixes #101',
    merged: true,
    merge_commit_sha: 'abcdef1234567890',
    user: { login: 'octocat' },
    merged_by: { login: 'maintainer' }
  }
}

console.log('GitHub flow demo')
console.log(`Base URL: ${baseUrl}`)
console.log(`Webhook secret configured: ${webhookSecret ? 'yes' : 'no'}`)
console.log('')

if (!shouldSend) {
  console.log('Preview mode only. Run with `node scripts/github-flow-demo.mjs --send` to POST events.')
  console.log('')
  console.log('Events included:')
  console.log('- issues.opened with structured bounty fields in issue body')
  console.log('- issue_comment.created with /claim /wallet /ready-for-review')
  console.log('- pull_request.closed merged=true referencing Fixes #101')
  process.exit(0)
}

for (const [event, payload] of [
  ['issues', issuePayload],
  ['issue_comment', commentPayload],
  ['pull_request', prPayload]
]) {
  const result = await postEvent(event, payload)
  console.log(`Event: ${event}`)
  console.log(`Status: ${result.status}`)
  console.log(result.text)
  console.log('')
}
