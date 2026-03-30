import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { decodeSessionEdge } from '@/lib/session'
import { canAccessExternalConsole, canAccessInternalConsole } from '@/lib/permissions'

async function getSession(req: NextRequest) {
  const value = req.cookies.get('bp_session')?.value
  return value ? decodeSessionEdge(value) : null
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/api/auth')) return NextResponse.next()
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next()

  const session = await getSession(req)

  if (pathname.startsWith('/staff')) {
    if (!canAccessInternalConsole(session)) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  if (pathname.startsWith('/external')) {
    if (!canAccessExternalConsole(session)) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/staff', '/staff/:path*', '/external', '/external/:path*']
}
