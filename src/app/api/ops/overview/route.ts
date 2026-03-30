import { NextResponse } from 'next/server'
import { getCompanyContext, isPlatformAdmin, requireInternalUser } from '@/lib/auth'
import { getOpsOverview, listOpsScenarios, OpsScenarioId, renderOpsMarkdown } from '@/lib/ops-overview'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const scenarioId = (url.searchParams.get('scenario') || 'live') as OpsScenarioId
  const format = url.searchParams.get('format') || 'json'
  const view = (url.searchParams.get('view') || 'daily') as 'daily' | 'customer' | 'weekly'

  const companyContext = isPlatformAdmin(auth.session)
    ? null
    : await getCompanyContext(auth.session)

  const snapshot = await getOpsOverview({
    scenarioId,
    companyId: companyContext?.company.id || auth.session.activeCompanyId
  })

  if (format === 'md') {
    const markdown = renderOpsMarkdown(snapshot, view)
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="ops-${view}-${scenarioId}.md"`
      }
    })
  }

  if (format === 'csv') {
    const lines = [
      'label,value,detail',
      ...snapshot.kpis.map((item) => [item.label, item.value, JSON.stringify(item.detail)].join(','))
    ]
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ops-kpis-${scenarioId}.csv"`
      }
    })
  }

  return NextResponse.json({
    ...snapshot,
    scenarios: listOpsScenarios()
  })
}
