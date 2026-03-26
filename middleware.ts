import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type Role = 'admin' | 'reviewer' | 'finance' | 'staff' | 'external_contributor'

function getRole(req: NextRequest): Role | null {
  const v = req.cookies.get('bp_session')?.value
  if (!v) return null
  try {
    const payload = JSON.parse(Buffer.from(v, 'base64url').toString('utf-8')) as { role?: Role }
    return payload.role || null
  } catch {
    return null
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/api/auth')) return NextResponse.next()
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next()

  const role = getRole(req)

  if (pathname.startsWith('/staff')) {
    if (!role || !['admin', 'reviewer', 'finance', 'staff'].includes(role)) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  if (pathname.startsWith('/external')) {
    if (!role || !['admin', 'external_contributor'].includes(role)) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/staff/:path*', '/external/:path*']
}
