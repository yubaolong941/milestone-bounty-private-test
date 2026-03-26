import { NextResponse } from 'next/server'
import { withSession } from '@/lib/auth'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') || ''
  if (!code) return NextResponse.json({ error: '缺少 code' }, { status: 400 })

  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: '未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET' }, { status: 400 })
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  })
  if (!tokenRes.ok) return NextResponse.json({ error: 'GitHub token exchange 失败' }, { status: 400 })
  const tokenData = await tokenRes.json()
  const accessToken = tokenData?.access_token
  if (!accessToken) return NextResponse.json({ error: '未获取到 access_token' }, { status: 400 })

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' }
  })
  if (!userRes.ok) return NextResponse.json({ error: '获取 GitHub 用户信息失败' }, { status: 400 })
  const user = await userRes.json()

  const response = NextResponse.redirect(`${appBaseUrl}/external`)
  return withSession(
    {
      userId: String(user?.id || 'github-user'),
      role: 'external_contributor',
      githubLogin: user?.login || 'unknown',
      externalAuthType: state.includes('github_code_bounty') ? 'github_code_bounty' : 'github_code_bounty'
    },
    response
  )
}
