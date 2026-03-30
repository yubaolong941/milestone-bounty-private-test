'use client'

import { PaymentRecord } from '@/lib/types'

interface Props {
  payments: PaymentRecord[]
  filter?: 'all' | 'with_issue' | 'locked' | 'high_value'
}

export default function PaymentHistory({ payments, filter = 'all' }: Props) {
  const filteredPayments = [...payments].filter((payment) => {
    if (filter === 'with_issue') return Boolean(payment.issueNumber || payment.prUrl)
    if (filter === 'locked') return Boolean(payment.fundingLockId)
    if (filter === 'high_value') return payment.amount >= 100
    return true
  })

  if (filteredPayments.length === 0) {
    return (
      <div className="panel rounded-[20px] p-16 text-center">
        <p className="section-title">AgentLedger</p>
        <p className="mt-4 text-3xl font-semibold text-white">No payment records</p>
        <p className="mt-3 subtle">GitHub issues, PRs, claimers, AI review models, and on-chain transactions will be aggregated here into the minimal AgentLedger view.</p>
      </div>
    )
  }

  const total = filteredPayments.reduce((s, p) => s + p.amount, 0)
  const githubNativeCount = filteredPayments.filter((payment) => payment.issueNumber || payment.prUrl).length
  const lockedCount = filteredPayments.filter((payment) => payment.fundingLockId).length

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="panel rounded-2xl p-5">
          <p className="section-title">USD1 Payout</p>
          <p className="mt-3 text-3xl font-semibold text-apple-green">{total} USD1</p>
        </div>
        <div className="panel rounded-2xl p-5">
          <p className="section-title">Settlements</p>
          <p className="mt-3 text-3xl font-semibold text-white">{payments.length}</p>
        </div>
        <div className="panel rounded-2xl p-5">
          <p className="section-title">Locked Budget</p>
          <p className="mt-3 text-3xl font-semibold text-white">{lockedCount}</p>
        </div>
        <div className="panel rounded-2xl p-5">
          <p className="section-title">GitHub Native</p>
          <p className="mt-3 text-3xl font-semibold text-white">{githubNativeCount}</p>
          <p className="mt-2 text-xs subtle">Payouts with issue / PR metadata</p>
        </div>
      </div>

      <div className="space-y-3">
        {[...filteredPayments].reverse().map((p) => (
          <div key={p.id} className="panel rounded-2xl p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">Settled</span>
                  <span className="text-sm text-white">{p.projectName}</span>
                  {p.repo && <span className="chip">{p.repo}</span>}
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">{p.reportTitle || p.milestoneName}</h3>
                <p className="mt-2 text-sm subtle">Recipient: {p.toName}</p>
                {(p.fromName || p.fromAddress) && (
                  <p className="mt-1 text-xs text-gray-400">Payer: {p.fromName || '-'}{p.fromAddress ? ` · ${p.fromAddress}` : ''}</p>
                )}
                {p.claimerGithubLogin && <p className="mt-1 text-xs text-gray-400">Claimer: @{p.claimerGithubLogin}</p>}
                {p.rewardToken && <p className="mt-1 text-xs text-gray-400">Token: {p.rewardToken}</p>}
                {p.fundingLockId && <p className="mt-1 text-xs text-gray-400">Funding Lock：{p.fundingLockId}</p>}
                {p.issueNumber && (
                  <p className="mt-1 text-xs text-gray-400">
                    GitHub Issue: {p.issueUrl ? <a href={p.issueUrl} target="_blank" className="text-apple-blue underline">#{p.issueNumber}</a> : `#${p.issueNumber}`}
                  </p>
                )}
                {p.prUrl && <a href={p.prUrl} target="_blank" className="mt-1 block text-xs text-apple-blue underline">View merged PR</a>}
                {p.aiModelUsed && <p className="mt-1 text-xs text-gray-400">AI review model: {p.aiModelUsed}</p>}
                {p.verificationSnapshot && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="chip">merge {String(p.verificationSnapshot.merged ?? '-')}</span>
                    <span className="chip">CI {String(p.verificationSnapshot.ciPassed ?? '-')}</span>
                    <span className="chip">AI {String(p.verificationSnapshot.aiPassed ?? '-')}</span>
                    <span className="chip">review {String(p.verificationSnapshot.reviewApproved ?? '-')}</span>
                    <span className="chip">lock {String(p.verificationSnapshot.lockChecked ?? '-')}</span>
                  </div>
                )}
                {p.verificationSnapshot?.reviewDecision && (
                  <p className="mt-2 text-xs text-gray-400">Review decision: {p.verificationSnapshot.reviewDecision}</p>
                )}
                {p.verificationSnapshot?.checksDetail && (
                  <p className="mt-1 text-xs text-gray-400">Checks: {p.verificationSnapshot.checksDetail}</p>
                )}
                {p.verificationSnapshot?.failureCode && (
                  <p className="mt-1 text-xs text-gray-400">Failure Code: {String(p.verificationSnapshot.failureCode)}</p>
                )}
                {p.verificationSnapshot?.retryStrategy && (
                  <p className="mt-1 text-xs text-gray-400">Retry Strategy: {String(p.verificationSnapshot.retryStrategy)}</p>
                )}
                {p.verificationSnapshot?.prAuthor && (
                  <p className="mt-1 text-xs text-gray-400">PR author: @{p.verificationSnapshot.prAuthor}</p>
                )}
                <p className="mt-1 break-all text-xs font-mono text-slate-300/70">{p.toAddress}</p>
                <div className="mt-3 rounded-[10px] border border-apple-green/15 bg-apple-green/8 p-3">
                  <p className="break-all text-xs font-mono text-apple-green/85">TxHash: {p.txHash}</p>
                </div>
              </div>
              <div className="shrink-0 rounded-xl border border-white/[0.08] bg-white/5 px-4 py-3 text-right">
                <p className="text-2xl font-semibold text-apple-green">+{p.amount}</p>
                <p className="mt-1 text-xs subtle">{p.rewardToken || 'USD1'}</p>
                <p className="mt-2 text-xs subtle">
                  {new Date(p.timestamp).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
