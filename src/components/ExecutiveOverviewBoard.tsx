'use client'

import { useEffect, useMemo, useState } from 'react'
import type { OpsOverviewSnapshot, OpsScenarioId } from '@/lib/ops-overview'
import { SkeletonCard } from '@/components/SkeletonLoader'

interface ScenarioOption {
  id: OpsScenarioId
  name: string
  description: string
}

interface Payload extends OpsOverviewSnapshot {
  scenarios: ScenarioOption[]
}

const HEALTH_STYLE: Record<OpsOverviewSnapshot['health'], string> = {
  healthy: 'text-apple-green border-apple-green/25 bg-apple-green/10',
  at_risk: 'text-apple-orange border-apple-orange/25 bg-apple-orange/10',
  critical: 'text-apple-red border-apple-red/25 bg-apple-red/10'
}

const KPI_STYLE = {
  default: 'text-white',
  good: 'text-apple-green',
  warn: 'text-apple-orange',
  danger: 'text-apple-red'
} as const

export default function ExecutiveOverviewBoard() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [scenario, setScenario] = useState<OpsScenarioId>('live')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialScenario = (params.get('scenario') || 'live') as OpsScenarioId
    setScenario(initialScenario)
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const res = await fetch(`/api/ops/overview?scenario=${scenario}`)
      const payload = await res.json()
      setData(payload)
      setLoading(false)
    }
    load()
  }, [scenario])

  const exportLinks = useMemo(() => ({
    daily: `/api/ops/overview?scenario=${scenario}&view=daily&format=md`,
    customer: `/api/ops/overview?scenario=${scenario}&view=customer&format=md`,
    weekly: `/api/ops/overview?scenario=${scenario}&view=weekly&format=md`,
    kpis: `/api/ops/overview?scenario=${scenario}&format=csv`
  }), [scenario])

  const onScenarioChange = (value: OpsScenarioId) => {
    setScenario(value)
    const url = new URL(window.location.href)
    url.searchParams.set('scenario', value)
    window.history.replaceState({}, '', url.toString())
  }

  if (loading || !data) {
    return <SkeletonCard />
  }

  return (
    <div className="space-y-4">
      <section className="hero-card rounded-[20px] p-6 md:p-8">
        <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <span className="chip">executive overview</span>
              <span className="chip">{data.mode === 'live' ? 'live mode' : 'demo mode'}</span>
              <span className={`chip border ${HEALTH_STYLE[data.health]}`}>{data.health}</span>
            </div>
            <div>
              <p className="section-title">Management Lens</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-white md:text-4xl">{data.headline}</h2>
            </div>
            <p className="max-w-3xl text-sm leading-7 subtle md:text-base">{data.subheadline}</p>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
              <p className="text-sm font-semibold text-white">Failure retry policy</p>
              <p className="mt-2 text-sm leading-6 subtle">{data.retryPolicy}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={exportLinks.daily} className="btn-primary">Export daily report</a>
              <a href={exportLinks.customer} className="btn-secondary">Export client report</a>
              <a href={exportLinks.weekly} className="btn-ghost">Export weekly report</a>
              <a href={data.audit.exportUrl} className="btn-ghost">Export audit CSV</a>
            </div>
          </div>

          <div className="panel rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-title">Demo Control</p>
                <p className="mt-2 text-xl font-semibold text-white">Switchable, reproducible demo scenarios</p>
              </div>
              <a href={exportLinks.kpis} className="btn-ghost">Export KPI</a>
            </div>
            <div className="mt-5 grid gap-3">
              {data.scenarios.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onScenarioChange(item.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    scenario === item.id
                      ? 'border-apple-blue/40 bg-apple-blue/15'
                      : 'border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{item.name}</p>
                    <span className="chip">{item.id}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 subtle">{item.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {data.kpis.map((item) => (
          <div key={item.label} className="panel metric-card rounded-2xl p-5">
            <p className="section-title">{item.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${KPI_STYLE[item.tone]}`}>{item.value}</p>
            <p className="mt-2 text-xs subtle">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
        <div className="panel rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-title">Today Blockers</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">What is blocking today</h3>
            </div>
            <span className="chip">{data.blockers.length} items</span>
          </div>
          <div className="mt-5 space-y-3">
            {data.blockers.length === 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-5 text-sm subtle">No high-priority blockers at this time.</div>
            ) : data.blockers.map((item) => (
              <div key={`${item.title}-${item.owner}`} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip border ${item.severity === 'critical' ? 'border-apple-red/25 bg-apple-red/10 text-apple-red' : 'border-apple-orange/25 bg-apple-orange/10 text-apple-orange'}`}>{item.severity}</span>
                  <span className="chip">{item.owner}</span>
                  <span className="chip">age {item.age}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{item.title}</p>
                <p className="mt-2 text-sm leading-6 subtle">{item.impact}</p>
                <p className="mt-3 text-sm text-white">Next step: <span className="subtle">{item.nextAction}</span></p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel rounded-2xl p-6">
          <p className="section-title">Integration Status</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Status page and runtime metrics</h3>
          <div className="mt-5 grid gap-3">
            {data.integrations.map((item) => (
              <div key={item.integration} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{item.integration}</p>
                  <span className={`chip border ${item.health === 'ok' ? 'border-apple-green/25 bg-apple-green/10 text-apple-green' : item.health === 'degraded' ? 'border-apple-red/25 bg-apple-red/10 text-apple-red' : 'border-apple-orange/25 bg-apple-orange/10 text-apple-orange'}`}>{item.health}</span>
                </div>
                <p className="mt-2 text-sm leading-6 subtle">{item.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="chip">Consecutive failures {item.consecutiveFailures}</span>
                  {item.lastSuccessAt && <span className="chip">Success {new Date(item.lastSuccessAt).toLocaleString('en-US')}</span>}
                  {item.lastFailureAt && <span className="chip">Failure {new Date(item.lastFailureAt).toLocaleString('en-US')}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          { id: 'daily', report: data.reports.daily },
          { id: 'customer', report: data.reports.customer },
          { id: 'weekly', report: data.reports.weekly }
        ].map(({ id, report }) => (
          <div key={id} className="panel rounded-2xl p-6">
            <p className="section-title">{report.title}</p>
            <p className="mt-3 text-xl font-semibold text-white">{report.summary}</p>
            <div className="mt-5 space-y-3">
              {report.bullets.map((item: string) => (
                <div key={item} className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-4 text-sm leading-6 subtle">
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
