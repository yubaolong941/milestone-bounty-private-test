import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireInternalUserMock = vi.fn()
const getTreasuryFundingConfigMock = vi.fn()
const getPlatformPayoutWalletConfigMock = vi.fn()
const inspectPlatformPayoutWalletMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUserMock(...args)
}))

vi.mock('@/lib/treasury-funding', () => ({
  getTreasuryFundingConfig: (...args: unknown[]) => getTreasuryFundingConfigMock(...args)
}))

vi.mock('@/lib/settlement', () => ({
  getPlatformPayoutWalletConfig: (...args: unknown[]) => getPlatformPayoutWalletConfigMock(...args),
  inspectPlatformPayoutWallet: (...args: unknown[]) => inspectPlatformPayoutWalletMock(...args)
}))

import { GET } from '@/app/api/platform/treasury-config/route'

describe('api/platform/treasury-config route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireInternalUserMock.mockReturnValue({ ok: true, session: { userId: 'u-1' } })
    getTreasuryFundingConfigMock.mockReturnValue({
      enabled: true,
      network: 'bsc',
      tokenSymbol: 'USD1',
      tokenDecimals: 18,
      tokenAddress: '0xtoken',
      treasuryAddress: '0xtreasury'
    })
    getPlatformPayoutWalletConfigMock.mockReturnValue({
      enabled: true,
      provider: 'evm_private_key',
      walletAddress: '0xwallet',
      network: 'bsc',
      tokenSymbol: 'USD1',
      tokenAddress: '0xtoken'
    })
    inspectPlatformPayoutWalletMock.mockResolvedValue({
      ok: true,
      health: 'ok'
    })
  })

  it('returns auth response when unauthorized', async () => {
    requireInternalUserMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 })
    })

    const response = await GET(new Request('http://localhost/api/platform/treasury-config'))
    expect(response.status).toBe(401)
  })

  it('returns treasury config and payout wallet health', async () => {
    const response = await GET(new Request('http://localhost/api/platform/treasury-config'))
    const body = await response.json()

    expect(body).toEqual({
      enabled: true,
      network: 'bsc',
      tokenSymbol: 'USD1',
      tokenDecimals: 18,
      tokenAddress: '0xtoken',
      treasuryAddress: '0xtreasury',
      payoutWallet: {
        enabled: true,
        provider: 'evm_private_key',
        walletAddress: '0xwallet',
        network: 'bsc',
        tokenSymbol: 'USD1',
        tokenAddress: '0xtoken',
        health: { ok: true, health: 'ok' }
      }
    })
  })
})
