import { NextResponse } from 'next/server'
import { inferHealthCheck } from '@/lib/ai'

export async function GET() {
  const result = await inferHealthCheck()
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 })
  }
  return NextResponse.json(result)
}
