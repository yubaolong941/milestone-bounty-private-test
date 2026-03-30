import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/company-wallets/route'

const verifyMessageMock = vi.fn()
const requireInternalUserMock = vi.fn()
const requireCompanyRolesMock = vi.fn()
const getCompanyContextMock = vi.fn()
const hasCompanyCapabilityMock = vi.fn()
const isPlatformAdminMock = vi.fn()
const getActorRoleLabelMock = vi.fn()

const buildExpiredCookieOptionsMock = vi.fn()
const deactivateOtherCompanyWalletsMock = vi.fn()
const findCompanyWalletMock = vi.fn()
const getCompanyByIdMock = vi.fn()
const getCompanyWalletByIdMock = vi.fn()
const insertAuditLogMock = vi.fn()
const insertCompanyWalletMock = vi.fn()
const listCompanyWalletsMock = vi.fn()
const updateCompanyFieldsMock = vi.fn()
const updateCompanyWalletMock = vi.fn()
const upsertWalletIdentityBindingMock = vi.fn()

vi.mock('uuid', () => ({
  v4: () => 'wallet-uuid'
}))

vi.mock('ethers', () => ({
  verifyMessage: (...args: unknown[]) => verifyMessageMock(...args)
}))

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args),
  requireCompanyRoles: (...args: unknown[]) => requireCompanyRolesMock(...args),
  getCompanyContext: (...args: unknown[]) => getCompanyContextMock(...args),
  hasCompanyCapability: (...args: unknown[]) => hasCompanyCapabilityMock(...args),
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args),
  getActorRoleLabel: (...args: unknown[]) => getActorRoleLabelMock(...args)
}))

vi.mock('@/lib/session', () => ({
  buildExpiredCookieOptions: (...args: unknown[]) => buildExpiredCookieOptionsMock(...args)
}))

vi.mock('@/lib/access-control-db', () => ({
  deactivateOtherCompanyWallets: (...args: unknown[]) => deactivateOtherCompanyWalletsMock(...args),
  findCompanyWallet: (...args: unknown[]) => findCompanyWalletMock(...args),
  getCompanyById: (...args: unknown[]) => getCompanyByIdMock(...args),
  getCompanyWalletById: (...args: unknown[]) => getCompanyWalletByIdMock(...args),
  insertAuditLog: (...args: unknown[]) => insertAuditLogMock(...args),
  insertCompanyWallet: (...args: unknown[]) => insertCompanyWalletMock(...args),
  listCompanyWallets: (...args: unknown[]) => listCompanyWalletsMock(...args),
  updateCompanyFields: (...args: unknown[]) => updateCompanyFieldsMock(...args),
  updateCompanyWallet: (...args: unknown[]) => updateCompanyWalletMock(...args)
}))

vi.mock('@/lib/identity-registry', () => ({
  upsertWalletIdentityBinding: (...args: unknown[]) => upsertWalletIdentityBindingMock(...args)
}))

describe('api/company-wallets route', () => {
  const session = {
    userId: 'user-1',
    githubLogin: 'alice',
    activeCompanyId: 'company-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session })
    requireCompanyRolesMock.mockResolvedValue({
      ok: true,
      companyId: 'company-1',
      session,
      membership: { role: 'company_owner' }
    })
    getCompanyContextMock.mockResolvedValue({
      company: { id: 'company-1' },
      membership: { role: 'company_owner' }
    })
    hasCompanyCapabilityMock.mockReturnValue(true)
    isPlatformAdminMock.mockReturnValue(false)
    getActorRoleLabelMock.mockReturnValue('company_owner')

    buildExpiredCookieOptionsMock.mockReturnValue({ path: '/', maxAge: 0 })
    getCompanyByIdMock.mockResolvedValue({ id: 'company-1', name: 'Acme' })
    listCompanyWalletsMock.mockResolvedValue([])
  })

  it('GET returns auth response when unauthenticated', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/company-wallets'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('GET rejects non-admin request without companyId context', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: true,
      session: { ...session, activeCompanyId: undefined }
    })

    const response = await GET(new Request('http://localhost/api/company-wallets'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Missing companyId' })
  })

  it('GET returns 403 when membership lacks company.read capability', async () => {
    hasCompanyCapabilityMock.mockReturnValueOnce(false)

    const response = await GET(
      new Request('http://localhost/api/company-wallets?companyId=company-1')
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Not authorized to view company wallets' })
  })

  it('POST bind validates wallet address format', async () => {
    const response = await POST(
      new Request('http://localhost/api/company-wallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'bind',
          companyId: 'company-1',
          companyName: 'Acme',
          walletAddress: 'not-an-address',
          message: 'm',
          signature: 's'
        })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Validation failed')
  })

  it('POST bind returns 400 when challenge/signature data is incomplete', async () => {
    const response = await POST(
      new Request('http://localhost/api/company-wallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'bind',
          companyId: 'company-1',
          companyName: 'Acme',
          walletAddress: '0x' + 'a'.repeat(40)
        })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Validation failed')
  })

  it('POST activate switches active wallet and returns updated item', async () => {
    getCompanyWalletByIdMock.mockResolvedValueOnce({
      id: 'wallet-1',
      companyId: 'company-1',
      walletAddress: '0x' + 'b'.repeat(40)
    })
    updateCompanyWalletMock.mockResolvedValueOnce({
      id: 'wallet-1',
      active: true
    })

    const response = await POST(
      new Request('http://localhost/api/company-wallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
          companyId: 'company-1',
          id: 'wallet-1'
        })
      })
    )
    const body = await response.json()

    expect(deactivateOtherCompanyWalletsMock).toHaveBeenCalledWith('company-1', 'wallet-1')
    expect(updateCompanyFieldsMock).toHaveBeenCalledWith('company-1', { activeWalletId: 'wallet-1' })
    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      item: {
        id: 'wallet-1',
        active: true
      }
    })
  })
})
