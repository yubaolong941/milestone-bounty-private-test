'use client'

import { useEffect, useState } from 'react'
import { SkeletonLoader } from '@/components/SkeletonLoader'

interface IntegrationState {
  integration: string
  lastStatus: 'success' | 'failure'
  lastSuccessAt?: string
  lastFailureAt?: string
  lastDetail: string
  consecutiveFailures: number
  updatedAt: string
  health: 'ok' | 'degraded' | 'stale' | 'unknown'
}

interface HealthPayload {
  checkedAt: string
  ai?: {
    ok: boolean
    detail?: string
    provider?: string
    model?: string
  }
  treasuryPayout?: {
    ok: boolean
    health: 'ok' | 'degraded' | 'missing'
    provider: 'wlfi' | 'agentpay' | 'mock' | 'evm_private_key'
    configuredAddress?: string
    currentAddress?: string
    network: string
    runtimeNetwork?: string
    tokenSymbol: string
    runtimeTokenSymbol?: string
    tokenAddress?: string
    runtimeTokenAddress?: string
    detail: string
    driftReasons: string[]
  }
  integrations: IntegrationState[]
}

const HEALTH_COLOR: Record<IntegrationState['health'], string> = {
  ok: 'text-apple-green',
  degraded: 'text-apple-red',
  stale: 'text-apple-orange',
  unknown: 'text-white/40'
}

const TREASURY_HEALTH_COLOR: Record<'ok' | 'degraded' | 'missing', string> = {
  ok: 'text-apple-green',
  degraded: 'text-apple-red',
  missing: 'text-apple-orange'
}

export default function IntegrationHealthBoard() {
  const [data, setData] = useState<HealthPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const res = await fetch('/api/integrations/health')
    const payload = await res.json()
    setData(payload)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const retry = async (action: 'retryAll' | 'retryMeegle' | 'retryGitHub') => {
    setRetrying(action)
    const res = await fetch('/api/integrations/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
    const payload = await res.json()
    if (!res.ok) {
      window.alert(payload?.error || payload?.result?.detail || 'Retry failed')
    }
    await load()
    setRetrying(null)
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm">Integration health check</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => retry('retryMeegle')} disabled={retrying !== null} className="btn-ghost text-xs disabled:opacity-60">Retry Meegle</button>
          <button onClick={() => retry('retryGitHub')} disabled={retrying !== null} className="btn-ghost text-xs disabled:opacity-60">Retry GitHub</button>
          <button onClick={() => retry('retryAll')} disabled={retrying !== null} className="btn-ghost text-xs disabled:opacity-60">Retry all</button>
        </div>
      </div>

      {loading ? (
        <SkeletonLoader className="glass rounded-xl p-8" />
      ) : (
        <>
          <div className="glass rounded-xl p-4">
            <p className="text-sm font-medium mb-2">AI inference health</p>
            <p className={`text-sm ${data?.ai?.ok ? 'text-apple-green' : 'text-apple-red'}`}>
              {data?.ai?.ok ? 'Available' : 'Degraded'}
            </p>
            <p className="text-xs text-gray-500 mt-1">{data?.ai?.detail || '-'}</p>
          </div>

          <div className="glass rounded-xl p-4">
            <p className="text-sm font-medium mb-2">Platform managed payout wallet</p>
            <p className={`text-sm ${TREASURY_HEALTH_COLOR[data?.treasuryPayout?.health || 'missing']}`}>
              {data?.treasuryPayout?.health || 'missing'}
            </p>
            <p className="text-xs text-gray-500 mt-1">{data?.treasuryPayout?.detail || '-'}</p>
            <p className="text-xs text-gray-500 mt-1">Provider: {data?.treasuryPayout?.provider || '-'}</p>
            <p className="text-xs text-gray-500">Configured address: {data?.treasuryPayout?.configuredAddress || '-'}</p>
            <p className="text-xs text-gray-500">Current address: {data?.treasuryPayout?.currentAddress || '-'}</p>
            <p className="text-xs text-gray-500">Configured network: {data?.treasuryPayout?.network || '-'}</p>
            <p className="text-xs text-gray-500">Runtime network: {data?.treasuryPayout?.runtimeNetwork || '-'}</p>
            <p className="text-xs text-gray-500">Configured token: {data?.treasuryPayout?.tokenSymbol || '-'} / {data?.treasuryPayout?.tokenAddress || '-'}</p>
            <p className="text-xs text-gray-500">Runtime token: {data?.treasuryPayout?.runtimeTokenSymbol || '-'} / {data?.treasuryPayout?.runtimeTokenAddress || '-'}</p>
            {(data?.treasuryPayout?.driftReasons || []).length > 0 && (
              <div className="mt-2 space-y-1">
                {data?.treasuryPayout?.driftReasons.map((reason) => (
                  <p key={reason} className="text-xs text-rose-300">{reason}</p>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(data?.integrations || []).map((item) => (
              <div key={item.integration} className="glass rounded-xl p-4">
                <p className="font-medium">{item.integration}</p>
                <p className={`text-sm mt-1 ${HEALTH_COLOR[item.health]}`}>{item.health}</p>
                <p className="text-xs text-gray-500 mt-1">{item.lastStatus}</p>
                <p className="text-xs text-gray-500">{item.lastSuccessAt || '-'}</p>
                <p className="text-xs text-gray-500">{item.lastFailureAt || '-'}</p>
                <p className="text-xs text-gray-500">{item.consecutiveFailures}</p>
                <p className="text-xs text-gray-500 mt-2 break-all">{item.lastDetail}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">{data?.checkedAt || '-'}</p>
        </>
      )}
    </div>
  )
}
