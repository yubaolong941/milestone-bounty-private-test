'use client'

import { useState } from 'react'

interface Props {
  onClose: () => void
  onCreated: () => void
}

export default function CreateProjectModal({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError('')
    try {
      const body = mode === 'ai'
        ? { naturalLanguage: input }
        : { name: input }

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) throw new Error('创建失败')
      onCreated()
    } catch (e) {
      setError('创建失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const EXAMPLE = `创建 bounty 项目"Wallet Program A"：
1. SQL 注入（High）奖励1200U，研究员Alice，钱包0xAbc123
2. 存储型 XSS（Medium）奖励400U，研究员Bob，钱包0xDef456`

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl w-full max-w-lg">
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white">新建 Bounty 项目</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Mode switch */}
          <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
            {(['ai', 'manual'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {m === 'ai' ? 'AI 自然语言创建' : '手动填写'}
              </button>
            ))}
          </div>

          {mode === 'ai' ? (
            <div>
              <label className="text-xs text-gray-400 mb-2 block">用自然语言描述你的 Bounty 项目与漏洞奖励规则</label>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={EXAMPLE}
                rows={6}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-sky-500/50 resize-none"
              />
              <p className="text-xs text-gray-600 mt-1">AI 会自动解析项目名称、漏洞标题、奖励金额、研究员和钱包地址</p>
            </div>
          ) : (
            <div>
              <label className="text-xs text-gray-400 mb-2 block">Bounty 项目名称</label>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="例如：Wallet Program A"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-sky-500/50"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-white/10 hover:bg-white/5 rounded-xl text-sm text-gray-400 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-colors"
            >
              {loading ? (mode === 'ai' ? 'AI 解析中...' : '创建中...') : '创建项目'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
