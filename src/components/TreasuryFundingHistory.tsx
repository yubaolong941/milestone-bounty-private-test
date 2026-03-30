'use client'

import { TreasuryFundingRecord } from '@/lib/types'

interface Props {
  items: TreasuryFundingRecord[]
}

export default function TreasuryFundingHistory({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="panel rounded-2xl p-8 text-center">
        <p className="section-title">Treasury Funding</p>
        <p className="mt-4 text-2xl font-semibold text-white">No platform funding records</p>
        <p className="mt-2 subtle">Records of companies funding the treasury before creating external bounties are stored here, preventing context loss between payment and task creation.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="panel rounded-2xl p-5">
        <p className="section-title">Treasury Funding</p>
        <h3 className="mt-2 text-2xl font-semibold text-white">Platform funding records</h3>
        <p className="mt-2 text-sm subtle">Historical payments from companies into the platform treasury. These records are preserved even if the external bounty has not been created yet.</p>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${item.txHash}-${item.status}`} className="panel rounded-2xl p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <span className="chip">{item.status === 'applied' ? 'Linked to task' : 'Recorded only'}</span>
                  <span className="chip">{item.tokenSymbol}</span>
                  {item.network && <span className="chip">{item.network.toUpperCase()}</span>}
                  {item.companyName && <span className="chip">{item.companyName}</span>}
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{item.amount} {item.tokenSymbol}</p>
                {item.taskTitle && <p className="mt-2 text-sm subtle">Linked task: {item.taskTitle}</p>}
                {item.fromAddress && <p className="mt-1 break-all text-xs text-gray-400">Payer wallet: {item.fromAddress}</p>}
                {item.toAddress && <p className="mt-1 break-all text-xs text-gray-400">Platform receiving address: {item.toAddress}</p>}
                <div className="mt-3 rounded-[10px] border border-apple-blue/15 bg-apple-blue/8 p-3">
                  <p className="break-all text-xs font-mono text-apple-blue/85">TxHash: {item.txHash}</p>
                </div>
              </div>
              <div className="shrink-0 rounded-xl border border-white/[0.08] bg-white/5 px-4 py-3 text-right">
                <p className="text-sm text-white">{item.status === 'applied' ? 'Used' : 'Available / unlinked'}</p>
                <p className="mt-2 text-xs subtle">
                  {new Date(item.createdAt).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
