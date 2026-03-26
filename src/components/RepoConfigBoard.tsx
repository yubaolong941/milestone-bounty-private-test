'use client'

import { useEffect, useState } from 'react'
import { RepoConfig } from '@/lib/types'

export default function RepoConfigBoard() {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [tokenRef, setTokenRef] = useState('')

  const load = async () => {
    const res = await fetch('/api/repo-configs')
    const data = await res.json()
    setConfigs(Array.isArray(data) ? data : [])
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        owner,
        repo,
        defaultBranch,
        tokenRef: tokenRef || undefined,
        enabled: true
      })
    })
    const data = await res.json()
    if (!res.ok) {
      window.alert(data?.error || '创建失败')
      return
    }
    setOwner('')
    setRepo('')
    setDefaultBranch('main')
    setTokenRef('')
    load()
  }

  const toggleEnabled = async (c: RepoConfig) => {
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        id: c.id,
        enabled: !c.enabled
      })
    })
    const data = await res.json()
    if (!res.ok) {
      window.alert(data?.error || '更新失败')
      return
    }
    load()
  }

  const remove = async (id: string) => {
    if (!window.confirm('确认删除该仓库配置？')) return
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id })
    })
    const data = await res.json()
    if (!res.ok) {
      window.alert(data?.error || '删除失败')
      return
    }
    load()
  }

  const testConnection = async (id: string) => {
    const res = await fetch('/api/repo-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', id })
    })
    const data = await res.json()
    if (!res.ok || !data?.success) {
      window.alert(data?.error || '连接测试失败')
      return
    }
    window.alert(data?.detail || '连接测试通过')
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 space-y-2">
        <p className="font-medium text-sm">新增 GitHub 仓库配置</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
          <input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="default branch" className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
          <input value={tokenRef} onChange={(e) => setTokenRef(e.target.value)} placeholder="tokenRef（可选）" className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
        </div>
        <button onClick={create} className="px-4 py-2 bg-indigo-600 rounded text-sm">创建仓库配置</button>
      </div>

      <div className="space-y-3">
        {configs.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center text-gray-400">暂无仓库配置</div>
        ) : configs.map((c) => (
          <div key={c.id} className="glass rounded-xl p-4">
            <p className="font-medium">{c.owner}/{c.repo}</p>
            <p className="text-xs text-gray-500">分支: {c.defaultBranch} | tokenRef: {c.tokenRef || '-'} | 状态: {c.enabled ? '启用' : '停用'}</p>
            <p className="text-xs text-gray-600">ID: {c.id}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => testConnection(c.id)} className="px-3 py-1.5 text-xs bg-emerald-600 rounded">测试连接</button>
              <button onClick={() => toggleEnabled(c)} className="px-3 py-1.5 text-xs bg-sky-600 rounded">{c.enabled ? '停用' : '启用'}</button>
              <button onClick={() => remove(c.id)} className="px-3 py-1.5 text-xs bg-rose-600 rounded">删除</button>
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
