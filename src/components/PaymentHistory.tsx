'use client'

import { PaymentRecord } from '@/lib/types'

interface Props {
  payments: PaymentRecord[]
}

export default function PaymentHistory({ payments }: Props) {
  if (payments.length === 0) {
    return (
      <div className="glass rounded-xl p-16 text-center">
        <p className="text-4xl mb-4">💸</p>
        <p className="text-gray-400 mb-2">暂无支付记录</p>
        <p className="text-sm text-gray-600">漏洞复核通过后，赏金支付记录将在这里显示</p>
      </div>
    )
  }

  const total = payments.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">累计发放赏金</p>
          <p className="text-2xl font-bold text-green-400">{total}U</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">交易笔数</p>
          <p className="text-2xl font-bold text-white">{payments.length}</p>
        </div>
      </div>

      <div className="space-y-3">
        {[...payments].reverse().map(p => (
          <div key={p.id} className="glass rounded-xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                  <p className="font-medium text-sm text-white">{p.reportTitle || p.milestoneName}</p>
                  <span className="text-xs text-gray-500">{p.projectName}</span>
                  {p.severity && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 uppercase">
                      {p.severity}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-1">→ {p.toName}</p>
                <p className="text-xs font-mono text-gray-600 truncate">
                  {p.toAddress}
                </p>
                <p className="text-xs font-mono text-green-600 truncate mt-1">
                  TxHash: {p.txHash}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-green-400">+{p.amount}U</p>
                <p className="text-xs text-gray-600">
                  {new Date(p.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
