'use client'

import { useState, useEffect } from 'react'
import { Project, PaymentRecord, TaskBounty, getReports } from '@/lib/types'
import ProjectCard from '@/components/ProjectCard'
import CreateProjectModal from '@/components/CreateProjectModal'
import PaymentHistory from '@/components/PaymentHistory'
import TaskBountyBoard from '@/components/TaskBountyBoard'
import RepoConfigBoard from '@/components/RepoConfigBoard'

export default function StaffDashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [tasks, setTasks] = useState<TaskBounty[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [activeTab, setActiveTab] = useState<'projects' | 'tasks' | 'payments' | 'repos'>('projects')
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    const [p, pay, t] = await Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/payments').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json())
    ])
    setProjects(p)
    setPayments(pay)
    setTasks(t)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const totalBudget = projects.reduce((s, p) => s + p.totalBudget, 0)
  const totalSpent = projects.reduce((s, p) => s + p.spentAmount, 0)
  const totalReports = projects.reduce((s, p) => s + getReports(p).length, 0)
  const paidReports = projects.reduce((s, p) => s + getReports(p).filter(m => m.status === 'paid').length, 0)

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-sm font-bold">M</div>
            <div>
              <h1 className="font-semibold text-white">BountyPay Staff</h1>
              <p className="text-xs text-gray-500">内部漏洞悬赏运营看板</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/external" className="text-xs px-2 py-1 rounded border border-white/15">外部入口</a>
            <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors">
              + 新建漏洞悬赏项目
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: '项目总数', value: projects.length, color: 'text-white' },
            { label: '漏洞处理进度', value: `${paidReports}/${totalReports}`, color: 'text-sky-400' },
            { label: '总预算', value: `${totalBudget}U`, color: 'text-yellow-400' },
            { label: '已发放', value: `${totalSpent}U`, color: 'text-green-400' }
          ].map(s => (
            <div key={s.label} className="glass rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-1 mb-6 p-1 glass rounded-lg w-fit">
          {(['projects', 'tasks', 'payments', 'repos'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab === 'projects'
                ? `漏洞看板 (${projects.length})`
                : tab === 'tasks'
                  ? `需求任务 (${tasks.length})`
                  : tab === 'payments'
                    ? `支付记录 (${payments.length})`
                    : '仓库配置'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-500">加载中...</div>
        ) : activeTab === 'projects' ? (
          <div className="space-y-4">
            {projects.length === 0 ? (
              <div className="glass rounded-xl p-16 text-center">
                <p className="text-4xl mb-4">🛡️</p>
                <p className="text-gray-400 mb-2">还没有漏洞悬赏项目</p>
              </div>
            ) : projects.map(project => <ProjectCard key={project.id} project={project} onUpdate={fetchData} />)}
          </div>
        ) : activeTab === 'tasks' ? (
          <TaskBountyBoard tasks={tasks} onRefresh={fetchData} />
        ) : activeTab === 'repos' ? (
          <RepoConfigBoard />
        ) : (
          <PaymentHistory payments={payments} />
        )}
      </main>

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchData() }} />}
    </div>
  )
}
