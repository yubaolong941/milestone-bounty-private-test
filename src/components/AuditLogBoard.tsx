'use client'

import { useEffect, useState } from 'react'

interface AuditLogItem {
  id: string
  action: string
  summary: string
  actorUserId: string
  createdAt: string
}

export default function AuditLogBoard() {
  const [items, setItems] = useState<AuditLogItem[]>([])

  useEffect(() => {
    fetch('/api/audit-logs')
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <a href="/api/audit-logs?format=csv" className="btn-secondary">Export CSV</a>
      </div>
      {items.length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center subtle">No audit logs</div>
      ) : items.map((item) => (
        <div key={item.id} className="panel rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <span className="chip">{item.action}</span>
            <p className="text-sm subtle">{item.actorUserId}</p>
          </div>
          <p className="mt-3 text-white font-medium">{item.summary}</p>
          <p className="mt-2 text-xs subtle">{new Date(item.createdAt).toLocaleString('en-US')}</p>
        </div>
      ))}
    </div>
  )
}
