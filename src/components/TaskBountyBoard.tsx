'use client'

import { useEffect, useMemo, useState } from 'react'
import { Company, CompanyRole, RepoConfig, TaskBounty, TreasuryFundingRecord } from '@/lib/types'
import type { UserRole } from '@/lib/auth'
import PayoutExecutionOverlay from '@/components/PayoutExecutionOverlay'
import TaskDetailDrawer from '@/components/TaskDetailDrawer'
import { connectBrowserWallet, switchEvmChain } from '@/lib/browser-wallet'
import { hasCompanyCapability } from '@/lib/permissions'
import { humanizeStatus } from '@/lib/format'

async function loadEthers() {
  const { BrowserProvider, Contract, parseUnits } = await import('ethers')
  return { BrowserProvider, Contract, parseUnits }
}

interface Props {
  tasks: TaskBounty[]
  onRefresh: () => void
  userRole?: UserRole
  companyRole?: CompanyRole
  initialSourceFilter?: 'all' | 'internal' | 'external'
  initialStatusFilter?: 'all' | TaskBounty['status']
  initialSearch?: string
  initialNeedsRequirementBinding?: boolean
}

type PromoteForm = {
  rewardAmount: string
  rewardToken: string
  fundingTxHash: string
  fundingWalletAddress: string
  repoVisibility: 'public' | 'private'
  repoConfigId: string
  repo: string
  description: string
  requirementDocUrl: string
  requirementId: string
  claimGithubLogin: string
  walletAddress: string
  companyName: string
  mirrorRepoUrl: string
  publishToGithub: boolean
}

type LockForm = {
  rewardAmount: string
  rewardToken: string
  fundingTxHash: string
  lockContractAddress: string
  companyName: string
}

type DeliveryForm = {
  prUrl: string
  commitSha: string
}

type PromoteStep = 1 | 2 | 3 | 4

const ERC20_ABI = [
  'function transfer(address to,uint256 amount) returns (bool)'
]

const CHAIN_ID_BY_NETWORK: Record<string, string> = {
  bsc: '0x38',
  bsc_testnet: '0x61',
  base: '0x2105',
  base_sepolia: '0x14a34',
  ethereum: '0x1',
  mainnet: '0x1'
}

function statusClass(status: string) {
  return `status-pill status-${status}`
}

function claimabilityChip(task: TaskBounty) {
  if (task.source !== 'external') return null
  if (!task.claimedByGithubLogin) {
    return { label: 'Claimable', className: 'bg-white/10 text-white border border-white/[0.10]' }
  }
  if (['awaiting_acceptance', 'submitted', 'accepted'].includes(task.status)) {
    return { label: 'Pending acceptance / payout', className: 'bg-apple-orange/15 text-apple-orange border border-apple-orange/25' }
  }
  if (task.status === 'paid') {
    return { label: 'Paid', className: 'bg-apple-green/15 text-apple-green border border-apple-green/25' }
  }
  return { label: `In progress · @${task.claimedByGithubLogin}`, className: 'bg-apple-blue/15 text-apple-blue border border-apple-blue/25' }
}

function boolLabel(value: boolean | undefined) {
  if (value === true) return 'pass'
  if (value === false) return 'block'
  return '-'
}

function normalizePayoutBlocker(message?: string) {
  if (!message) return ''
  return message
}

function buildGitHubRepoUrl(owner?: string, repo?: string) {
  if (!owner || !repo) return ''
  return `https://github.com/${owner}/${repo}`
}

function initialPromoteForm(): PromoteForm {
  return {
    rewardAmount: '50',
    rewardToken: 'USD1',
    fundingTxHash: '',
    fundingWalletAddress: '',
    repoVisibility: 'public',
    repoConfigId: '',
    repo: '',
    description: '',
    requirementDocUrl: '',
    requirementId: '',
    claimGithubLogin: '',
    walletAddress: '',
    companyName: '',
    mirrorRepoUrl: '',
    publishToGithub: true
  }
}

function initialLockForm(task: TaskBounty): LockForm {
  return {
    rewardAmount: String(task.rewardAmount || 50),
    rewardToken: task.rewardToken || 'USD1',
    fundingTxHash: '',
    lockContractAddress: '',
    companyName: task.payerCompanyName || ''
  }
}

function initialDeliveryForm(task: TaskBounty): DeliveryForm {
  return {
    prUrl: task.prUrl || '',
    commitSha: task.commitSha || ''
  }
}

export default function TaskBountyBoard({
  tasks,
  onRefresh,
  userRole = 'staff',
  companyRole,
  initialSourceFilter = 'all',
  initialStatusFilter = 'all',
  initialSearch = '',
  initialNeedsRequirementBinding = false
}: Props) {
  const [repoConfigs, setRepoConfigs] = useState<RepoConfig[]>([])
  const [defaultRepoConfigId, setDefaultRepoConfigId] = useState('')
  const [activeCompanyId, setActiveCompanyId] = useState('')
  const [search, setSearch] = useState(initialSearch)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'internal' | 'external'>(initialSourceFilter)
  const [statusFilter, setStatusFilter] = useState<'all' | TaskBounty['status']>(initialStatusFilter)
  const [needsRequirementBindingOnly, setNeedsRequirementBindingOnly] = useState(initialNeedsRequirementBinding)
  const [sortKey, setSortKey] = useState<'updated_desc' | 'reward_desc' | 'status'>('updated_desc')
  const [selectedTask, setSelectedTask] = useState<TaskBounty | null>(null)
  const [promoteForms, setPromoteForms] = useState<Record<string, PromoteForm>>({})
  const [lockForms, setLockForms] = useState<Record<string, LockForm>>({})
  const [deliveryForms, setDeliveryForms] = useState<Record<string, DeliveryForm>>({})
  const [activePanel, setActivePanel] = useState<Record<string, 'promote' | 'lock' | 'submit' | null>>({})
  const [promoteSteps, setPromoteSteps] = useState<Record<string, PromoteStep>>({})
  const [taskFeedbacks, setTaskFeedbacks] = useState<Record<string, {
    tone: 'success' | 'warning' | 'danger'
    text: string
    link?: { href: string; label: string } | null
  }>>({})
  const [treasuryConfig, setTreasuryConfig] = useState<{
    enabled: boolean
    network?: string
    tokenSymbol?: string
    tokenDecimals?: number
    tokenAddress?: string
    treasuryAddress?: string
  } | null>(null)
  const [treasuryFundings, setTreasuryFundings] = useState<TreasuryFundingRecord[]>([])
  const [activeFundingTaskId, setActiveFundingTaskId] = useState<string | null>(null)
  const [activePromotingTaskId, setActivePromotingTaskId] = useState<string | null>(null)
  const [payoutOverlayVisible, setPayoutOverlayVisible] = useState(false)

  useEffect(() => {
    setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    setSourceFilter(initialSourceFilter)
  }, [initialSourceFilter])

  useEffect(() => {
    setStatusFilter(initialStatusFilter)
  }, [initialStatusFilter])

  useEffect(() => {
    setNeedsRequirementBindingOnly(initialNeedsRequirementBinding)
  }, [initialNeedsRequirementBinding])

  useEffect(() => {
    fetch('/api/platform/treasury-config')
      .then((r) => r.json())
      .then((data) => setTreasuryConfig(data))
      .catch(() => setTreasuryConfig(null))
  }, [])

  useEffect(() => {
    fetch('/api/platform/treasury-fundings')
      .then((r) => r.json())
      .then((data) => setTreasuryFundings(Array.isArray(data) ? data : []))
      .catch(() => setTreasuryFundings([]))
  }, [])

  useEffect(() => {
    const loadRepoContext = async () => {
      const [repoConfigsRes, companiesRes, meRes] = await Promise.all([
        fetch('/api/repo-configs').catch(() => null),
        fetch('/api/companies').catch(() => null),
        fetch('/api/auth/me').catch(() => null)
      ])
      const [repoConfigsData, companiesData, meData] = await Promise.all([
        repoConfigsRes ? repoConfigsRes.json().catch(() => []) : Promise.resolve([]),
        companiesRes ? companiesRes.json().catch(() => []) : Promise.resolve([]),
        meRes ? meRes.json().catch(() => ({})) : Promise.resolve({})
      ])

      const nextRepoConfigs = Array.isArray(repoConfigsData) ? repoConfigsData as RepoConfig[] : []
      setRepoConfigs(nextRepoConfigs.filter((item) => item.enabled !== false))

      const companies = Array.isArray(companiesData) ? companiesData as Company[] : []
      const activeCompanyId = typeof (meData as { session?: { activeCompanyId?: string } })?.session?.activeCompanyId === 'string'
        ? (meData as { session?: { activeCompanyId?: string } }).session?.activeCompanyId || ''
        : ''
      setActiveCompanyId(activeCompanyId)
      const activeCompany = companies.find((item) => item.id === activeCompanyId) || companies[0]
      setDefaultRepoConfigId(activeCompany?.defaultRepoConfigId || '')
    }

    void loadRepoContext()
    const handleSetupUpdated = () => { void loadRepoContext() }
    window.addEventListener('wlfi:setup-updated', handleSetupUpdated)
    return () => window.removeEventListener('wlfi:setup-updated', handleSetupUpdated)
  }, [])

  const canManageStructure = userRole === 'admin' || hasCompanyCapability(companyRole, 'task.create') || hasCompanyCapability(companyRole, 'repo.manage')
  const canReviewDelivery = userRole === 'admin' || hasCompanyCapability(companyRole, 'task.review') || hasCompanyCapability(companyRole, 'task.create')
  const canManageFinance = userRole === 'admin' || hasCompanyCapability(companyRole, 'payment.approve')

  const setTaskFeedback = (
    taskId: string,
    tone: 'success' | 'warning' | 'danger',
    text: string,
    link?: { href: string; label: string } | null
  ) => {
    setTaskFeedbacks((prev) => ({ ...prev, [taskId]: { tone, text, link: link || null } }))
  }

  const parseErrorMessage = (res: Response, payload: unknown, rawText: string, fallback: string) => {
    const body = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {}
    const primary = [body.error, body.detail, body.message]
      .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined
    if (primary) return `${primary} (HTTP ${res.status})`
    const compact = String(rawText || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (compact) return `${fallback}: ${compact.slice(0, 180)} (HTTP ${res.status})`
    return `${fallback} (HTTP ${res.status})`
  }

  const refreshRequirementBindings = async () => {
    const res = await fetch('/api/integrations/meegle/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: activeCompanyId || undefined })
    })
    await res.json().catch(() => ({}))
    onRefresh()
  }

  const syncGithubIssues = async () => {
    const res = await fetch('/api/integrations/github/issues', { method: 'POST' })
    await res.json().catch(() => ({}))
    onRefresh()
  }

  const promoteToExternal = async (taskId: string) => {
    const form = promoteForms[taskId] || initialPromoteForm()
    const task = tasks.find((item) => item.id === taskId)
    const resolvedCompanyName = String(task?.companyName || form.companyName || task?.payerCompanyName || '').trim()
    const effectiveRepoConfigId = form.repoConfigId || task?.repoConfigId || defaultRepoConfigId || ''
    const selectedRepoConfig = repoConfigs.find((item) => item.id === effectiveRepoConfigId)
    const resolvedRepo = selectedRepoConfig ? `${selectedRepoConfig.owner}/${selectedRepoConfig.repo}` : form.repo
    const resolvedMirrorRepoUrl = form.mirrorRepoUrl || buildGitHubRepoUrl(selectedRepoConfig?.owner, selectedRepoConfig?.repo)
    setActivePromotingTaskId(taskId)
    setTaskFeedback(taskId, 'warning', 'AI is reviewing your requirements, please wait…')
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promoteToExternal',
          taskId,
          rewardAmount: Number(form.rewardAmount || 50),
          rewardToken: form.rewardToken || 'USD1',
          fundingTxHash: form.fundingTxHash || undefined,
          fundingWalletAddress: form.fundingWalletAddress || undefined,
          payerWalletAddress: form.fundingWalletAddress || undefined,
          description: form.description,
          requirementDocUrl: form.requirementDocUrl || undefined,
          requirementId: form.requirementId || undefined,
          companyName: resolvedCompanyName || undefined,
          claimGithubLogin: form.claimGithubLogin,
          walletAddress: form.walletAddress,
          publishToGithub: form.publishToGithub,
          autoPayout: true,
          repoVisibility: form.repoVisibility,
          repo: resolvedRepo,
          repoConfigId: effectiveRepoConfigId || undefined,
          deliveryMode: form.repoVisibility === 'private' ? 'private_collab_pr' : 'public_mirror_pr',
          mirrorRepoUrl: resolvedMirrorRepoUrl
        })
      })
      const rawText = await res.text()
      const data = rawText ? (() => {
        try {
          return JSON.parse(rawText)
        } catch {
          return {}
        }
      })() : {}
      if (!res.ok) {
        const refinement = (data && typeof data === 'object' ? (data as Record<string, unknown>).requirementRefinement : undefined) as Record<string, unknown> | undefined
        const polishedDescription = typeof refinement?.polishedDescription === 'string' ? refinement.polishedDescription.trim() : ''
        const nextActions = Array.isArray(refinement?.nextActions)
          ? refinement.nextActions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
          : []
        if (polishedDescription) {
          setPromoteForms((prev) => ({
            ...prev,
            [taskId]: {
              ...form,
              description: polishedDescription
            }
          }))
          setPromoteSteps((prev) => ({ ...prev, [taskId]: 3 }))
          const hint = nextActions.length > 0 ? `Suggestions: ${nextActions.join('; ')}` : 'Please review Step 3 requirement supplement and republish.'
          setTaskFeedback(taskId, 'warning', `AI has auto-generated and pre-filled a refined requirement draft. ${hint}`)
          return
        }
        setTaskFeedback(taskId, 'danger', parseErrorMessage(res, data, rawText, 'Publish failed'))
        return
      }

      const issueUrl = data?.task?.githubIssueUrl
      const issueNumber = data?.task?.githubIssueNumber
      setTaskFeedback(
        taskId,
        'success',
        issueUrl
          ? `Published as external bounty. GitHub Issue #${issueNumber ?? '-'} created.`
          : `Published as external bounty. Requirement clarity score: ${data?.requirementClarity?.score ?? '-'}`,
        issueUrl ? { href: issueUrl, label: `Open GitHub Issue #${issueNumber ?? ''}` } : null
      )
      if (form.fundingTxHash) {
        setTreasuryFundings((prev) =>
          prev.map((item) =>
            item.txHash === form.fundingTxHash
              ? { ...item, status: 'applied', taskId: data?.task?.id, taskTitle: data?.task?.title || taskId }
              : item
          )
        )
      }
      onRefresh()
    } catch (error) {
      setTaskFeedback(taskId, 'danger', error instanceof Error ? error.message : 'Publish failed')
    } finally {
      setActivePromotingTaskId((prev) => (prev === taskId ? null : prev))
    }
  }

  const fundTreasuryWithWallet = async (taskId: string) => {
    const form = promoteForms[taskId] || initialPromoteForm()
    const task = tasks.find((item) => item.id === taskId)
    const resolvedCompanyName = String(task?.companyName || form.companyName || task?.payerCompanyName || '').trim()
    const amount = Number(form.rewardAmount || 0)
    const network = String(treasuryConfig?.network || 'bsc').toLowerCase()
    const chainIdHex = CHAIN_ID_BY_NETWORK[network]

    if (!treasuryConfig?.enabled || !treasuryConfig.treasuryAddress || !treasuryConfig.tokenAddress) {
      setTaskFeedback(taskId, 'danger', 'Platform payment configuration is incomplete. Wallet payment cannot be initiated.')
      return
    }

    if (!amount || Number.isNaN(amount) || amount <= 0) {
      setTaskFeedback(taskId, 'danger', 'Please enter a valid reward amount before initiating wallet payment.')
      return
    }

    try {
      setActiveFundingTaskId(taskId)
      const connection = await connectBrowserWallet('okx')
      if (chainIdHex) {
        try {
          await switchEvmChain(connection.provider, chainIdHex)
        } catch {
          setTaskFeedback(taskId, 'danger', `Wallet connected but failed to switch to ${network.toUpperCase()}. Please switch manually in your wallet and retry.`)
          return
        }
      }

      const { BrowserProvider, Contract, parseUnits } = await loadEthers()
      const browserProvider = new BrowserProvider(connection.provider)
      const signer = await browserProvider.getSigner()
      const token = new Contract(treasuryConfig.tokenAddress, ERC20_ABI, signer)
      const tx = await token.transfer(
        treasuryConfig.treasuryAddress,
        parseUnits(String(amount), Number(treasuryConfig.tokenDecimals || 18))
      )

      setPromoteForms((prev) => ({
        ...prev,
        [taskId]: {
          ...form,
          fundingWalletAddress: connection.walletAddress,
          fundingTxHash: tx.hash
        }
      }))
      setTaskFeedback(taskId, 'warning', `Transfer of ${amount} ${form.rewardToken || treasuryConfig.tokenSymbol || 'USD1'} initiated from ${connection.walletAddress}. Waiting for on-chain confirmation...`)

      const receipt = await tx.wait()
      if (!receipt || receipt.status !== 1) {
        throw new Error('On-chain transaction was not confirmed successfully.')
      }

      await fetch('/api/platform/treasury-fundings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: resolvedCompanyName || undefined,
          txHash: tx.hash,
          amount,
          tokenSymbol: form.rewardToken || treasuryConfig.tokenSymbol || 'USD1',
          network,
          fromAddress: connection.walletAddress,
          toAddress: treasuryConfig.treasuryAddress
        })
      }).catch(() => null)
      setTreasuryFundings((prev) => [{
        id: tx.hash,
        companyName: resolvedCompanyName,
        txHash: tx.hash,
        amount,
        tokenSymbol: form.rewardToken || treasuryConfig.tokenSymbol || 'USD1',
        network,
        fromAddress: connection.walletAddress,
        toAddress: treasuryConfig.treasuryAddress,
        status: 'recorded',
        source: 'wallet_payment',
        createdAt: new Date().toISOString()
      }, ...prev.filter((item) => item.txHash !== tx.hash)])

      setTaskFeedback(taskId, 'success', `Wallet payment confirmed. Funding tx ${tx.hash} has been auto-filled. Proceed to the next step.`)
    } catch (error) {
      setTaskFeedback(taskId, 'danger', error instanceof Error ? error.message : 'Wallet payment failed')
    } finally {
      setActiveFundingTaskId(null)
    }
  }

  const lockReward = async (taskId: string) => {
    const form = lockForms[taskId] || initialLockForm(tasks.find((item) => item.id === taskId)!)
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'lockReward',
        taskId,
        rewardAmount: Number(form.rewardAmount || 0),
        rewardToken: form.rewardToken,
        fundingTxHash: form.fundingTxHash,
        lockContractAddress: form.lockContractAddress,
        companyName: form.companyName
      })
    })
    const data = await res.json().catch(() => ({}))
    setTaskFeedback(taskId, res.ok ? 'success' : 'danger', data?.error || 'Reward locked successfully')
    if (res.ok) onRefresh()
  }

  const submitTask = async (taskId: string) => {
    const form = deliveryForms[taskId] || initialDeliveryForm(tasks.find((item) => item.id === taskId)!)
    setPayoutOverlayVisible(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', taskId, prUrl: form.prUrl, commitSha: form.commitSha, ciPassed: true })
      })
      const data = await res.json().catch(() => ({}))
      setTaskFeedback(taskId, res.ok ? 'success' : 'danger', data?.inferPopup || data?.error || 'Submitted successfully')
      if (res.ok) onRefresh()
    } finally {
      setPayoutOverlayVisible(false)
    }
  }

  const financeApprove = async (taskId: string) => {
    setPayoutOverlayVisible(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'financeApprove', taskId })
      })
      const data = await res.json().catch(() => ({}))
      setTaskFeedback(taskId, res.ok ? 'success' : 'danger', data?.error || 'Finance approval granted. Payout stage initiated.')
      if (res.ok) onRefresh()
    } finally {
      setPayoutOverlayVisible(false)
    }
  }

  const executePayout = async (taskId: string) => {
    setPayoutOverlayVisible(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'executePayout', taskId, merged: true, riskPassed: true, forceManualRelease: true })
      })
      const data = await res.json().catch(() => ({}))
      setTaskFeedback(taskId, res.ok ? 'success' : 'danger', data?.error || `Payout executed successfully: ${data?.txHash || ''}`)
      if (res.ok) onRefresh()
    } finally {
      setPayoutOverlayVisible(false)
    }
  }

  const filteredTasks = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    let next = tasks.filter((task) => {
      if (sourceFilter !== 'all' && task.source !== sourceFilter) return false
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (needsRequirementBindingOnly && task.requirementDocUrl) return false
      if (!keyword) return true
      return [
        task.title,
        task.description,
        task.repo,
        task.claimedByGithubLogin,
        task.requirementId,
        task.githubIssueNumber ? String(task.githubIssueNumber) : '',
        task.githubPrNumber ? String(task.githubPrNumber) : ''
      ].some((value) => String(value || '').toLowerCase().includes(keyword))
    })

    next = [...next].sort((a, b) => {
      if (sortKey === 'reward_desc') return (b.rewardAmount || 0) - (a.rewardAmount || 0)
      if (sortKey === 'status') return a.status.localeCompare(b.status)
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
    return next
  }, [tasks, search, sourceFilter, statusFilter, sortKey, needsRequirementBindingOnly])

  const internalTasks = useMemo(() => filteredTasks.filter((x) => x.source !== 'external'), [filteredTasks])
  const externalTasks = useMemo(() => filteredTasks.filter((x) => x.source === 'external'), [filteredTasks])
  const urgentTasks = useMemo(
    () => filteredTasks.filter((task) => ['payment_failed', 'awaiting_manual_review', 'awaiting_finance_review'].includes(task.status)),
    [filteredTasks]
  )
  const highlightedTask = useMemo(
    () => urgentTasks[0] || externalTasks.find((task) => task.status === 'awaiting_acceptance') || externalTasks[0] || internalTasks[0] || null,
    [externalTasks, internalTasks, urgentTasks]
  )

  const canAdvancePromoteStep = (task: TaskBounty, promoteForm: PromoteForm, currentStep: PromoteStep) => {
    const resolvedCompanyName = String(task.companyName || promoteForm.companyName || task.payerCompanyName || '').trim()
    const effectiveRepoConfigId = promoteForm.repoConfigId || task.repoConfigId || defaultRepoConfigId || ''
    const selectedRepoConfig = repoConfigs.find((item) => item.id === effectiveRepoConfigId)
    const resolvedMirrorRepoUrl = promoteForm.mirrorRepoUrl || buildGitHubRepoUrl(selectedRepoConfig?.owner, selectedRepoConfig?.repo)
    if (currentStep === 1) {
      return Boolean(promoteForm.rewardAmount && promoteForm.rewardToken && resolvedCompanyName)
    }
    if (currentStep === 2) {
      return Boolean(effectiveRepoConfigId && (promoteForm.repoVisibility === 'private' || resolvedMirrorRepoUrl))
    }
    if (currentStep === 3) {
      return Boolean(promoteForm.description || task.description || promoteForm.requirementDocUrl || task.requirementDocUrl)
    }
    return true
  }

  const queueSummary = [
    ['Total pending', String(filteredTasks.length)],
    ['Manual/finance queue', String(urgentTasks.length)],
    ['External bounties', String(externalTasks.length)],
    ['Budget locked', String(filteredTasks.filter((task) => task.rewardLockStatus === 'locked').length)]
  ]

  const findReusableFundings = (task: TaskBounty, promoteForm: PromoteForm) => {
    const rewardAmount = Number(promoteForm.rewardAmount || 0)
    const rewardToken = String(promoteForm.rewardToken || 'USD1').trim().toUpperCase()
    const companyName = String(task.companyName || promoteForm.companyName || task.payerCompanyName || '').trim().toLowerCase()

    return treasuryFundings.filter((item) => {
      if (item.status !== 'recorded') return false
      if (String(item.tokenSymbol || '').toUpperCase() !== rewardToken) return false
      if (Number(item.amount || 0) < rewardAmount) return false
      if (companyName && item.companyName && item.companyName.trim().toLowerCase() !== companyName) return false
      return true
    })
  }

  const resolveRepoConfig = (task: TaskBounty, promoteForm: PromoteForm) => {
    const effectiveRepoConfigId = promoteForm.repoConfigId || task.repoConfigId || defaultRepoConfigId || ''
    const selectedRepoConfig = repoConfigs.find((item) => item.id === effectiveRepoConfigId)
    return {
      effectiveRepoConfigId,
      selectedRepoConfig,
      resolvedRepoLabel: selectedRepoConfig ? `${selectedRepoConfig.owner}/${selectedRepoConfig.repo}` : (task.repo || promoteForm.repo || ''),
      resolvedMirrorRepoUrl: promoteForm.mirrorRepoUrl || buildGitHubRepoUrl(selectedRepoConfig?.owner, selectedRepoConfig?.repo)
    }
  }

  return (
    <div className="core-shell space-y-5">
      <PayoutExecutionOverlay visible={payoutOverlayVisible} />
      <section className="core-hero p-5">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="chip">task operations</span>
              <span className="chip">role {userRole}</span>
              <span className="chip">{filteredTasks.length} visible tasks</span>
            </div>
            <div>
              <p className="section-title">Delivery Workspace</p>
              <h2 className="mt-2 core-heading">Delivery Workspace</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              {queueSummary.map(([label, value]) => (
                <div key={label} className="core-action">
                  <p className="section-title">{label}</p>
                  <p className="mt-2 core-kpi">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="core-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-title">Next Best Action</p>
                <p className="mt-2 text-lg font-semibold text-white">{highlightedTask ? highlightedTask.title : 'Create or sync tasks first'}</p>
              </div>
              <span className="chip">{highlightedTask?.status || 'empty'}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {highlightedTask && <button onClick={() => setSelectedTask(highlightedTask)} className="btn-primary">Open task detail</button>}
              {canManageStructure && <button onClick={syncGithubIssues} className="btn-ghost">Sync GitHub Issues</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="panel rounded-xl p-5">
        <div className="space-y-3">
          <p className="section-title">Task Studio</p>
          <h2 className="text-xl font-semibold text-white">Task Studio</h2>
          <div className="flex flex-wrap gap-3">
            {canManageStructure && <button onClick={refreshRequirementBindings} className="btn-secondary">Refresh requirement bindings</button>}
            <span className="chip">Meegle {internalTasks.length}</span>
            <span className="chip">External {externalTasks.length}</span>
            <span className="chip">Missing structured requirements {tasks.filter((task) => !task.requirementId && !task.requirementDocUrl && !(task.acceptanceCriteriaSnapshot && task.acceptanceCriteriaSnapshot.length)).length}</span>
            <span className="chip">role {userRole}</span>
          </div>
        </div>
      </section>

      <section className="panel rounded-xl p-4">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_repeat(3,0.6fr)]">
          <div>
            <label htmlFor="field-search" className="label">Search</label>
            <input id="field-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, repo, claimer, issue number" className="input mt-2" />
          </div>
          <div>
            <label htmlFor="field-source-filter" className="label">Source</label>
            <select id="field-source-filter" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'internal' | 'external')} className="select mt-2">
              <option value="all">All</option>
              <option value="internal">Meegle sync</option>
              <option value="external">External</option>
            </select>
          </div>
          <div>
            <label htmlFor="field-status-filter" className="label">Status</label>
            <select id="field-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskBounty['status'])} className="select mt-2">
              <option value="all">All</option>
              <option value="open">open</option>
              <option value="in_progress">in_progress</option>
              <option value="submitted">submitted</option>
              <option value="ai_reviewing">ai_reviewing</option>
              <option value="awaiting_acceptance">awaiting_acceptance</option>
              <option value="accepted">accepted</option>
              <option value="paid">paid</option>
              <option value="disputed">disputed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div>
            <label htmlFor="field-sort" className="label">Sort</label>
            <select id="field-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value as 'updated_desc' | 'reward_desc' | 'status')} className="select mt-2">
              <option value="updated_desc">Recently updated</option>
              <option value="reward_desc">Reward amount</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setNeedsRequirementBindingOnly(false)}
            className={`filter-chip ${!needsRequirementBindingOnly ? 'filter-chip-active' : ''}`}
          >
            All tasks
          </button>
          <button
            onClick={() => setNeedsRequirementBindingOnly(true)}
            className={`filter-chip ${needsRequirementBindingOnly ? 'filter-chip-active' : ''}`}
          >
            Missing structured requirements only
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="section-title">Meegle Intake</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Meegle synced requirements</h3>
          </div>
          <span className="chip">{internalTasks.length} tasks</span>
        </div>

        {internalTasks.length === 0 ? (
          <div className="panel rounded-2xl p-10 text-center subtle">No tasks</div>
        ) : (
          <div className="space-y-4">
            {internalTasks.map((task) => {
              const promoteForm = promoteForms[task.id] || initialPromoteForm()
              const currentPanel = activePanel[task.id]
              const reusableFundings = findReusableFundings(task, promoteForm)
              const resolvedCompanyName = String(task.companyName || promoteForm.companyName || task.payerCompanyName || '').trim()
              const currentStep = promoteSteps[task.id] || 1
              const isPublishing = activePromotingTaskId === task.id
              const cardFeedback = taskFeedbacks[task.id]
              const { effectiveRepoConfigId, selectedRepoConfig, resolvedRepoLabel, resolvedMirrorRepoUrl } = resolveRepoConfig(task, promoteForm)
              return (
                <div key={task.id} className="panel task-card relative rounded-2xl p-5">
                  {isPublishing && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-slate-950/70 px-6 text-center text-sm font-medium text-white">
                      AI is reviewing your requirements, please wait…
                    </div>
                  )}
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={statusClass(task.status)}>{humanizeStatus(task.status)}</span>
                        {task.pendingMeegleStatus && <span className="chip">Meegle {task.pendingMeegleStatus}</span>}
                        {task.id.startsWith('meegle-') ? <span className="chip">meegle</span> : <span className="chip">platform</span>}
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-white">{task.title}</h4>
                        {task.description ? <p className="mt-2 text-sm leading-7 subtle">{task.description}</p> : null}
                      </div>
                      <div className="info-list">
                        {task.requirementId && <div className="info-row"><span className="info-key">Requirement</span><span>{task.requirementId}</span></div>}
                        {task.requirementDocUrl && <div className="info-row"><span className="info-key">Reference doc</span><span className="truncate">{task.requirementDocUrl}</span></div>}
                        {task.repo && <div className="info-row"><span className="info-key">Repo</span><span>{task.repo}</span></div>}
                        {task.meegleAssignee && <div className="info-row"><span className="info-key">Meegle</span><span>{task.meegleAssignee}</span></div>}
                        {task.internalGithubLogin && <div className="info-row"><span className="info-key">GitHub</span><span>@{task.internalGithubLogin}</span></div>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setSelectedTask(task)} className="btn-ghost">View detail</button>
                      {canManageStructure && (
                        <button
                          onClick={() => {
                            setActivePanel((prev) => ({ ...prev, [task.id]: currentPanel === 'promote' ? null : 'promote' }))
                            setPromoteSteps((prev) => ({ ...prev, [task.id]: prev[task.id] || 1 }))
                          }}
                          className="btn-secondary"
                          disabled={isPublishing}
                        >
                          Publish as external bounty
                        </button>
                      )}
                    </div>
                  </div>

                  {currentPanel === 'promote' && (
                    <div className="mt-5 command-card">
                      <div className="mb-3 grid gap-3 md:grid-cols-4">
                        {[
                          ['1', 'Reward & payer'],
                          ['2', 'Repo & delivery mode'],
                          ['3', 'Requirements & claim constraints'],
                          ['4', 'Publish confirmation']
                        ].map(([num, label], index) => {
                          return (
                            <div key={label} className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-3">
                              <div className="flex items-center gap-2">
                                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${currentStep > index ? 'bg-white text-slate-950' : 'bg-white/10 text-white'}`}>{num}</div>
                                <p className="text-xs font-semibold text-white">{label}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {!resolvedCompanyName && (
                        <div className="mb-4 rounded-[10px] border border-apple-red/30 bg-apple-red/10 px-4 py-3 text-sm text-apple-red">
                          This task has no associated company.
                        </div>
                      )}
                      {resolvedCompanyName && currentStep !== 4 && !promoteForm.fundingTxHash && (
                        <div className="mb-4 rounded-[10px] border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                          Step 4: payment
                        </div>
                      )}

                      {currentStep === 1 && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label htmlFor={`field-reward-amount-${task.id}`} className="label">Reward Amount</label>
                            <input id={`field-reward-amount-${task.id}`} className="input mt-2" value={promoteForm.rewardAmount} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, rewardAmount: e.target.value } }))} />
                          </div>
                          <div>
                            <label htmlFor={`field-reward-token-${task.id}`} className="label">Reward Token</label>
                            <input id={`field-reward-token-${task.id}`} className="input mt-2" value={promoteForm.rewardToken} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, rewardToken: e.target.value } }))} />
                          </div>
                          <div className="md:col-span-2">
                            <label htmlFor={`field-company-name-${task.id}`} className="label">Company Name</label>
                            <input
                              id={`field-company-name-${task.id}`}
                              className="input mt-2"
                              value={resolvedCompanyName}
                              readOnly
                              placeholder="Task has no company. Please associate a company in the database first."
                            />
                          </div>
                          <div className="md:col-span-2 rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-4 text-sm subtle">
                            <p>Network: {treasuryConfig?.network?.toUpperCase() || 'BSC'}</p>
                            <p>Token: {treasuryConfig?.tokenSymbol || 'USD1'}</p>
                            <p className="break-all">Platform receiving address: {treasuryConfig?.treasuryAddress || '-'}</p>
                          </div>
                        </div>
                      )}

                      {currentStep === 2 && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label htmlFor={`field-repo-visibility-${task.id}`} className="label">Repo Visibility</label>
                            <select id={`field-repo-visibility-${task.id}`} className="select mt-2" value={promoteForm.repoVisibility} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, repoVisibility: e.target.value as 'public' | 'private' } }))}>
                              <option value="public">public</option>
                              <option value="private">private</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`field-bound-repo-${task.id}`} className="label">Bound Repo</label>
                            <select id={`field-bound-repo-${task.id}`}
                              className="select mt-2"
                              value={effectiveRepoConfigId}
                              onChange={(e) => {
                                const nextRepoConfigId = e.target.value
                                const nextRepoConfig = repoConfigs.find((item) => item.id === nextRepoConfigId)
                                setPromoteForms((prev) => ({
                                  ...prev,
                                  [task.id]: {
                                    ...promoteForm,
                                    repoConfigId: nextRepoConfigId,
                                    repo: nextRepoConfig ? `${nextRepoConfig.owner}/${nextRepoConfig.repo}` : ''
                                  }
                                }))
                              }}
                            >
                              <option value="">Select a bound repo</option>
                              {repoConfigs.map((item) => (
                                <option key={item.id} value={item.id}>{item.owner}/{item.repo} ({item.defaultBranch})</option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2 rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-4 text-sm subtle">
                            <p>Target repo: {resolvedRepoLabel || 'Not selected'}</p>
                            <p>Default branch: {selectedRepoConfig?.defaultBranch || '-'}</p>
                            {!repoConfigs.length && (
                              <p className="mt-2 text-apple-orange">No repo configurations found</p>
                            )}
                          </div>
                          <div className="md:col-span-2">
                            <label htmlFor={`field-mirror-repo-url-${task.id}`} className="label">Mirror Repo URL</label>
                            <input
                              id={`field-mirror-repo-url-${task.id}`}
                              className="input mt-2"
                              value={resolvedMirrorRepoUrl}
                              onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, mirrorRepoUrl: e.target.value } }))}
                              placeholder="https://github.com/org/repo"
                            />
                          </div>
                        </div>
                      )}

                      {currentStep === 3 && (
                        <>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label htmlFor={`field-requirement-doc-url-${task.id}`} className="label">Reference Doc URL</label>
                              <input id={`field-requirement-doc-url-${task.id}`} className="input mt-2" value={promoteForm.requirementDocUrl} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, requirementDocUrl: e.target.value } }))} placeholder={task.requirementDocUrl || 'https://...larksuite.com/...'} />
                            </div>
                            <div>
                              <label htmlFor={`field-requirement-id-${task.id}`} className="label">Requirement ID</label>
                              <input id={`field-requirement-id-${task.id}`} className="input mt-2" value={promoteForm.requirementId} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, requirementId: e.target.value.toUpperCase() } }))} placeholder={task.requirementId || 'Leave blank to auto-generate'} />
                            </div>
                            <div>
                              <label htmlFor={`field-claim-github-login-${task.id}`} className="label">Claim GitHub Login</label>
                              <input id={`field-claim-github-login-${task.id}`} className="input mt-2" value={promoteForm.claimGithubLogin} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, claimGithubLogin: e.target.value } }))} placeholder="@developer" />
                            </div>
                            <div>
                              <label htmlFor={`field-wallet-address-${task.id}`} className="label">Wallet Address</label>
                              <input id={`field-wallet-address-${task.id}`} className="input mt-2" value={promoteForm.walletAddress} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, walletAddress: e.target.value } }))} placeholder="0x..." />
                            </div>
                            <div className="md:col-span-2">
                              <label htmlFor={`field-requirement-supplement-${task.id}`} className="label">Requirement Supplement</label>
                              <textarea id={`field-requirement-supplement-${task.id}`} className="textarea mt-2" rows={4} value={promoteForm.description} onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, description: e.target.value } }))} placeholder="Supplement" />
                            </div>
                          </div>
                        </>
                      )}

                      {currentStep === 4 && (
                        <div className="space-y-4">
                          <div className="md:col-span-2">
                            <p className="label">Wallet Payment</p>
                            <div className="mt-2 rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-4">
                              <div className="flex flex-wrap gap-3">
                                <button
                                  className="btn-primary"
                                  onClick={() => fundTreasuryWithWallet(task.id)}
                                  disabled={activeFundingTaskId === task.id || !treasuryConfig?.enabled}
                                >
                                  {activeFundingTaskId === task.id ? 'Processing wallet payment...' : 'Connect wallet and pay'}
                                </button>
                                {promoteForm.fundingTxHash && <span className="chip">tx captured</span>}
                                {promoteForm.fundingWalletAddress && <span className="chip">{promoteForm.fundingWalletAddress}</span>}
                              </div>
                              {reusableFundings.length > 0 && (
                                <div className="mt-4 space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Reusable fundings</p>
                                  <div className="space-y-2">
                                    {reusableFundings.slice(0, 3).map((item) => (
                                      <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                          setPromoteForms((prev) => ({
                                            ...prev,
                                            [task.id]: {
                                              ...promoteForm,
                                              fundingTxHash: item.txHash,
                                              fundingWalletAddress: item.fromAddress || ''
                                            }
                                          }))
                                          setTaskFeedback(task.id, 'success', `Platform funding ${item.txHash} reused. You can now publish the external bounty.`)
                                        }}
                                        className="w-full rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-3 text-left transition hover:border-apple-blue/30 hover:bg-apple-blue/10"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="chip">Reusable</span>
                                          <span className="chip">{item.amount} {item.tokenSymbol}</span>
                                          {item.companyName && <span className="chip">{item.companyName}</span>}
                                        </div>
                                        <p className="mt-2 break-all text-xs text-slate-300/80">TxHash: {item.txHash}</p>
                                        {item.fromAddress && <p className="mt-1 break-all text-xs subtle">Payer wallet: {item.fromAddress}</p>}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <input
                                readOnly
                                className="input mt-3"
                                value={promoteForm.fundingTxHash}
                                placeholder="Transaction hash"
                              />
                            </div>
                          </div>
                          <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-4 text-sm subtle">
                            <p>Payer: {resolvedCompanyName || 'No company linked'}</p>
                            <p>Reward: {promoteForm.rewardAmount || '-'} {promoteForm.rewardToken || '-'}</p>
                            <p>Platform funding tx: {promoteForm.fundingTxHash || '-'}</p>
                            <p>Platform receiving network: {treasuryConfig?.network?.toUpperCase() || 'BSC (not configured)'}</p>
                            <p>Repo: {resolvedRepoLabel || '-'}</p>
                            <p>Delivery mode: {promoteForm.repoVisibility === 'private' ? 'private_collab_pr' : 'public_mirror_pr'}</p>
                            <p>Reference doc: {promoteForm.requirementDocUrl || task.requirementDocUrl || '-'}</p>
                            <p>Claimer: {promoteForm.claimGithubLogin || 'Open to claim'}</p>
                            <p>Wallet constraint: {promoteForm.walletAddress || 'Not preset'}</p>
                          </div>
                          <label htmlFor={`field-publish-to-github-${task.id}`} className="flex items-center gap-3 text-sm text-white">
                            <input
                              id={`field-publish-to-github-${task.id}`}
                              type="checkbox"
                              checked={promoteForm.publishToGithub}
                              onChange={(e) => setPromoteForms((prev) => ({ ...prev, [task.id]: { ...promoteForm, publishToGithub: e.target.checked } }))}
                            />
                            Also create a GitHub Issue when publishing the external bounty
                          </label>
                        </div>
                      )}

                      <div className="mt-4 flex gap-3">
                        {currentStep > 1 && (
                          <button onClick={() => setPromoteSteps((prev) => ({ ...prev, [task.id]: Math.max(1, ((prev[task.id] || 1) - 1)) as PromoteStep }))} className="btn-ghost">
                            Back
                          </button>
                        )}
                        {currentStep < 4 ? (
                          <button
                            onClick={() => setPromoteSteps((prev) => ({ ...prev, [task.id]: Math.min(4, ((prev[task.id] || 1) + 1)) as PromoteStep }))}
                            className="btn-primary"
                            disabled={!canAdvancePromoteStep(task, promoteForm, currentStep)}
                          >
                            Next
                          </button>
                        ) : (
                          <button
                            onClick={() => promoteToExternal(task.id)}
                            className="btn-primary"
                            disabled={!canManageStructure || !resolvedCompanyName || !promoteForm.fundingTxHash}
                          >
                            Confirm publish as external bounty
                          </button>
                        )}
                        <button onClick={() => setActivePanel((prev) => ({ ...prev, [task.id]: null }))} className="btn-ghost">Collapse</button>
                      </div>
                    </div>
                  )}
                  {cardFeedback && (
                    <div aria-live="polite" role="status" className={`mt-4 feedback-banner feedback-${cardFeedback.tone}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>{cardFeedback.text}</span>
                        {cardFeedback.link && (
                          <a href={cardFeedback.link.href} target="_blank" className="text-apple-blue underline">
                            {cardFeedback.link.label}
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="section-title">External Queue</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">External bounties</h3>
          </div>
          <span className="chip">{externalTasks.length} tasks</span>
        </div>

        {externalTasks.length === 0 ? (
          <div className="panel rounded-2xl p-10 text-center subtle">No tasks</div>
        ) : (
          <div className="space-y-4">
            {externalTasks.map((task) => {
              const currentPanel = activePanel[task.id]
              const lockForm = lockForms[task.id] || initialLockForm(task)
              const deliveryForm = deliveryForms[task.id] || initialDeliveryForm(task)
              const claimability = claimabilityChip(task)
              const cardFeedback = taskFeedbacks[task.id]
              return (
                <div key={task.id} className="panel task-card rounded-2xl p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={statusClass(task.status)}>{humanizeStatus(task.status)}</span>
                        {claimability && (
                          <span className={`text-[11px] px-2.5 py-1 rounded-full ${claimability.className}`}>
                            {claimability.label}
                          </span>
                        )}
                        <span className="chip">{task.rewardAmount} {task.rewardToken}</span>
                        {task.githubIssueNumber && <span className="chip">issue #{task.githubIssueNumber}</span>}
                        {task.rewardLockStatus && <span className="chip">lock {task.rewardLockStatus}</span>}
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-white">{task.title}</h4>
                        {task.description ? <p className="mt-2 text-sm leading-7 subtle">{task.description}</p> : null}
                      </div>
                      <div className="info-list">
                        {task.requirementId && <div className="info-row"><span className="info-key">Requirement</span><span>{task.requirementId}</span></div>}
                        {task.requirementDocUrl && <div className="info-row"><span className="info-key">Reference doc</span><span className="truncate">{task.requirementDocUrl}</span></div>}
                        <div className="info-row"><span className="info-key">Repo</span><span>{task.repo || '-'}</span></div>
                        <div className="info-row"><span className="info-key">Delivery</span><span>{task.deliveryMode || 'public_mirror_pr'}</span></div>
                        <div className="info-row"><span className="info-key">Payout Account</span><span>{task.payerCompanyName || 'Platform Treasury'} {task.payerWalletAddress ? `(${task.payerWalletAddress})` : ''}</span></div>
                        {task.prAuthorGithubLogin && <div className="info-row"><span className="info-key">PR Author</span><span>@{task.prAuthorGithubLogin}</span></div>}
                        <div className="info-row"><span className="info-key">CI</span><span>{boolLabel(task.ciPassed)}</span></div>
                        <div className="info-row"><span className="info-key">Review</span><span>{task.githubReviewDecision || '-'}</span></div>
                        <div className="info-row"><span className="info-key">AI Score</span><span>{task.aiScore ?? '-'}</span></div>
                        <div className="info-row"><span className="info-key">Completion</span><span>{task.aiCompletionScore ?? '-'}</span></div>
                        {task.txHash && <div className="info-row"><span className="info-key">Tx</span><span className="font-mono text-xs">{task.txHash}</span></div>}
                      </div>
                      {(task.githubCheckSummary || task.lastAutoPayoutError || (task.aiCriticFindings && task.aiCriticFindings.length > 0)) && (
                        <div className="rounded-[10px] border border-apple-orange/20 bg-apple-orange/8 p-3 text-xs text-apple-orange/85 space-y-2">
                          {task.githubCheckSummary && (
                            <p><span className="font-medium">GitHub Checks:</span> {task.githubCheckSummary}</p>
                          )}
                          {task.lastAutoPayoutError && (
                            <p><span className="font-medium">Payout Blocker:</span> {normalizePayoutBlocker(task.lastAutoPayoutError)}</p>
                          )}
                          {task.aiCriticFindings && task.aiCriticFindings.length > 0 && (
                            <div>
                              <p className="font-medium">AI Findings</p>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {task.aiCriticFindings.map((finding) => (
                                  <span key={finding} className="chip">{finding}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {task.aiPrSuggestions && task.aiPrSuggestions.length > 0 && (
                        <div className="rounded-[10px] border border-apple-blue/20 bg-apple-blue/8 p-3 text-xs text-apple-blue/85 space-y-2">
                          <p className="font-medium">PR suggestions</p>
                          <div className="flex flex-wrap gap-2">
                            {task.aiPrSuggestions.map((item) => (
                              <span key={item} className="chip">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {task.aiManagerFocus && task.aiManagerFocus.length > 0 && (
                        <div className="rounded-[10px] border border-apple-red/20 bg-apple-red/8 p-3 text-xs text-apple-red/90 space-y-2">
                          <p className="font-medium">Manager focus areas</p>
                          <div className="flex flex-wrap gap-2">
                            {task.aiManagerFocus.map((item) => (
                              <span key={item} className="chip">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {task.lastAutoPayoutChecks && (
                        <div className="flex flex-wrap gap-2 text-xs">
                          {'reviewApproved' in task.lastAutoPayoutChecks && <span className="chip">review {String(task.lastAutoPayoutChecks.reviewApproved)}</span>}
                          {'merged' in task.lastAutoPayoutChecks && <span className="chip">merge {String(task.lastAutoPayoutChecks.merged)}</span>}
                          {'ciPassed' in task.lastAutoPayoutChecks && <span className="chip">CI {String(task.lastAutoPayoutChecks.ciPassed)}</span>}
                          {'riskPassed' in task.lastAutoPayoutChecks && <span className="chip">risk {String(task.lastAutoPayoutChecks.riskPassed)}</span>}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-3 text-sm">
                        {task.githubIssueUrl && (
                          <a href={task.githubIssueUrl} target="_blank" className="btn-secondary">
                            Open on GitHub (issue)
                          </a>
                        )}
                        {task.prUrl && <a href={task.prUrl} target="_blank" className="text-apple-blue underline">View PR</a>}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setSelectedTask(task)} className="btn-ghost">View detail</button>
                      {canManageFinance && <button onClick={() => setActivePanel((prev) => ({ ...prev, [task.id]: currentPanel === 'lock' ? null : 'lock' }))} className="btn-ghost">Lock reward</button>}
                      {canReviewDelivery && <button onClick={() => setActivePanel((prev) => ({ ...prev, [task.id]: currentPanel === 'submit' ? null : 'submit' }))} className="btn-ghost">Submit delivery</button>}
                      {canManageFinance && (task.status === 'awaiting_acceptance' || task.status === 'awaiting_finance_review' || task.status === 'payment_failed') && (
                        <button onClick={() => financeApprove(task.id)} className="btn-primary">Finance approve</button>
                      )}
                      {canManageFinance && task.status === 'accepted' && (
                        <button onClick={() => executePayout(task.id)} className="btn-primary">Execute payout</button>
                      )}
                    </div>
                  </div>

                  {currentPanel === 'lock' && (
                    <div className="mt-5 command-card">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor={`field-lock-reward-amount-${task.id}`} className="label">Reward Amount</label>
                          <input id={`field-lock-reward-amount-${task.id}`} className="input mt-2" value={lockForm.rewardAmount} onChange={(e) => setLockForms((prev) => ({ ...prev, [task.id]: { ...lockForm, rewardAmount: e.target.value } }))} />
                        </div>
                        <div>
                          <label htmlFor={`field-lock-reward-token-${task.id}`} className="label">Reward Token</label>
                          <input id={`field-lock-reward-token-${task.id}`} className="input mt-2" value={lockForm.rewardToken} onChange={(e) => setLockForms((prev) => ({ ...prev, [task.id]: { ...lockForm, rewardToken: e.target.value } }))} />
                        </div>
                        <div>
                          <label htmlFor={`field-lock-funding-tx-hash-${task.id}`} className="label">Funding Tx Hash</label>
                          <input id={`field-lock-funding-tx-hash-${task.id}`} className="input mt-2" value={lockForm.fundingTxHash} onChange={(e) => setLockForms((prev) => ({ ...prev, [task.id]: { ...lockForm, fundingTxHash: e.target.value } }))} placeholder="0x..." />
                        </div>
                        <div>
                          <label htmlFor={`field-lock-contract-${task.id}`} className="label">Lock Contract</label>
                          <input id={`field-lock-contract-${task.id}`} className="input mt-2" value={lockForm.lockContractAddress} onChange={(e) => setLockForms((prev) => ({ ...prev, [task.id]: { ...lockForm, lockContractAddress: e.target.value } }))} placeholder="0x..." />
                        </div>
                        <div>
                          <label htmlFor={`field-lock-company-name-${task.id}`} className="label">Company Name</label>
                          <input id={`field-lock-company-name-${task.id}`} className="input mt-2" value={lockForm.companyName} onChange={(e) => setLockForms((prev) => ({ ...prev, [task.id]: { ...lockForm, companyName: e.target.value } }))} placeholder="Leave blank to use active wallet" />
                        </div>
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button onClick={() => lockReward(task.id)} className="btn-secondary" disabled={!canManageFinance}>Confirm lock reward</button>
                        <button onClick={() => setActivePanel((prev) => ({ ...prev, [task.id]: null }))} className="btn-ghost">Collapse</button>
                      </div>
                    </div>
                  )}

                  {currentPanel === 'submit' && (
                    <div className="mt-5 command-card">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor={`field-submit-pr-url-${task.id}`} className="label">PR URL</label>
                          <input id={`field-submit-pr-url-${task.id}`} className="input mt-2" value={deliveryForm.prUrl} onChange={(e) => setDeliveryForms((prev) => ({ ...prev, [task.id]: { ...deliveryForm, prUrl: e.target.value } }))} placeholder="https://github.com/org/repo/pull/1" />
                        </div>
                        <div>
                          <label htmlFor={`field-submit-commit-sha-${task.id}`} className="label">Commit SHA</label>
                          <input id={`field-submit-commit-sha-${task.id}`} className="input mt-2" value={deliveryForm.commitSha} onChange={(e) => setDeliveryForms((prev) => ({ ...prev, [task.id]: { ...deliveryForm, commitSha: e.target.value } }))} placeholder="abc123..." />
                        </div>
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button onClick={() => submitTask(task.id)} className="btn-primary" disabled={!canReviewDelivery}>Submit delivery</button>
                        <button onClick={() => setActivePanel((prev) => ({ ...prev, [task.id]: null }))} className="btn-ghost">Collapse</button>
                      </div>
                    </div>
                  )}
                  {cardFeedback && (
                    <div aria-live="polite" role="status" className={`mt-4 feedback-banner feedback-${cardFeedback.tone}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>{cardFeedback.text}</span>
                        {cardFeedback.link && (
                          <a href={cardFeedback.link.href} target="_blank" className="text-apple-blue underline">
                            {cardFeedback.link.label}
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        )}
      </section>

      <TaskDetailDrawer task={selectedTask} role={userRole} companyRole={companyRole} onClose={() => setSelectedTask(null)} />
    </div>
  )
}
