import fs from 'fs'
import path from 'path'
import mysql from 'mysql2/promise'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

function mysqlDate(value) {
  return new Date(value || Date.now()).toISOString().slice(0, 23).replace('T', ' ')
}

function buildIssueUrl(repo, issueNumber) {
  return `https://github.com/${repo}/issues/${issueNumber}`
}

function buildSeedTasks() {
  const defaultRepo = process.env.GITHUB_INTERNAL_REPO_FULL_NAME || 'demo-org/demo-repo'
  const [owner, repoName] = defaultRepo.split('/')
  const now = new Date()
  const base = [
    {
      id: '81c9d9b4-7606-4c3d-89e1-5a4ec0e6d101',
      title: 'Polish payout timeline states',
      rewardAmount: 120,
      issueNumber: 301,
      requirementSummarySnapshot: 'Optimize the payout timeline in the external portal so collaborators clearly know when a task enters review and when it proceeds to payment.',
      acceptanceCriteriaSnapshot: [
        'Status copy covers open, submitted, awaiting_acceptance, paid',
        'Visual hierarchy is consistent on mobile and desktop',
        'PR description includes before/after comparison screenshots'
      ]
    },
    {
      id: '74f6cd3b-6575-42aa-9b24-58019447e102',
      title: 'Improve claim flow empty state',
      rewardAmount: 90,
      issueNumber: 302,
      requirementSummarySnapshot: 'Improve the empty state guidance for bounty claimants when there are no available tasks, clearly explaining whether the cause is no data, identity mismatch, or task already claimed.',
      acceptanceCriteriaSnapshot: [
        'Empty state clearly distinguishes between no tasks, mode mismatch, and task already claimed',
        'Provide a next-action entry point',
        'Copy is suitable for direct external demo'
      ]
    },
    {
      id: '21ca4c5f-a94d-4227-b0ea-76ac5bf6b103',
      title: 'Add reviewer evidence summary card',
      rewardAmount: 140,
      issueNumber: 303,
      requirementSummarySnapshot: 'Add a reviewer evidence summary card to the task detail view, aggregating PR, CI, AI, and manual review conclusions for customer demos.',
      acceptanceCriteriaSnapshot: [
        'Show at least four evidence dimensions: PR, CI, AI, and manual review',
        'Card information is suitable for executives and customers to read',
        'Does not break the existing review submission flow'
      ]
    },
    {
      id: 'f6bb24a1-b244-4ed1-961e-b292f0fbb104',
      title: 'Create customer weekly report drill-down',
      rewardAmount: 160,
      issueNumber: 304,
      requirementSummarySnapshot: 'Allow the customer weekly report view to drill down into specific task blockers and owners, enabling project managers to explain quickly in weekly meetings.',
      acceptanceCriteriaSnapshot: [
        'Weekly report view can drill into blocker details',
        'Each blocker displays owner and next action',
        'Exported content matches what is shown on the page'
      ]
    },
    {
      id: '5dfd7e40-60f5-4bb8-9c74-82c25b42f105',
      title: 'Refine wallet binding readiness banner',
      rewardAmount: 85,
      issueNumber: 305,
      requirementSummarySnapshot: 'Optimize the wallet binding banner in code bounty mode so new collaborators can more easily understand why binding a wallet is required before the submission channel opens.',
      acceptanceCriteriaSnapshot: [
        'Banner explains the binding reason and impact',
        'Status updates immediately after successful binding',
        'Copy is clear and suitable for first-time onboarding'
      ]
    }
  ]

  return base.map((item, index) => {
    const createdAt = new Date(now.getTime() - (index + 2) * 60 * 60 * 1000).toISOString()
    const updatedAt = new Date(now.getTime() - index * 25 * 60 * 1000).toISOString()
    return {
      id: item.id,
      title: item.title,
      description: `${item.requirementSummarySnapshot}\n\nDelivery requirements: Submit a publicly reviewable GitHub PR and reference issue #${item.issueNumber} in the PR description.`,
      requirementId: `REQ-DEMO-${item.issueNumber}`,
      requirementDocTitle: item.title,
      requirementSummarySnapshot: item.requirementSummarySnapshot,
      acceptanceCriteriaSnapshot: item.acceptanceCriteriaSnapshot,
      source: 'external',
      rewardAmount: item.rewardAmount,
      rewardToken: 'USD1',
      labels: ['external-task', `bounty:$${item.rewardAmount}`, 'auto-payout:on'],
      repo: defaultRepo,
      repoConfigId: undefined,
      repoVisibility: 'public',
      deliveryMode: 'public_mirror_pr',
      mirrorRepoUrl: buildIssueUrl(defaultRepo, item.issueNumber),
      requirementClarityScore: 92,
      requirementClarityStatus: 'clear',
      requirementClaritySummary: item.requirementSummarySnapshot,
      requirementGateDecision: 'pass',
      githubRepoOwner: owner || 'demo-org',
      githubRepoName: repoName || 'demo-repo',
      githubIssueNumber: item.issueNumber,
      githubIssueId: `demo-issue-${item.issueNumber}`,
      githubIssueUrl: buildIssueUrl(defaultRepo, item.issueNumber),
      developerName: '',
      developerWallet: '',
      aiManagerFocus: ['Delivery clarity', 'Customer explainability', 'Payment closure experience'],
      status: 'open',
      createdAt,
      updatedAt
    }
  })
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'))
  loadEnvFile(path.join(process.cwd(), '.env'))

  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5
  })

  const tasks = buildSeedTasks()

  for (const task of tasks) {
    await pool.query(
      `INSERT INTO wlfi_task_bounties
        (id, company_id, status, source, title, repo, reward_amount, reward_token, claimed_by_github_login, developer_wallet, payer_company_wallet_id, github_issue_number, task_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        company_id = VALUES(company_id),
        status = VALUES(status),
        source = VALUES(source),
        title = VALUES(title),
        repo = VALUES(repo),
        reward_amount = VALUES(reward_amount),
        reward_token = VALUES(reward_token),
        claimed_by_github_login = VALUES(claimed_by_github_login),
        developer_wallet = VALUES(developer_wallet),
        payer_company_wallet_id = VALUES(payer_company_wallet_id),
        github_issue_number = VALUES(github_issue_number),
        task_json = VALUES(task_json),
        updated_at = VALUES(updated_at)`,
      [
        task.id,
        null,
        task.status,
        task.source,
        task.title,
        task.repo,
        task.rewardAmount,
        task.rewardToken,
        null,
        task.developerWallet || null,
        null,
        task.githubIssueNumber,
        JSON.stringify(task),
        mysqlDate(task.createdAt),
        mysqlDate(task.updatedAt)
      ]
    )
  }

  const [rows] = await pool.query(
    `SELECT id, title, status, source, repo, github_issue_number AS githubIssueNumber, claimed_by_github_login AS claimedByGithubLogin
     FROM wlfi_task_bounties
     WHERE source = 'external' AND status = 'open' AND repo IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 10`
  )

  console.log(JSON.stringify({
    success: true,
    seeded: tasks.length,
    preview: rows
  }, null, 2))

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
