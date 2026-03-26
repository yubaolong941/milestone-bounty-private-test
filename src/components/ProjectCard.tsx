'use client'

import { useState } from 'react'
import { Project, VulnerabilityReport, getReports } from '@/lib/types'

const STATUS_LABELS: Record<string, string> = {
  pending: '待分拣',
  reviewing: 'AI 初审中',
  awaiting_manual_review: '待人工复核',
  approved: '已复核',
  paid: '已支付',
  overdue: '已逾期',
  rejected: '已驳回'
}

interface Props {
  project: Project
  onUpdate: () => void
}

export default function ProjectCard({ project, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(true)
  const [completing, setCompleting] = useState<string | null>(null)
  const reports = getReports(project)
  const [result, setResult] = useState<{ milestoneId: string; success: boolean; summary: string; txHash?: string } | null>(null)

  const handleComplete = async (milestone: VulnerabilityReport) => {
    if (completing) return
    setCompleting(milestone.id)
    setResult(null)

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, milestoneId: milestone.id, action: 'aiReview' })
      })
      const data = await res.json()
      setResult({ milestoneId: milestone.id, success: data.success, summary: data.summary, txHash: data.txHash })
      onUpdate()
    } finally {
      setCompleting(null)
    }
  }

  const handleApproveAndPay = async (milestone: VulnerabilityReport) => {
    if (completing) return
    setCompleting(milestone.id)
    setResult(null)

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, milestoneId: milestone.id, action: 'approveAndPay' })
      })
      const data = await res.json()
      setResult({ milestoneId: milestone.id, success: data.success, summary: data.summary || data.error, txHash: data.txHash })
      onUpdate()
    } finally {
      setCompleting(null)
    }
  }

  const paid = reports.filter(m => m.status === 'paid').length
  const total = reports.length
  const progress = total > 0 ? (paid / total) * 100 : 0

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div
        className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-sky-400"></div>
          <div>
            <h3 className="font-semibold text-white">{project.name}</h3>
            <p className="text-xs text-gray-500">{project.description || '暂无描述'}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{paid}/{total} 漏洞单</span>
          <span className="text-yellow-400">{project.spentAmount}/{project.totalBudget}U</span>
          <span className={expanded ? 'rotate-180' : ''} style={{ transition: 'transform 0.2s' }}>▼</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-white/5">
        <div className="h-full bg-gradient-to-r from-sky-500 to-blue-600 transition-all" style={{ width: `${progress}%` }} />
      </div>

      {expanded && (
        <div className="p-5 space-y-3">
          {reports.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-4">暂无漏洞报告</p>
          ) : (
            reports.map(m => (
              <div key={m.id} className="rounded-lg bg-white/3 border border-white/6 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full status-${m.status}`}>
                        {STATUS_LABELS[m.status]}
                      </span>
                      <h4 className="font-medium text-sm text-white">{m.name}</h4>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 uppercase">
                        {m.severity || 'unknown'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-1">复现条件：{m.completionCriteria}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span>研究员：{m.assigneeName}</span>
                      <span>赏金：<span className="text-yellow-400 font-medium">{m.rewardAmount}U</span></span>
                      <span>提交截止：{m.deadline}</span>
                    </div>
                    {m.aiReviewSummary && (
                      <div className="mt-2 text-xs text-sky-400 bg-sky-500/10 rounded px-2 py-1">
                        AI 初审：{m.aiReviewSummary}
                      </div>
                    )}
                    {m.txHash && (
                      <div className="mt-1 text-xs text-green-400 font-mono truncate">
                        TxHash: {m.txHash}
                      </div>
                    )}
                    {result?.milestoneId === m.id && (
                      <div className={`mt-2 text-xs rounded px-2 py-1 ${result.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {result.success ? `赏金支付成功！${result.txHash ? `TxHash: ${result.txHash.slice(0, 20)}...` : ''}` : result.summary}
                      </div>
                    )}
                  </div>
                  {m.status === 'pending' && (
                    <button
                      onClick={() => handleComplete(m)}
                      disabled={completing === m.id}
                      className="shrink-0 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      {completing === m.id ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          <span>AI 初审中...</span>
                        </>
                      ) : '发起复核'}
                    </button>
                  )}
                  {m.status === 'awaiting_manual_review' && (
                    <button
                      onClick={() => handleApproveAndPay(m)}
                      disabled={completing === m.id}
                      className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-medium transition-colors"
                    >
                      {completing === m.id ? '支付中...' : '人工复核通过并支付'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
