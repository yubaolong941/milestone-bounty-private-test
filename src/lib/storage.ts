import fs from 'fs'
import path from 'path'
import { Project, PaymentRecord, TaskBounty, RepoConfig, InternalMemberBinding } from './types'

const DATA_DIR = path.join(process.cwd(), 'data')
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')
const REPO_CONFIGS_FILE = path.join(DATA_DIR, 'repo-configs.json')
const INTERNAL_MEMBER_BINDINGS_FILE = path.join(DATA_DIR, 'internal-member-bindings.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadProjects(): Project[] {
  ensureDataDir()
  if (!fs.existsSync(PROJECTS_FILE)) return []
  const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8')) as Array<Project & { milestones?: Project['reports'] }>
  return raw.map((p) => ({
    ...p,
    reports: p.reports ?? p.milestones ?? [],
    milestones: undefined
  }))
}

export function saveProjects(projects: Project[]) {
  ensureDataDir()
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2))
}

export function loadPayments(): PaymentRecord[] {
  ensureDataDir()
  if (!fs.existsSync(PAYMENTS_FILE)) return []
  const raw = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8')) as Array<PaymentRecord>
  return raw.map((p) => ({
    ...p,
    reportId: p.reportId ?? p.milestoneId ?? '',
    reportTitle: p.reportTitle ?? p.milestoneName ?? '未命名漏洞报告'
  }))
}

export function savePayments(payments: PaymentRecord[]) {
  ensureDataDir()
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2))
}

export function loadTaskBounties(): TaskBounty[] {
  ensureDataDir()
  if (!fs.existsSync(TASKS_FILE)) return []
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')) as TaskBounty[]
}

export function saveTaskBounties(tasks: TaskBounty[]) {
  ensureDataDir()
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2))
}

export function loadRepoConfigs(): RepoConfig[] {
  ensureDataDir()
  if (!fs.existsSync(REPO_CONFIGS_FILE)) return []
  return JSON.parse(fs.readFileSync(REPO_CONFIGS_FILE, 'utf-8')) as RepoConfig[]
}

export function saveRepoConfigs(configs: RepoConfig[]) {
  ensureDataDir()
  fs.writeFileSync(REPO_CONFIGS_FILE, JSON.stringify(configs, null, 2))
}

export function loadInternalMemberBindings(): InternalMemberBinding[] {
  ensureDataDir()
  if (!fs.existsSync(INTERNAL_MEMBER_BINDINGS_FILE)) return []
  return JSON.parse(fs.readFileSync(INTERNAL_MEMBER_BINDINGS_FILE, 'utf-8')) as InternalMemberBinding[]
}

export function saveInternalMemberBindings(items: InternalMemberBinding[]) {
  ensureDataDir()
  fs.writeFileSync(INTERNAL_MEMBER_BINDINGS_FILE, JSON.stringify(items, null, 2))
}

export function getProjectById(id: string): Project | undefined {
  return loadProjects().find(p => p.id === id)
}

export function updateProject(updated: Project) {
  const projects = loadProjects()
  const idx = projects.findIndex(p => p.id === updated.id)
  if (idx !== -1) projects[idx] = updated
  else projects.push(updated)
  saveProjects(projects)
}
