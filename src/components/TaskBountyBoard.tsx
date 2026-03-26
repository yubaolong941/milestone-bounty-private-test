'use client'

import { useEffect, useState } from 'react'
import { RepoConfig, TaskBounty } from '@/lib/types'

interface Props {
  tasks: TaskBounty[]
  onRefresh: () => void
}

export default function TaskBountyBoard({ tasks, onRefresh }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [source] = useState<'internal' | 'external'>('internal')
  const [deliveryMode, setDeliveryMode] = useState<'public_mirror_pr' | 'private_collab_pr' | 'patch_bundle'>('public_mirror_pr')
  const [repo, setRepo] = useState('')
  const [repoConfigs, setRepoConfigs] = useState<RepoConfig[]>([])
  const [repoConfigId, setRepoConfigId] = useState('')
  const [mirrorRepoUrl, setMirrorRepoUrl] = useState('')
  const [labels, setLabels] = useState('bounty:$50,auto-payout:on,wallet:0x1234567890abcdef1234567890abcdef12345678,external-task')

  useEffect(() => {
    fetch('/api/repo-configs')
      .then((r) => r.json())
      .then((data) => setRepoConfigs(Array.isArray(data) ? data : []))
      .catch(() => setRepoConfigs([]))
  }, [])

  const createTask = async () => {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        title,
        description,
        source: 'internal',
        deliveryMode,
        repo,
        repoConfigId: repoConfigId || undefined,
        mirrorRepoUrl,
        labels: labels.split(',').map((x) => x.trim()).filter(Boolean)
      })
    })
    setTitle('')
    setDescription('')
    setRepo('')
    setRepoConfigId('')
    setMirrorRepoUrl('')
    onRefresh()
  }

  const promoteToExternal = async (taskId: string) => {
    const rewardAmount = Number(window.prompt('外部悬赏金额（U）', '50') || '50')
    const repoVisibility = (window.prompt('仓库可见性（public/private）', 'public') || 'public').toLowerCase()
    const repo = window.prompt('仓库地址（owner/repo 或 URL）', '') || ''
    const description = window.prompt('补充需求描述（建议写清验收标准、交付物、边界）', '') || ''
    const claimGithubLogin = window.prompt('认领 GitHub 用户名（用于 claim:@...）', '') || ''
    const walletAddress = window.prompt('收款钱包地址（用于 wallet:0x...）', '') || ''
    const mirrorRepoUrl = repoVisibility === 'public'
      ? (window.prompt('公开镜像仓 URL（public 模式建议填写）', '') || '')
      : ''
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promoteToExternal',
        taskId,
        rewardAmount,
        description,
        claimGithubLogin,
        walletAddress,
        autoPayout: true,
        repoVisibility: repoVisibility === 'private' ? 'private' : 'public',
        repo,
        repoConfigId: repoConfigId || undefined,
        deliveryMode: repoVisibility === 'private' ? 'private_collab_pr' : 'public_mirror_pr',
        mirrorRepoUrl
      })
    })
    const data = await res.json()
    window.alert(data?.error || `已转外部悬赏，需求明确性评分：${data?.requirementClarity?.score ?? '-'}`)
    onRefresh()
  }

  const submitTask = async (taskId: string) => {
    const prUrl = window.prompt('PR URL', 'https://github.com/octocat/Hello-World/pull/1') || ''
    if (!prUrl) return
    const commitSha = window.prompt('Commit SHA', 'abc123def456') || ''
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', taskId, prUrl, commitSha, ciPassed: true })
    })
    const data = await res.json()
    window.alert(data?.inferPopup || data?.error || '提交成功')
    onRefresh()
  }

  const autoPayout = async (taskId: string) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'autoPayout', taskId, merged: true, riskPassed: true })
    })
    const data = await res.json()
    window.alert(data?.error || `自动发赏金成功: ${data?.txHash || ''}`)
    onRefresh()
  }
  const markBackportDone = async (taskId: string) => {
    const backportCommitSha = window.prompt('请输入主仓回灌 commit SHA', '') || ''
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markBackportDone', taskId, backportCommitSha })
    })
    const data = await res.json()
    window.alert(data?.error || '已标记回灌完成')
    onRefresh()
  }
  const internalTasks = tasks.filter((x) => x.source !== 'external')
  const externalTasks = tasks.filter((x) => x.source === 'external')

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 space-y-2">
        <p className="font-medium text-sm">新建内部任务（内部不发悬赏）</p>
        <p className="text-xs text-gray-500">外部悬赏必须从下方 Meegle 同步任务转化，并通过 AI 需求明确性审核。</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题" className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="任务描述" rows={3} className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
        {false && (
          <select
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value as 'public_mirror_pr' | 'private_collab_pr' | 'patch_bundle')}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
          >
            <option value="public_mirror_pr">公开镜像仓 PR（推荐）</option>
            <option value="private_collab_pr">私有仓协作 PR</option>
            <option value="patch_bundle">Patch/Bundle 提交</option>
          </select>
        )}
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="GitHub Repo（可选，如 org/repo）" className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
        {true && (
          <select
            value={repoConfigId}
            onChange={(e) => setRepoConfigId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
          >
            <option value="">选择仓库配置（可选）</option>
            {repoConfigs.map((c) => (
              <option key={c.id} value={c.id}>{c.owner}/{c.repo} ({c.defaultBranch})</option>
            ))}
          </select>
        )}
        {false && deliveryMode === 'public_mirror_pr' && (
          <input value={mirrorRepoUrl} onChange={(e) => setMirrorRepoUrl(e.target.value)} placeholder="公开镜像仓 URL（必填，建议）" className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
        )}
        <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="labels" className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
        <button onClick={createTask} className="px-4 py-2 bg-indigo-600 rounded text-sm">创建任务</button>
      </div>

      {tasks.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-gray-400">暂无任务</div>
      ) : (
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">内部指定任务（{internalTasks.length}）</p>
            <div className="space-y-3">
              {internalTasks.map((task) => (
                <div key={task.id} className="glass rounded-xl p-4">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-xs text-gray-500">{task.description}</p>
                  <p className="text-xs text-gray-400 mt-1">状态: {task.status} | 类型: 内部指定</p>
                  {task.meegleAssignee && <p className="text-xs text-gray-500">Meegle 指派: {task.meegleAssignee}</p>}
                  {task.internalGithubLogin && <p className="text-xs text-gray-500">内部 GitHub: {task.internalGithubLogin}</p>}
                  {task.pendingMeegleStatus && <p className="text-xs text-amber-400">待流转 Meegle 状态: {task.pendingMeegleStatus}</p>}
                  {task.requirementClarityStatus && (
                    <p className="text-xs text-gray-500">
                      需求明确性: {task.requirementClarityStatus} ({task.requirementClarityScore ?? '-'})
                    </p>
                  )}
                  {task.requirementClaritySummary && <p className="text-xs text-gray-500">{task.requirementClaritySummary}</p>}
                  {task.repo && <p className="text-xs text-gray-500">Repo: {task.repo}</p>}
                  {task.prUrl && <a href={task.prUrl} target="_blank" className="text-xs text-sky-400 underline">查看 GitHub PR</a>}
                  {task.id.startsWith('meegle-') && (
                    <button onClick={() => promoteToExternal(task.id)} className="mt-2 px-3 py-1.5 text-xs bg-emerald-600 rounded">转外部悬赏</button>
                  )}
                </div>
              ))}
              {internalTasks.length === 0 && <p className="text-xs text-gray-500">暂无内部任务</p>}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">外部需求悬赏（{externalTasks.length}）</p>
            <div className="space-y-3">
              {externalTasks.map((task) => (
            <div key={task.id} className="glass rounded-xl p-4">
              <p className="font-medium">{task.title}</p>
              <p className="text-xs text-gray-500">{task.description}</p>
              <p className="text-xs text-gray-400 mt-1">状态: {task.status} | 类型: 外部悬赏 | 赏金: {task.rewardAmount}{task.rewardToken}</p>
              <p className="text-xs text-gray-500">交付模式: {task.deliveryMode || 'public_mirror_pr'}</p>
              {task.mirrorRepoUrl && <p className="text-xs text-gray-500">镜像仓: {task.mirrorRepoUrl}</p>}
              {task.backportStatus && <p className="text-xs text-gray-500">主仓回灌状态: {task.backportStatus}{task.backportCommitSha ? ` (${task.backportCommitSha})` : ''}</p>}
              <p className="text-xs text-gray-500">标签: {task.labels.join(', ')}</p>
              {task.repo && <p className="text-xs text-gray-500">Repo: {task.repo}</p>}
              {task.repoConfigId && <p className="text-xs text-gray-500">RepoConfig: {task.repoConfigId}</p>}
              {task.prUrl && <a href={task.prUrl} target="_blank" className="text-xs text-sky-400 underline">查看 GitHub PR</a>}
              {task.aiReviewSummary && <p className="text-xs text-sky-400 mt-1">AI: {task.aiReviewSummary}</p>}
              {task.txHash && <p className="text-xs text-green-400 mt-1">Tx: {task.txHash}</p>}
              <div className="flex gap-2 mt-2">
                {task.status === 'open' && <button onClick={() => submitTask(task.id)} className="px-3 py-1.5 text-xs bg-sky-600 rounded">提交合并信息</button>}
                {task.deliveryMode === 'public_mirror_pr' && task.backportStatus !== 'done' && (
                  <button onClick={() => markBackportDone(task.id)} className="px-3 py-1.5 text-xs bg-violet-600 rounded">标记主仓回灌完成</button>
                )}
                {(task.status === 'awaiting_acceptance' || task.status === 'submitted') && (
                  <button onClick={() => autoPayout(task.id)} className="px-3 py-1.5 text-xs bg-emerald-600 rounded">自动发赏金</button>
                )}
              </div>
            </div>
              ))}
              {externalTasks.length === 0 && <p className="text-xs text-gray-500">暂无外部悬赏任务</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
