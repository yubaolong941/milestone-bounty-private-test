'use client'

import { useEffect, useMemo, useState } from 'react'

interface NotificationItem {
  id: string
  severity: 'info' | 'warning' | 'critical'
  channel: 'inbox' | 'lark'
  category: string
  title: string
  message: string
  taskId?: string
  taskTitle?: string
  actionUrl?: string
  acknowledged: boolean
  createdAt: string
}

const COLOR_MAP: Record<NotificationItem['severity'], string> = {
  info: 'text-apple-blue border-apple-blue/25 bg-apple-blue/10',
  warning: 'text-apple-orange border-apple-orange/25 bg-apple-orange/10',
  critical: 'text-apple-red border-apple-red/25 bg-apple-red/10'
}

const PRIORITY_MAP: Record<NotificationItem['severity'], number> = {
  critical: 3,
  warning: 2,
  info: 1
}

function getHoursSince(createdAt: string) {
  const diff = Date.now() - new Date(createdAt).getTime()
  if (Number.isNaN(diff)) return 0
  return Math.max(0, Math.round(diff / (1000 * 60 * 60)))
}

function getSlaLabel(item: NotificationItem) {
  const hours = getHoursSince(item.createdAt)
  if (item.severity === 'critical') {
    return hours >= 2 ? 'SLA breached' : `${Math.max(0, 2 - hours)}h remaining`
  }
  if (item.severity === 'warning') {
    return hours >= 8 ? 'SLA breached' : `${Math.max(0, 8 - hours)}h remaining`
  }
  return hours >= 24 ? 'Handle soon' : `${Math.max(0, 24 - hours)}h remaining`
}

function getRecommendedAction(item: NotificationItem) {
  if (item.category === 'payment_failure') return 'Check failure reason, retry strategy, and wallet availability before escalating to finance or reviewer.'
  if (item.category === 'manual_review') return 'Open the manual review board and record an approve, reject, or supplement decision promptly.'
  if (item.category === 'integration') return 'Confirm whether the sync link is interrupted to prevent external state from diverging further from platform facts.'
  if (item.category === 'escrow') return 'Verify budget lock or release status to ensure payout commitment matches on-chain state.'
  return 'Open the relevant workspace, confirm current state, record your decision, and close the loop.'
}

export default function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [filter, setFilter] = useState<'all' | NotificationItem['severity']>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/notifications?acknowledged=false')
    const data = await res.json().catch(() => [])
    const nextItems: NotificationItem[] = Array.isArray(data) ? data : []
    nextItems.sort((a, b) => {
      const priorityDiff = PRIORITY_MAP[b.severity] - PRIORITY_MAP[a.severity]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
    setItems(nextItems)
  }

  useEffect(() => { load() }, [])

  const ack = async (id: string) => {
    setBusyId(id)
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'ack' })
    })
    setBusyId(null)
    load()
  }

  const filteredItems = useMemo(
    () => items.filter((item) => filter === 'all' || item.severity === filter),
    [filter, items]
  )

  const summary = useMemo(
    () => ({
      critical: items.filter((item) => item.severity === 'critical').length,
      warning: items.filter((item) => item.severity === 'warning').length,
      info: items.filter((item) => item.severity === 'info').length,
      breached: items.filter((item) => getSlaLabel(item) === 'SLA breached').length
    }),
    [items]
  )

  if (items.length === 0) {
    return (
      <div className="panel rounded-[20px] p-10 text-center">
        <p className="text-lg font-semibold text-white">No unhandled notifications or alerts</p>
        <p className="mt-3 text-sm leading-6 subtle">
          The alert center is the entry point for ops duty. New payment failures, review requests, or integration issues will be automatically prioritized here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Critical', String(summary.critical), 'Assign owner immediately'],
          ['Warning', String(summary.warning), 'Handle within the day'],
          ['Info', String(summary.info), 'Track status changes'],
          ['SLA risk', String(summary.breached), 'Overdue or approaching deadline']
        ].map(([label, value, desc]) => (
          <div key={label} className="panel rounded-2xl p-5">
            <p className="section-title">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            <p className="mt-2 text-sm subtle">{desc}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ['all', 'All'],
          ['critical', 'Critical'],
          ['warning', 'Warning'],
          ['info', 'Info']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key as 'all' | NotificationItem['severity'])}
            className={`filter-chip ${filter === key ? 'filter-chip-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredItems.map((item) => (
        <div key={item.id} className={`panel rounded-[20px] border p-5 ${COLOR_MAP[item.severity]}`}>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">P{PRIORITY_MAP[item.severity]}</span>
                <span className="chip">{item.severity}</span>
                <span className="chip">{item.category}</span>
                <span className="chip">{item.channel}</span>
                <span className="chip">{getSlaLabel(item)}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-6">{item.message}</p>
              {item.taskTitle && <p className="mt-3 text-xs subtle">Related task: {item.taskTitle}</p>}
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-black/10 p-4">
              <p className="section-title">Recommended Action</p>
              <p className="mt-3 text-sm leading-6 subtle">{getRecommendedAction(item)}</p>
              <p className="mt-4 text-xs subtle">Triggered: {new Date(item.createdAt).toLocaleString('en-US')}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {item.actionUrl && <a href={item.actionUrl} className="btn-secondary">Open workspace</a>}
                <button onClick={() => ack(item.id)} className="btn-ghost" disabled={busyId === item.id}>
                  {busyId === item.id ? 'Processing...' : 'Mark as handled'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {filteredItems.length === 0 && (
        <div className="panel rounded-2xl p-8 text-center subtle">
          No alerts under this filter. Switch to All to see the full pending list.
        </div>
      )}
    </div>
  )
}
