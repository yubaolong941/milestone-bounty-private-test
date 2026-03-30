import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { getMysqlHealth } from '@/lib/db'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  try {
    const result = await getMysqlHealth()
    return NextResponse.json({ success: true, mysql: result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
