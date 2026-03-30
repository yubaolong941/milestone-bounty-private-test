import { NextResponse } from 'next/server'
import { getCompanyContext, getSessionFromRequest, withSession } from '@/lib/auth'

export async function GET(req: Request) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ loggedIn: false }, { status: 401 })
  const companyContext = await getCompanyContext(session)
  const resolvedSession = companyContext
    ? {
      ...session,
      activeCompanyId: session.activeCompanyId || companyContext.company.id,
      activeCompanyRole: session.activeCompanyRole || companyContext.membership?.role
    }
    : session

  return withSession(
    resolvedSession,
    NextResponse.json({ loggedIn: true, session: resolvedSession, companyContext })
  )
}
