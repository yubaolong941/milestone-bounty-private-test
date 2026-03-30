import fs from 'fs'
import path from 'path'
import mysql from 'mysql2/promise'

const root = process.cwd()
const dataDir = path.join(root, 'data')

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

function readJson(name) {
  const file = path.join(dataDir, name)
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function mysqlDate(value) {
  return new Date(value || Date.now()).toISOString().slice(0, 23).replace('T', ' ')
}

async function main() {
  loadEnvFile(path.join(root, '.env.local'))
  loadEnvFile(path.join(root, '.env'))

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

  const tasks = readJson('tasks.json')
  const payments = readJson('payments.json')
  const bindings = readJson('wallet-identity-bindings.json')
  const repoConfigs = readJson('repo-configs.json')
  const internalMemberBindings = readJson('internal-member-bindings.json')
  const projects = readJson('projects.json')
  const notifications = readJson('notifications.json')
  const auditLogs = readJson('audit-logs.json')
  const integrationHealth = readJson('integration-health.json')

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
        task.companyId || null,
        task.status,
        task.source || 'internal',
        task.title,
        task.repo || null,
        Number(task.rewardAmount || 0),
        task.rewardToken || 'USD1',
        task.claimedByGithubLogin || null,
        task.developerWallet || null,
        task.payerCompanyWalletId || null,
        task.githubIssueNumber ?? null,
        JSON.stringify(task),
        mysqlDate(task.createdAt),
        mysqlDate(task.updatedAt)
      ]
    )
  }

  for (const payment of payments) {
    await pool.query(
      `INSERT INTO wlfi_payments
        (id, company_id, project_id, report_id, tx_hash, to_address, from_address, amount, token_symbol, paid_at, payment_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        company_id = VALUES(company_id),
        tx_hash = VALUES(tx_hash),
        to_address = VALUES(to_address),
        from_address = VALUES(from_address),
        amount = VALUES(amount),
        token_symbol = VALUES(token_symbol),
        paid_at = VALUES(paid_at),
        payment_json = VALUES(payment_json),
        updated_at = VALUES(updated_at)`,
      [
        payment.id,
        payment.companyId || null,
        payment.projectId || 'legacy',
        payment.reportId || payment.milestoneId || '',
        payment.txHash,
        payment.toAddress,
        payment.fromAddress || null,
        Number(payment.amount || 0),
        payment.rewardToken || null,
        mysqlDate(payment.timestamp),
        JSON.stringify(payment),
        mysqlDate(payment.timestamp),
        mysqlDate(payment.timestamp)
      ]
    )
  }

  for (const project of projects) {
    await pool.query(
      `INSERT INTO wlfi_projects
        (id, name, total_budget, spent_amount, project_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        total_budget = VALUES(total_budget),
        spent_amount = VALUES(spent_amount),
        project_json = VALUES(project_json),
        updated_at = VALUES(updated_at)`,
      [
        project.id,
        project.name,
        Number(project.totalBudget || 0),
        Number(project.spentAmount || 0),
        JSON.stringify(project),
        mysqlDate(project.createdAt),
        mysqlDate(project.updatedAt || project.createdAt)
      ]
    )
  }

  for (const repoConfig of repoConfigs) {
    await pool.query(
      `INSERT INTO wlfi_repo_configs
        (id, company_id, provider, owner, repo, default_branch, token_ref, enabled, sync_interval_sec, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        company_id = VALUES(company_id),
        provider = VALUES(provider),
        owner = VALUES(owner),
        repo = VALUES(repo),
        default_branch = VALUES(default_branch),
        token_ref = VALUES(token_ref),
        enabled = VALUES(enabled),
        sync_interval_sec = VALUES(sync_interval_sec),
        config_json = VALUES(config_json),
        updated_at = VALUES(updated_at)`,
      [
        repoConfig.id,
        repoConfig.companyId || null,
        repoConfig.provider || 'github',
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.defaultBranch || 'main',
        repoConfig.tokenRef || null,
        repoConfig.enabled === false ? 0 : 1,
        repoConfig.syncIntervalSec ?? null,
        JSON.stringify(repoConfig),
        mysqlDate(repoConfig.createdAt),
        mysqlDate(repoConfig.updatedAt || repoConfig.createdAt)
      ]
    )
  }

  for (const binding of internalMemberBindings) {
    await pool.query(
      `INSERT INTO wlfi_internal_member_bindings
        (id, company_id, meegle_assignee, github_login, repo_config_id, repo, enabled, binding_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        company_id = VALUES(company_id),
        meegle_assignee = VALUES(meegle_assignee),
        github_login = VALUES(github_login),
        repo_config_id = VALUES(repo_config_id),
        repo = VALUES(repo),
        enabled = VALUES(enabled),
        binding_json = VALUES(binding_json),
        updated_at = VALUES(updated_at)`,
      [
        binding.id,
        binding.companyId || null,
        binding.meegleAssignee,
        binding.githubLogin,
        binding.repoConfigId || null,
        binding.repo || null,
        binding.enabled === false ? 0 : 1,
        JSON.stringify(binding),
        mysqlDate(binding.createdAt),
        mysqlDate(binding.updatedAt || binding.createdAt)
      ]
    )
  }

  for (const notification of notifications) {
    await pool.query(
      `INSERT INTO wlfi_notifications
        (id, company_id, severity, channel, category, title, message, task_id, task_title, action_url, acknowledged, metadata, notification_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        severity = VALUES(severity),
        channel = VALUES(channel),
        category = VALUES(category),
        title = VALUES(title),
        message = VALUES(message),
        task_id = VALUES(task_id),
        task_title = VALUES(task_title),
        action_url = VALUES(action_url),
        acknowledged = VALUES(acknowledged),
        metadata = VALUES(metadata),
        notification_json = VALUES(notification_json),
        updated_at = VALUES(updated_at)`,
      [
        notification.id,
        notification.companyId || null,
        notification.severity,
        notification.channel,
        notification.category,
        notification.title,
        notification.message,
        notification.taskId || null,
        notification.taskTitle || null,
        notification.actionUrl || null,
        notification.acknowledged ? 1 : 0,
        notification.metadata ? JSON.stringify(notification.metadata) : null,
        JSON.stringify(notification),
        mysqlDate(notification.createdAt),
        mysqlDate(notification.updatedAt || notification.createdAt)
      ]
    )
  }

  for (const item of auditLogs) {
    await pool.query(
      `INSERT INTO wlfi_audit_logs
        (id, company_id, actor_user_id, actor_role, action, target_type, target_id, summary, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        actor_user_id = VALUES(actor_user_id),
        actor_role = VALUES(actor_role),
        action = VALUES(action),
        target_type = VALUES(target_type),
        target_id = VALUES(target_id),
        summary = VALUES(summary),
        metadata = VALUES(metadata)`,
      [
        item.id,
        item.companyId || null,
        item.actorUserId,
        item.actorRole || null,
        item.action,
        item.targetType,
        item.targetId,
        item.summary,
        item.metadata ? JSON.stringify(item.metadata) : null,
        mysqlDate(item.createdAt)
      ]
    )
  }

  for (const item of integrationHealth) {
    await pool.query(
      `INSERT INTO wlfi_integration_health_states
        (integration, last_status, last_success_at, last_failure_at, last_detail, consecutive_failures, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        last_status = VALUES(last_status),
        last_success_at = VALUES(last_success_at),
        last_failure_at = VALUES(last_failure_at),
        last_detail = VALUES(last_detail),
        consecutive_failures = VALUES(consecutive_failures),
        updated_at = VALUES(updated_at)`,
      [
        item.integration,
        item.lastStatus,
        item.lastSuccessAt ? mysqlDate(item.lastSuccessAt) : null,
        item.lastFailureAt ? mysqlDate(item.lastFailureAt) : null,
        item.lastDetail,
        Number(item.consecutiveFailures || 0),
        mysqlDate(item.updatedAt)
      ]
    )
  }

  for (const binding of bindings) {
    await pool.query(
      `INSERT INTO wlfi_wallet_identity_bindings
        (id, actor_role, github_login, wallet_address, external_user_id, auth_source, status, verified_at, binding_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        github_login = VALUES(github_login),
        external_user_id = VALUES(external_user_id),
        auth_source = VALUES(auth_source),
        status = VALUES(status),
        verified_at = VALUES(verified_at),
        binding_json = VALUES(binding_json),
        updated_at = VALUES(updated_at)`,
      [
        binding.id,
        binding.actorRole,
        binding.githubLogin || null,
        binding.walletAddress,
        binding.externalUserId || null,
        binding.authSource,
        binding.status || 'active',
        mysqlDate(binding.verifiedAt),
        JSON.stringify(binding),
        mysqlDate(binding.createdAt),
        mysqlDate(binding.updatedAt)
      ]
    )
  }

  console.log(JSON.stringify({
    success: true,
    imported: {
      tasks: tasks.length,
      projects: projects.length,
      payments: payments.length,
      repoConfigs: repoConfigs.length,
      internalMemberBindings: internalMemberBindings.length,
      walletBindings: bindings.length,
      notifications: notifications.length,
      auditLogs: auditLogs.length,
      integrationHealth: integrationHealth.length
    }
  }))

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
