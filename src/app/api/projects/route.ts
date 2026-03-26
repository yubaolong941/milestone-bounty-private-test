import { NextResponse } from 'next/server'
import { loadProjects, saveProjects } from '@/lib/storage'
import { parseProjectFromText } from '@/lib/ai'
import { Project, VulnerabilityReport } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  return NextResponse.json(loadProjects())
}

export async function POST(req: Request) {
  const body = await req.json()

  // 自然语言创建 Bounty 项目
  if (body.naturalLanguage) {
    const parsed = await parseProjectFromText(body.naturalLanguage)
    if (!parsed) return NextResponse.json({ error: '解析失败' }, { status: 400 })

    const now = new Date().toISOString()
    const reports = parsed.reports ?? []
    const project: Project = {
      id: uuidv4(),
      name: parsed.name,
      description: parsed.description,
      totalBudget: reports.reduce((s, m) => s + m.rewardAmount, 0),
      spentAmount: 0,
      createdAt: now,
      reports: reports.map(m => ({
        id: uuidv4(),
        ...m,
        status: 'pending'
      } as VulnerabilityReport))
    }

    const projects = loadProjects()
    projects.push(project)
    saveProjects(projects)
    return NextResponse.json(project)
  }

  // 直接创建
  const project: Project = {
    id: uuidv4(),
    name: body.name,
    description: body.description || '',
    totalBudget: body.totalBudget || 0,
    spentAmount: 0,
    createdAt: new Date().toISOString(),
    reports: []
  }

  const projects = loadProjects()
  projects.push(project)
  saveProjects(projects)
  return NextResponse.json(project)
}
