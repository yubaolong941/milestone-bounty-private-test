import { NextResponse } from 'next/server'
import { loadPayments } from '@/lib/storage'

export async function GET() {
  return NextResponse.json(loadPayments())
}
