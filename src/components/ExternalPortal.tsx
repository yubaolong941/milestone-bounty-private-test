'use client'

import { useEffect, useState } from 'react'
import { TaskBounty } from '@/lib/types'

export default function ExternalPortal() {
  const [tasks, setTasks] = useState<TaskBounty[]>([])
  const [session, setSession] = useState<{ externalAuthType?: string; githubLogin?: string; walletAddress?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [walletInput, setWalletInput] = useState('')

  const fetchTasks = async () => {
    const [taskData, me] = await Promise.all([
      fetch('/api/tasks').then(r => r.json()),
      fetch('/api/auth/me').then(r => r.json()).catch(() => null)
    ])
    setTasks(Array.isArray(taskData) ? taskData : [])
    setSession(me?.session || null)
    setLoading(false)
  }

  useEffect(() => { fetchTasks() }, [])

  const submit = async (taskId: string) => {
    if (isCodeMode && !session?.walletAddress) {
      window.alert('请先绑定钱包地址，再提交 GitHub PR。')
      return
    }
    const prUrl = window.prompt('提交 GitHub PR 链接', 'https://github.com/org/repo/pull/1') || ''
    if (!prUrl) return
    const commitSha = window.prompt('提交 Commit SHA（可选）', '') || ''
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', taskId, prUrl, commitSha, ciPassed: true })
    })
    const data = await res.json()
    window.alert(data?.inferPopup || data?.error || '提交成功')
    fetchTasks()
  }

  const externalTasks = tasks.filter((x) => x.source === 'external')
  const codeTasks = externalTasks.filter((x) => x.prUrl || x.repo)
  const securityTasks = externalTasks.filter((x) => !x.prUrl && !x.repo)
  const isCodeMode = session?.externalAuthType === 'github_code_bounty'
  const displayTasks = isCodeMode ? codeTasks : securityTasks

  const bindWallet = async () => {
    const wallet = walletInput.trim()
    if (!wallet) return
    const challengeRes = await fetch('/api/auth/wallet-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet })
    })
    const challengeData = await challengeRes.json()
    if (!challengeRes.ok) {
      window.alert(challengeData?.error || '获取 challenge 失败')
      return
    }

    const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
    if (!ethereum) {
      window.alert('未检测到钱包扩展，请安装 MetaMask 或兼容钱包')
      return
    }
    try {
      await ethereum.request({ method: 'eth_requestAccounts' })
      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [challengeData.message, wallet]
      })
      const res = await fetch('/api/auth/bind-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          message: challengeData.message,
          signature
        })
      })
      const data = await res.json()
      if (!res.ok) {
        window.alert(data?.error || '绑定钱包失败')
        return
      }
      window.alert(`钱包绑定成功：${data.walletAddress}`)
      setWalletInput('')
      fetchTasks()
    } catch {
      window.alert('钱包签名已取消或失败')
      return
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-white">External Contributor Portal</h1>
            <p className="text-xs text-gray-500">
              {isCodeMode
                ? `代码悬赏模式（GitHub: ${session?.githubLogin || '-'})`
                : `安全漏洞赏金模式（Wallet: ${session?.walletAddress || '-'})`}
            </p>
          </div>
          <a href="/staff" className="text-xs px-2 py-1 rounded border border-white/15">内部入口</a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">
        {isCodeMode && !session?.walletAddress && (
          <div className="glass rounded-xl p-4 mb-4 space-y-2 border border-amber-500/40">
            <p className="text-sm text-amber-300">你当前为 GitHub 登录，提交代码悬赏前必须先绑定钱包地址用于收款。</p>
            <div className="flex gap-2">
              <input
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                placeholder="0x..."
                className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
              />
              <button onClick={bindWallet} className="px-4 py-2 rounded bg-amber-600 text-sm">绑定钱包</button>
            </div>
          </div>
        )}
        {loading ? (
          <div className="text-gray-500">加载中...</div>
        ) : displayTasks.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center text-gray-400">暂无当前模式可见任务</div>
        ) : (
          <div className="space-y-3">
            {displayTasks.map((task) => (
              <div key={task.id} className="glass rounded-xl p-4">
                <p className="font-medium">{task.title}</p>
                <p className="text-xs text-gray-500">{task.description}</p>
                <p className="text-xs text-gray-400 mt-1">状态: {task.status} | 赏金: {task.rewardAmount}{task.rewardToken}</p>
                <p className="text-xs text-gray-500 mt-1">交付模式: {task.deliveryMode || 'public_mirror_pr'}</p>
                <p className="text-xs text-gray-500 mt-1">仓库可见性: {task.repoVisibility || 'public'}</p>
                {task.mirrorRepoUrl && <p className="text-xs text-gray-500 mt-1">镜像仓: {task.mirrorRepoUrl}</p>}
                {task.backportStatus && <p className="text-xs text-gray-500 mt-1">主仓回灌状态: {task.backportStatus}</p>}
                {task.requirementClarityStatus && (
                  <p className="text-xs text-gray-500 mt-1">需求明确性: {task.requirementClarityStatus} ({task.requirementClarityScore ?? '-'})</p>
                )}
                {task.deliveryMode === 'public_mirror_pr' && (
                  <p className="text-xs text-gray-500 mt-1">说明：请在公开镜像仓提交 PR，平台校验合并后结算。</p>
                )}
                {task.deliveryMode === 'private_collab_pr' && (
                  <p className="text-xs text-gray-500 mt-1">说明：请在私有协作仓提交 PR，需内部审批后结算。</p>
                )}
                {task.deliveryMode === 'patch_bundle' && (
                  <p className="text-xs text-gray-500 mt-1">说明：提交 patch/commit，待内部导入验证后结算。</p>
                )}
                {task.repo && <p className="text-xs text-gray-500 mt-1">Repo: {task.repo}</p>}
                {task.prUrl && <a href={task.prUrl} target="_blank" className="text-xs text-sky-400 underline">查看已提交 PR</a>}
                {task.status === 'open' && isCodeMode && (
                  <button onClick={() => submit(task.id)} className="mt-2 px-3 py-1.5 rounded bg-sky-600 text-xs">提交 GitHub PR</button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
