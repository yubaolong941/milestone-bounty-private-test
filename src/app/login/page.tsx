'use client'

import { useState } from 'react'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')

  const devLogin = async (role: 'staff' | 'external_contributor', externalAuthType?: 'github_code_bounty' | 'wallet_security_bounty') => {
    setLoading(true)
    await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, externalAuthType, walletAddress })
    })
    window.location.href = role === 'staff' ? '/staff' : '/external'
  }

  const walletLogin = async () => {
    setLoading(true)
    const res = await fetch('/api/auth/wallet-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      window.alert(data?.error || '钱包登录失败')
      setLoading(false)
      return
    }
    window.location.href = '/external'
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass rounded-2xl p-6 w-full max-w-xl space-y-4">
        <h1 className="text-xl font-semibold">登录 BountyPay</h1>
        <p className="text-sm text-gray-400">外部工作者分两类：代码悬赏走 GitHub，安全漏洞赏金走钱包登录。</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button disabled={loading} onClick={() => devLogin('staff')} className="px-4 py-3 rounded-lg bg-sky-600 text-sm">
            内部员工登录（Demo）
          </button>
          <button disabled={loading} onClick={() => devLogin('external_contributor', 'github_code_bounty')} className="px-4 py-3 rounded-lg bg-emerald-600 text-sm">
            外部代码悬赏（Demo）
          </button>
        </div>
        <a href="/api/auth/github/start" className="block w-full text-center px-4 py-3 rounded-lg bg-gray-800 border border-white/10 text-sm">
          使用 GitHub 登录（代码悬赏）
        </a>
        <div className="border border-white/10 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-400">安全漏洞赏金（钱包登录）</p>
          <input
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="0x..."
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button disabled={loading || !walletAddress} onClick={walletLogin} className="px-4 py-2 rounded bg-amber-600 text-sm">
              钱包登录
            </button>
            <button disabled={loading} onClick={() => devLogin('external_contributor', 'wallet_security_bounty')} className="px-4 py-2 rounded bg-amber-800 text-sm">
              钱包登录（Demo）
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
