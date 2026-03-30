import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireRolesMock = vi.fn()
const getCompanyContextMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const listTaskBountiesDbMock = vi.fn()
const getTaskBountyByIdDbMock = vi.fn()
const saveTaskBountiesDbMock = vi.fn()
const parsePaginationParamsMock = vi.fn()
const paginateArrayMock = vi.fn()
const syncSettlementCaseFromTaskMock = vi.fn()
const inferTaskSourceMock = vi.fn()
const normalizeTaskForClaimingMock = vi.fn()
const sameWalletAddressMock = vi.fn()
const parseBodyMock = vi.fn()

const handleCreateMock = vi.fn()
const handlePromoteMock = vi.fn()
const handleClaimMock = vi.fn()
const handleLockRewardMock = vi.fn()
const handleSubmitMock = vi.fn()
const handleAutoPayoutMock = vi.fn()
const handleManualReviewApproveMock = vi.fn()
const handleFinanceApproveMock = vi.fn()
const handleManualReviewRejectMock = vi.fn()
const handleExecutePayoutMock = vi.fn()
const handleRetryPayoutMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRoles: (...args: unknown[]) => requireRolesMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args)
}))

vi.mock('@/lib/runtime-data-db', () => ({
  listTaskBountiesDb: (...args: unknown[]) => listTaskBountiesDbMock(...args),
  getTaskBountyByIdDb: (...args: unknown[]) => getTaskBountyByIdDbMock(...args),
  saveTaskBountiesDb: (...args: unknown[]) => saveTaskBountiesDbMock(...args)
}))

vi.mock('@/lib/pagination', () => ({
  parsePaginationParams: (...args: unknown[]) => parsePaginationParamsMock(...args),
  paginateArray: (...args: unknown[]) => paginateArrayMock(...args)
}))

vi.mock('@/lib/repositories/settlement-case-repository', () => ({
  syncSettlementCaseFromTask: (...args: unknown[]) => syncSettlementCaseFromTaskMock(...args)
}))

vi.mock('@/app/api/tasks/helpers', () => ({
  inferTaskSource: (...args: unknown[]) => inferTaskSourceMock(...args),
  normalizeTaskForClaiming: (...args: unknown[]) => normalizeTaskForClaimingMock(...args),
  sameWalletAddress: (...args: unknown[]) => sameWalletAddressMock(...args)
}))

vi.mock('@/lib/validation', () => ({
  parseBody: (...args: unknown[]) => parseBodyMock(...args)
}))

vi.mock('@/app/api/tasks/schemas', () => ({
  taskActionSchemas: {
    create: { type: 'create-schema' },
    claim: { type: 'claim-schema' }
  }
}))

vi.mock('@/app/api/tasks/actions/create', () => ({
  handleCreate: (...args: unknown[]) => handleCreateMock(...args)
}))
vi.mock('@/app/api/tasks/actions/promote', () => ({
  handlePromote: (...args: unknown[]) => handlePromoteMock(...args)
}))
vi.mock('@/app/api/tasks/actions/claim', () => ({
  handleClaim: (...args: unknown[]) => handleClaimMock(...args)
}))
vi.mock('@/app/api/tasks/actions/lock-reward', () => ({
  handleLockReward: (...args: unknown[]) => handleLockRewardMock(...args)
}))
vi.mock('@/app/api/tasks/actions/submit', () => ({
  handleSubmit: (...args: unknown[]) => handleSubmitMock(...args)
}))
vi.mock('@/app/api/tasks/actions/auto-payout', () => ({
  handleAutoPayout: (...args: unknown[]) => handleAutoPayoutMock(...args)
}))
vi.mock('@/app/api/tasks/actions/manual-review-approve', () => ({
  handleManualReviewApprove: (...args: unknown[]) => handleManualReviewApproveMock(...args)
}))
vi.mock('@/app/api/tasks/actions/finance-approve', () => ({
  handleFinanceApprove: (...args: unknown[]) => handleFinanceApproveMock(...args)
}))
vi.mock('@/app/api/tasks/actions/manual-review-reject', () => ({
  handleManualReviewReject: (...args: unknown[]) => handleManualReviewRejectMock(...args)
}))
vi.mock('@/app/api/tasks/actions/execute-payout', () => ({
  handleExecutePayout: (...args: unknown[]) => handleExecutePayoutMock(...args)
}))
vi.mock('@/app/api/tasks/actions/retry-payout', () => ({
  handleRetryPayout: (...args: unknown[]) => handleRetryPayoutMock(...args)
}))

import { GET, POST } from '@/app/api/tasks/route'

describe('api/tasks route', () => {
  const baseSession = {
    userId: 'user-1',
    role: 'staff',
    githubLogin: 'alice',
    walletAddress: '0x' + 'a'.repeat(40),
    activeCompanyId: 'company-1'
  }

  const task = {
    id: 'task-1',
    source: 'internal',
    companyId: 'company-1',
    developerWallet: '0x' + 'a'.repeat(40),
    labels: []
  }

  beforeEach(() => {
    vi.clearAllMocks()

    requireRolesMock.mockReturnValue({ ok: true, session: baseSession })
    parseBodyMock.mockReturnValue({ success: true })
    parsePaginationParamsMock.mockReturnValue(undefined)
    inferTaskSourceMock.mockImplementation((t: { source?: string }) => t.source || 'internal')
    normalizeTaskForClaimingMock.mockReturnValue(false)
    sameWalletAddressMock.mockReturnValue(false)
    isPlatformAdminMock.mockReturnValue(false)
    getCompanyContextMock.mockResolvedValue({ company: { id: 'company-1' } })
    listTaskBountiesDbMock.mockResolvedValue([task])
    getTaskBountyByIdDbMock.mockResolvedValue(undefined)
    paginateArrayMock.mockImplementation((arr: unknown[]) => ({ items: arr, total: arr.length }))
    handleCreateMock.mockResolvedValue(Response.json({ ok: true, action: 'create' }))
    handleClaimMock.mockResolvedValue(Response.json({ ok: true, action: 'claim' }))
    handlePromoteMock.mockResolvedValue(Response.json({ ok: true, action: 'promote' }))
  })

  it('GET returns auth response when request is unauthorized', async () => {
    requireRolesMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/tasks'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 400 when non-admin user has no company context', async () => {
    getCompanyContextMock.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost/api/tasks'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Please select a valid company context first' })
  })

  it('POST returns validation response when schema validation fails', async () => {
    parseBodyMock.mockReturnValueOnce({
      success: false,
      response: Response.json({ error: 'invalid body' }, { status: 422 })
    })

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual({ error: 'invalid body' })
  })

  it('POST create dispatches to handleCreate', async () => {
    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', title: 'T1' })
      })
    )
    const body = await response.json()

    expect(handleCreateMock).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, action: 'create' })
  })

  it('POST returns 403 for external contributor disallowed action', async () => {
    requireRolesMock.mockReturnValueOnce({
      ok: true,
      session: { ...baseSession, role: 'external_contributor' }
    })

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'lockReward' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('External contributors can only claim or submit')
  })

  it('POST returns 404 when non-create action task does not exist', async () => {
    listTaskBountiesDbMock.mockResolvedValueOnce([])
    getTaskBountyByIdDbMock.mockResolvedValueOnce(undefined)

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'claim', taskId: 'missing-task' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Task not found' })
  })

  it('POST promoteToExternal rejects already external task', async () => {
    listTaskBountiesDbMock.mockResolvedValueOnce([{ ...task, source: 'external' }])

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'promoteToExternal', taskId: 'task-1' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'This task is already an external bounty' })
  })

  it('POST external contributor cannot submit task owned by others', async () => {
    requireRolesMock.mockReturnValueOnce({
      ok: true,
      session: {
        ...baseSession,
        role: 'external_contributor',
        externalAuthType: 'wallet',
        githubLogin: 'alice'
      }
    })
    listTaskBountiesDbMock.mockResolvedValueOnce([
      {
        ...task,
        externalUserId: 'someone-else',
        developerName: 'bob',
        claimedByGithubLogin: 'bob',
        developerWallet: '0x' + 'b'.repeat(40)
      }
    ])

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit', taskId: 'task-1' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'You can only submit your own tasks' })
  })

  it('POST returns 400 for unknown action', async () => {
    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unknownAction', taskId: 'task-1' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Unknown action' })
  })

  it('POST claim dispatches handler with company context, task and task list', async () => {
    listTaskBountiesDbMock.mockResolvedValueOnce([task, { ...task, id: 'task-2' }])
    getCompanyContextMock.mockResolvedValueOnce({ company: { id: 'company-1' }, membership: { role: 'company_owner' } })

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'claim', taskId: 'task-1' })
      })
    )

    expect(response.status).toBe(200)
    expect(handleClaimMock).toHaveBeenCalledWith(
      { action: 'claim', taskId: 'task-1' },
      expect.objectContaining({ userId: 'user-1' }),
      { company: { id: 'company-1' }, membership: { role: 'company_owner' } },
      expect.objectContaining({ id: 'task-1' }),
      expect.arrayContaining([expect.objectContaining({ id: 'task-2' })])
    )
  })
})
