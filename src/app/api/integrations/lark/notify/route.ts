import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.json()
  const receiveId = body?.receiveId || process.env.LARK_DEFAULT_RECEIVE_ID || ''
  if (!receiveId) {
    return NextResponse.json({ error: '缺少 receiveId，且未配置 LARK_DEFAULT_RECEIVE_ID' }, { status: 400 })
  }

  // 本地联调版本：仅回显通知内容，避免依赖企业私有凭据。
  return NextResponse.json({
    success: true,
    mocked: true,
    receiveId,
    message: body?.message || 'Task bounty awaiting approval'
  })
}
