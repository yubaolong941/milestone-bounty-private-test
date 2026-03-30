import { listAuditLogs } from '@/lib/access-control-db'
import {
  listIntegrationHealthStatesDb,
  listNotificationsDb,
  listPaymentsDb,
  listTaskBountiesDb
} from '@/lib/runtime-data-db'
import { AuditLog, IntegrationHealthState, NotificationEvent, PaymentRecord, TaskBounty } from '@/lib/types'

export type OpsScenarioId = 'live' | 'stable_exec' | 'payment_recovery' | 'client_weekly'
export type OpsHealth = 'healthy' | 'at_risk' | 'critical'

export interface OpsKpi {
  label: string
  value: string
  tone: 'default' | 'good' | 'warn' | 'danger'
  detail: string
}

export interface OpsBlocker {
  title: string
  severity: 'warning' | 'critical'
  owner: string
  age: string
  impact: string
  nextAction: string
}

export interface OpsReportSection {
  title: string
  summary: string
  bullets: string[]
}

export interface OpsIntegrationItem {
  integration: string
  health: 'ok' | 'degraded' | 'stale' | 'unknown'
  summary: string
  consecutiveFailures: number
  lastSuccessAt?: string
  lastFailureAt?: string
}

export interface OpsOverviewSnapshot {
  mode: 'live' | 'demo'
  scenarioId: OpsScenarioId
  scenarioName: string
  generatedAt: string
  companyScope: string
  health: OpsHealth
  headline: string
  subheadline: string
  retryPolicy: string
  kpis: OpsKpi[]
  blockers: OpsBlocker[]
  reports: {
    daily: OpsReportSection
    customer: OpsReportSection
    weekly: OpsReportSection
  }
  integrations: OpsIntegrationItem[]
  audit: {
    totalEvents: number
    todayEvents: number
    exportUrl: string
  }
}

function summarizeHealth(updatedAt?: string, lastStatus?: 'success' | 'failure'): OpsIntegrationItem['health'] {
  if (!updatedAt) return 'unknown'
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  if (Number.isNaN(ageMs)) return 'unknown'
  if (lastStatus === 'failure') return 'degraded'
  if (ageMs > 15 * 60 * 1000) return 'stale'
  return 'ok'
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function sameDay(iso: string, anchor = new Date()) {
  const value = new Date(iso)
  return value.getUTCFullYear() === anchor.getUTCFullYear()
    && value.getUTCMonth() === anchor.getUTCMonth()
    && value.getUTCDate() === anchor.getUTCDate()
}

async function safeListTasks() {
  return listTaskBountiesDb()
}

async function safeListPayments() {
  const result = await listPaymentsDb()
  return Array.isArray(result) ? result : result.items
}

async function safeListAuditLogs(companyId?: string) {
  const result = await listAuditLogs(companyId)
  return Array.isArray(result) ? result : result.items
}

function formatAge(iso?: string) {
  if (!iso) return 'unknown'
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime())
  const hours = Math.round(diffMs / (60 * 60 * 1000))
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function buildBlockers(tasks: TaskBounty[], notifications: NotificationEvent[]) {
  const taskBlockers = tasks
    .filter((task) => ['awaiting_manual_review', 'awaiting_finance_review', 'payment_failed', 'awaiting_acceptance', 'accepted'].includes(task.status))
    .slice(0, 4)
    .map<OpsBlocker>((task) => ({
      title: task.title,
      severity: task.status === 'payment_failed' ? 'critical' : 'warning',
      owner: task.status === 'accepted' ? 'Payout' : task.status === 'awaiting_finance_review' || task.status === 'payment_failed' ? 'Finance' : 'Reviewer',
      age: formatAge(task.updatedAt),
      impact: task.status === 'payment_failed'
        ? 'Payment loop not closed. The client will directly perceive the failure.'
        : task.status === 'accepted'
          ? 'Finance has approved, but payment execution is not yet complete.'
          : 'Task cannot advance from delivery to settlement.',
      nextAction: task.status === 'payment_failed'
        ? `Handle failure via ${task.lastAutoPayoutRetryStrategy || 'manual_retry'} and verify wallet/escrow state`
        : task.status === 'accepted'
          ? 'Execute payment and record the on-chain receipt'
          : 'Complete the manual decision and capture the audit conclusion'
    }))

  const alertBlockers = notifications
    .filter((item) => !item.acknowledged && item.severity !== 'info')
    .slice(0, Math.max(0, 4 - taskBlockers.length))
    .map<OpsBlocker>((item) => ({
      title: item.title,
      severity: item.severity === 'critical' ? 'critical' : 'warning',
      owner: item.category === 'integration' ? 'Platform Ops' : 'Operations',
      age: formatAge(item.createdAt),
      impact: item.message,
      nextAction: item.actionUrl ? 'Open the workbench and handle the affected pipeline' : 'Identify root cause and update status'
    }))

  return [...taskBlockers, ...alertBlockers]
}

function buildLiveOverview(input: {
  tasks: TaskBounty[]
  payments: PaymentRecord[]
  notifications: NotificationEvent[]
  integrations: IntegrationHealthState[]
  auditLogs: AuditLog[]
  companyId?: string
}): OpsOverviewSnapshot {
  const generatedAt = new Date().toISOString()
  const { tasks, payments, notifications, integrations, auditLogs, companyId } = input
  const paymentAttempts = tasks.filter((task) => task.status === 'paid' || task.status === 'payment_failed').length
  const successfulPayments = tasks.filter((task) => task.status === 'paid').length
  const reviewQueue = tasks.filter((task) =>
    task.manualReviewRequired
    || task.status === 'awaiting_manual_review'
    || task.status === 'awaiting_finance_review'
    || task.status === 'accepted'
  ).length
  const activeBlockers = tasks.filter((task) =>
    ['awaiting_acceptance', 'awaiting_manual_review', 'awaiting_finance_review', 'accepted', 'payment_failed'].includes(task.status)
  ).length
  const criticalAlerts = notifications.filter((item) => !item.acknowledged && item.severity === 'critical').length
  const degradedIntegrations = integrations.filter((item) => summarizeHealth(item.updatedAt, item.lastStatus) !== 'ok').length
  const health: OpsHealth = criticalAlerts > 0 || tasks.some((task) => task.status === 'payment_failed')
    ? 'critical'
    : activeBlockers > 0 || degradedIntegrations > 0
      ? 'at_risk'
      : 'healthy'

  const payoutSuccessRate = percent(successfulPayments, Math.max(paymentAttempts, successfulPayments))
  const todayPayments = payments.filter((payment) => sameDay(payment.timestamp)).length
  const todayAuditEvents = auditLogs.filter((item) => sameDay(item.createdAt)).length
  const totalEscrowLocked = tasks
    .filter((task) => task.rewardLockStatus === 'locked')
    .reduce((sum, task) => sum + (task.rewardLockedAmount || task.rewardAmount || 0), 0)

  const blockers = buildBlockers(tasks, notifications)
  const integrationsView = integrations.map<OpsIntegrationItem>((item) => ({
    integration: item.integration,
    health: summarizeHealth(item.updatedAt, item.lastStatus),
    summary: item.lastDetail,
    consecutiveFailures: item.consecutiveFailures,
    lastSuccessAt: item.lastSuccessAt,
    lastFailureAt: item.lastFailureAt
  }))

  return {
    mode: 'live',
    scenarioId: 'live',
    scenarioName: 'Live Dashboard',
    generatedAt,
    companyScope: companyId || 'all-companies',
    health,
    headline: health === 'critical' ? 'Resolve blockers today before discussing scale-up or client demos.' : health === 'at_risk' ? 'Core pipeline is operational, but existing blockers are degrading the client experience.' : 'Integration, review, and payment pipelines are overall stable.',
    subheadline: `Current payout success rate: ${payoutSuccessRate}. Pending blockers: ${activeBlockers}. Critical alerts: ${criticalAlerts}.`,
    retryPolicy: `Retry policy follows task records. Recommend prioritizing ${tasks.filter((task) => task.lastAutoPayoutRetryStrategy === 'manual_retry').length} manual_retry items. Auto-retry is reserved for failures with clear evidence and confirmed fund state.`,
    kpis: [
      { label: 'Integration Availability', value: percent(integrationsView.filter((item) => item.health === 'ok').length, Math.max(integrationsView.length, 1)), tone: degradedIntegrations > 0 ? 'warn' : 'good', detail: 'Summarized from the most recent GitHub / Meegle run status.' },
      { label: 'Payout Success Rate', value: payoutSuccessRate, tone: tasks.some((task) => task.status === 'payment_failed') ? 'danger' : 'good', detail: 'Based on paid vs payment_failed task counts.' },
      { label: 'Manual Review Queue', value: String(reviewQueue), tone: reviewQueue > 0 ? 'warn' : 'good', detail: 'Includes tasks pending reviewer and finance decisions.' },
      { label: "Today's Payments", value: String(todayPayments), tone: 'default', detail: 'Payment records entered into the ledger today.' },
      { label: 'Locked Budget', value: `${totalEscrowLocked} ${tasks.find((task) => task.rewardToken)?.rewardToken || 'USD1'}`, tone: 'default', detail: 'Budget locked in escrow but not yet fully released.' },
      { label: 'Unacknowledged Alerts', value: String(notifications.filter((item) => !item.acknowledged).length), tone: criticalAlerts > 0 ? 'danger' : 'warn', detail: 'Notifications still requiring a response from ops or platform.' }
    ],
    blockers,
    reports: {
      daily: {
        title: 'Daily Ops Report',
        summary: `${todayPayments} new payments recorded today. ${reviewQueue} tasks remain in the review queue. ${activeBlockers} blockers are impacting client experience.`,
        bullets: [
          `Payout success rate is ${payoutSuccessRate}. Recommend addressing payment_failed and awaiting_finance_review tasks first.`,
          `${todayAuditEvents} new audit events today. Key actions are exportable for record-keeping.`,
          blockers[0] ? `Top blocker: "${blockers[0].title}" — owner: ${blockers[0].owner}.` : 'No high-priority blockers at this time.'
        ]
      },
      customer: {
        title: 'Client Report',
        summary: `From the client perspective, the delivery pipeline is ${health === 'healthy' ? 'stable' : 'experiencing partial blockers'}. The payment and audit chain is fully explainable.`,
        bullets: [
          `${successfulPayments} tasks have been paid. ${reviewQueue} tasks are in review or awaiting finance approval.`,
          `Integration layer: ${integrationsView.filter((item) => item.health === 'ok').length}/${Math.max(integrationsView.length, 1)} integrations healthy. End-to-end status loop is demonstrable.`,
          blockers[0] ? `Risk to communicate to client: ${blockers[0].impact}` : 'No blockers requiring additional explanation this period.'
        ]
      },
      weekly: {
        title: 'Weekly Project Report',
        summary: `This week's focus is advancing ${activeBlockers} blockers from "known issues" to "assigned, trackable, and closable".`,
        bullets: [
          `Recommend combining review, payment, and integration dimensions in the weekly report rather than reporting task counts alone.`,
          `Ready to present to stakeholders: payout success rate ${payoutSuccessRate}, unacknowledged alerts ${notifications.filter((item) => !item.acknowledged).length}, audit events ${auditLogs.length}.`,
          `Prioritize moving ${tasks.filter((task) => task.status === 'awaiting_acceptance').length} awaiting-acceptance tasks into reviewer decisions.`
        ]
      }
    },
    integrations: integrationsView,
    audit: {
      totalEvents: auditLogs.length,
      todayEvents: todayAuditEvents,
      exportUrl: companyId ? `/api/audit-logs?companyId=${companyId}&format=csv` : '/api/audit-logs?format=csv'
    }
  }
}

function buildDemoOverview(scenarioId: Exclude<OpsScenarioId, 'live'>): OpsOverviewSnapshot {
  const generatedAt = new Date().toISOString()

  if (scenarioId === 'stable_exec') {
    return {
      mode: 'demo',
      scenarioId,
      scenarioName: 'Executive Demo: Stable Operations',
      generatedAt,
      companyScope: 'demo-enterprise',
      health: 'healthy',
      headline: 'This is an executive-level operational overview. Key message: "Platform is stable and ready to scale."',
      subheadline: 'All integrations healthy. Payout success rate 98%. No critical blockers today that would disrupt a client demo.',
      retryPolicy: 'Default strategy: auto_retry for transient pipeline errors. manual_retry is reserved for fund or identity mismatch scenarios only.',
      kpis: [
        { label: 'SLA Compliance', value: '99.2%', tone: 'good', detail: 'Met within critical integration windows over the past 7 days.' },
        { label: 'Payout Success Rate', value: '98%', tone: 'good', detail: '55 of 56 payments succeeded on the first attempt.' },
        { label: "Today's Blockers", value: '0', tone: 'good', detail: 'No critical blockers that would affect an executive demo.' },
        { label: 'Tasks Pending Review', value: '3', tone: 'warn', detail: 'All within SLA window.' },
        { label: 'Client Milestone Satisfaction', value: '12/12', tone: 'good', detail: 'All committed milestones are on track.' },
        { label: 'Audit Events', value: '148', tone: 'default', detail: 'Ready to export to finance and clients.' }
      ],
      blockers: [
        { title: 'EU-timezone client acceptance awaiting response', severity: 'warning', owner: 'Customer Success', age: '6h', impact: 'Does not affect platform stability, but may delay closing a single project.', nextAction: 'Sync with client reviewer to confirm in the next business window.' }
      ],
      reports: {
        daily: {
          title: 'Daily Ops Report',
          summary: 'Platform is stable overall today. Shift focus from firefighting to replicating success.',
          bullets: ['Payout success rate holding at 98%.', 'No consecutive failures on GitHub / Meegle / AI gate.', 'Recommend documenting successful cases as a standard demo script for next week.']
        },
        customer: {
          title: 'Client Report',
          summary: 'This week the delivery and payment pipeline is stable. The client sees a trackable, explainable, and auditable system.',
          bullets: ['All key commitments are on track.', 'Payment pipeline has clear success rates and failure-handling procedures.', 'Clients can export a CSV ledger for audit materials at any time.']
        },
        weekly: {
          title: 'Weekly Project Report',
          summary: 'This week the focus shifts from patching gaps to hardening metrics and rolling out to more projects.',
          bullets: ['Recommend introducing project-level grouping views next.', 'Demo scripts can reference this scenario directly.', 'This scenario is suitable for executive and sales-accompanied walkthroughs.']
        }
      },
      integrations: [
        { integration: 'github_issue_sync', health: 'ok', summary: 'Synced 14 issues in the last 20 minutes. GitHub event ingestion is operating normally.', consecutiveFailures: 0, lastSuccessAt: generatedAt },
        { integration: 'meegle_sync', health: 'ok', summary: 'Task statuses are in sync with the project board.', consecutiveFailures: 0, lastSuccessAt: generatedAt }
      ],
      audit: { totalEvents: 148, todayEvents: 21, exportUrl: '/api/audit-logs?format=csv' }
    }
  }

  if (scenarioId === 'payment_recovery') {
    return {
      mode: 'demo',
      scenarioId,
      scenarioName: 'Ops Demo: Payment Recovery',
      generatedAt,
      companyScope: 'demo-enterprise',
      health: 'critical',
      headline: 'This dashboard illustrates "when something goes wrong — how we know, how we handle it, and who is accountable".',
      subheadline: 'Payout success rate has dropped to 81%. 2 critical blockers are impacting client perception and require cross-team coordination (reviewer / finance / ops).',
      retryPolicy: 'Signature failures and identity mismatches require manual_retry. Node timeouts allow up to 2 auto_retry attempts before escalating to manual handling.',
      kpis: [
        { label: 'SLA Compliance', value: '92%', tone: 'warn', detail: 'Payment jitter observed over the past 24 hours.' },
        { label: 'Payout Success Rate', value: '81%', tone: 'danger', detail: '4 of 21 payments require recovery.' },
        { label: "Today's Blockers", value: '4', tone: 'danger', detail: '2 of these directly affect client settlement.' },
        { label: 'Requires Manual Retry', value: '3', tone: 'warn', detail: 'Wallet and escrow chain requires manual confirmation.' },
        { label: 'Client Escalation Risk', value: '2', tone: 'danger', detail: 'Two clients may follow up today.' },
        { label: 'Audit Events', value: '203', tone: 'default', detail: 'All recovery actions are traceable.' }
      ],
      blockers: [
        { title: 'Bounty payout signature mismatch', severity: 'critical', owner: 'Finance', age: '3h', impact: 'Payment failed. Client may question settlement reliability.', nextAction: 'Switch to a verified wallet, execute manual_retry, and attach the audit conclusion.' },
        { title: 'Reviewer has not approved high-risk PR', severity: 'critical', owner: 'Reviewer', age: '9h', impact: 'Task cannot enter payment approval. Today\'s client report will be blocked.', nextAction: 'Provide approve/reject within 2 hours and update the rationale.' },
        { title: 'Meegle state sync delayed', severity: 'warning', owner: 'Platform Ops', age: '1h', impact: 'External board and internal state are temporarily inconsistent.', nextAction: 'Run retryMeegle and confirm webhook recovery.' }
      ],
      reports: {
        daily: {
          title: 'Daily Ops Report',
          summary: "Today's focus is restoring payment reliability, not scaling volume.",
          bullets: ['3 tasks require manual_retry.', 'Communicate the failure reason and estimated recovery time to clients.', 'Send a follow-up client report and audit screenshot immediately after recovery.']
        },
        customer: {
          title: 'Client Report',
          summary: 'There are isolated payment recovery incidents, but the scope, ownership, and recovery actions are all clearly defined.',
          bullets: ['Clients should see a status of "identified, escalated, and trackable".', 'Do not just report failure — provide a retry strategy and estimated completion time.', 'The audit log can prove every handling step taken.']
        },
        weekly: {
          title: 'Weekly Project Report',
          summary: 'This week the priority is productizing the payment failure recovery process rather than relying on ad-hoc manual coordination.',
          bullets: ['Recommend building a standard card for the failureCode → retryStrategy mapping.', 'Feature escalated blockers on the first screen of the weekly report.', 'This scenario is suitable for internal presentations on operations and risk control capability.']
        }
      },
      integrations: [
        { integration: 'github_issue_sync', health: 'ok', summary: 'GitHub issue sync is operating normally.', consecutiveFailures: 0, lastSuccessAt: generatedAt },
        { integration: 'meegle_sync', health: 'degraded', summary: 'Most recent webhook was delayed by 47 minutes.', consecutiveFailures: 2, lastFailureAt: generatedAt }
      ],
      audit: { totalEvents: 203, todayEvents: 34, exportUrl: '/api/audit-logs?format=csv' }
    }
  }

  return {
    mode: 'demo',
    scenarioId,
    scenarioName: 'Client Demo: Weekly Project Report',
    generatedAt,
    companyScope: 'demo-enterprise',
    health: 'at_risk',
    headline: 'This dashboard is oriented toward client reporting. Key message: "Where is this project this week and what risks remain?"',
    subheadline: 'Overall progress is on track, but 2 cross-role dependencies require client awareness.',
    retryPolicy: 'For clients, only the principle is shown: system issues that can self-recover are auto-retried; anomalies involving fund or identity consistency are reviewed manually.',
    kpis: [
      { label: 'Weekly Goal Completion', value: '78%', tone: 'good', detail: '5 of 7 commitments completed.' },
      { label: 'Client-Visible Blockers', value: '2', tone: 'warn', detail: 'Both have assigned owners and next actions.' },
      { label: 'Payout Success Rate', value: '94%', tone: 'good', detail: '15 of 16 payments this week succeeded.' },
      { label: 'Median Review Time', value: '6.2h', tone: 'default', detail: 'Median time from submission to approval.' },
      { label: 'Audit Events Captured', value: '91', tone: 'default', detail: 'All key actions have an evidence trail.' },
      { label: 'Client Milestone Satisfaction', value: '4/5', tone: 'warn', detail: 'One milestone still awaiting client confirmation.' }
    ],
    blockers: [
      { title: 'Client-side reviewer has not confirmed supplementary requirements', severity: 'warning', owner: 'Customer', age: '1d', impact: 'Will affect next Monday\'s scheduling commitment.', nextAction: 'Drive client to confirm before the weekly meeting.' },
      { title: 'Payment receipt awaiting client finance sign-off', severity: 'warning', owner: 'Finance', age: '5h', impact: 'Does not affect on-chain payment, but will delay client internal archiving.', nextAction: 'Export CSV and daily report summary and send together.' }
    ],
    reports: {
      daily: {
        title: 'Daily Ops Report',
        summary: 'No platform-level incidents today. Focus is on clearly communicating client dependencies in advance.',
        bullets: ['Project delivery cadence is healthy.', 'Some dependencies still require client action.', 'Recommend placing client pending-confirmation items on the first screen of the daily report.']
      },
      customer: {
        title: 'Client Report',
        summary: 'Project progress this week is overall on track. The payment and audit chain is fully traceable. Remaining risks are limited to a small number of explainable dependencies.',
        bullets: ['Recommend presenting completed items by milestone.', 'Recommend expressing risk items with owner + deadline format.', 'Suitable for direct use in client weekly meeting materials.']
      },
      weekly: {
        title: 'Weekly Project Report',
        summary: 'This is a project-manager-oriented weekly report — not just reporting numbers, but explaining progress, risks, and next-week actions.',
        bullets: ['Suitable for both clients and executives to review.', 'Blockers, payment, and audit have been consolidated into a single view.', 'Next week\'s focus is closing 2 client dependencies.']
      }
    },
    integrations: [
      { integration: 'github_issue_sync', health: 'ok', summary: 'GitHub issue sync and webhook event ingestion have been stable this week.', consecutiveFailures: 0, lastSuccessAt: generatedAt },
      { integration: 'meegle_sync', health: 'ok', summary: 'Project management state sync is operating normally.', consecutiveFailures: 0, lastSuccessAt: generatedAt }
    ],
    audit: { totalEvents: 91, todayEvents: 13, exportUrl: '/api/audit-logs?format=csv' }
  }
}

export function listOpsScenarios() {
  return [
    { id: 'live' as const, name: 'Live Dashboard', description: 'Reads current real-time task, payment, audit, and alert data.' },
    { id: 'stable_exec' as const, name: 'Executive Demo: Stable Operations', description: 'Ideal for presenting stable operational capability to executives, sales, and partners.' },
    { id: 'payment_recovery' as const, name: 'Ops Demo: Payment Recovery', description: 'Focuses on anomaly detection, failure retry strategy, and accountability.' },
    { id: 'client_weekly' as const, name: 'Client Demo: Weekly Project Report', description: 'Suitable for client weekly meetings and project progress syncs.' }
  ]
}

export async function getOpsOverview(input: { scenarioId?: OpsScenarioId; companyId?: string } = {}): Promise<OpsOverviewSnapshot> {
  const scenarioId = input.scenarioId || 'live'
  if (scenarioId !== 'live') {
    return buildDemoOverview(scenarioId)
  }

  const [tasks, payments, notifications, integrations, auditLogs] = await Promise.all([
    safeListTasks(),
    safeListPayments(),
    listNotificationsDb({ companyId: input.companyId }),
    listIntegrationHealthStatesDb(),
    safeListAuditLogs(input.companyId)
  ])

  const filteredTasks = input.companyId ? tasks.filter((task) => !task.companyId || task.companyId === input.companyId) : tasks
  const filteredPayments = input.companyId ? payments.filter((payment) => !payment.companyId || payment.companyId === input.companyId) : payments
  const filteredNotifications = notifications

  return buildLiveOverview({
    tasks: filteredTasks,
    payments: filteredPayments,
    notifications: filteredNotifications,
    integrations,
    auditLogs,
    companyId: input.companyId
  })
}

export function renderOpsMarkdown(snapshot: OpsOverviewSnapshot, view: 'daily' | 'customer' | 'weekly') {
  const section = snapshot.reports[view]
  return [
    `# ${section.title}`,
    '',
    `- Generated at: ${snapshot.generatedAt}`,
    `- Mode: ${snapshot.mode === 'live' ? 'Live Dashboard' : `Demo / ${snapshot.scenarioName}`}`,
    `- Overall health: ${snapshot.health}`,
    '',
    section.summary,
    '',
    '## Key Metrics',
    ...snapshot.kpis.map((item) => `- ${item.label}: ${item.value} (${item.detail})`),
    '',
    '## Current Blockers',
    ...(snapshot.blockers.length > 0
      ? snapshot.blockers.map((item) => `- ${item.title} | owner=${item.owner} | impact=${item.impact} | next=${item.nextAction}`)
      : ['- No high-priority blockers at this time']),
    '',
    '## Summary',
    ...section.bullets.map((item) => `- ${item}`)
  ].join('\n')
}
