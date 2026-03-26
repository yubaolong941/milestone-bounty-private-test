import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID
  const appBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  if (!clientId) {
    return NextResponse.json({ error: '未配置 GITHUB_CLIENT_ID' }, { status: 400 })
  }
  const redirectUri = `${appBaseUrl}/api/auth/github/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state: 'bp-github-oauth:github_code_bounty'
  })
  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
}
