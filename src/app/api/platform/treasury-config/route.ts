import { NextResponse } from 'next/server'
import { requireInternalUser } from '@/lib/auth'
import { getTreasuryFundingConfig } from '@/lib/treasury-funding'
import { getPlatformPayoutWalletConfig, inspectPlatformPayoutWallet } from '@/lib/settlement'

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const config = getTreasuryFundingConfig()
  const payoutWallet = getPlatformPayoutWalletConfig()
  const payoutHealth = await inspectPlatformPayoutWallet()
  return NextResponse.json({
    enabled: config.enabled,
    network: config.network,
    tokenSymbol: config.tokenSymbol,
    tokenDecimals: config.tokenDecimals,
    tokenAddress: config.tokenAddress,
    treasuryAddress: config.treasuryAddress,
    payoutWallet: {
      enabled: payoutWallet.enabled,
      provider: payoutWallet.provider,
      walletAddress: payoutWallet.walletAddress,
      network: payoutWallet.network,
      tokenSymbol: payoutWallet.tokenSymbol,
      tokenAddress: payoutWallet.tokenAddress,
      health: payoutHealth
    }
  })
}
