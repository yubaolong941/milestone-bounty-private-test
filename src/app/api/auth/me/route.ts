import { NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export async function GET(req: Request) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ loggedIn: false }, { status: 401 })
  return NextResponse.json({ loggedIn: true, session })
}
