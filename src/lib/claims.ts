export function extractRewardFromLabels(labels: string[]): number | null {
  for (const label of labels) {
    const match = label.match(/^bounty:\$?(\d+(?:\.\d+)?)(?:USD1|USDT|U)?$/i)
    if (match) return Number(match[1])
  }
  return null
}

export function extractRewardTokenFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^rewardToken:([A-Za-z0-9_-]+)$/i)
    if (match) return match[1].toUpperCase()
  }
  return null
}

export function extractWalletFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^wallet:(0x[a-fA-F0-9]{6,})$/i)
    if (match) return match[1]
  }
  return null
}

export function extractClaimFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^claim:@?([a-zA-Z0-9-]+)$/i)
    if (match) return match[1].toLowerCase()
  }
  return null
}

export function hasAutoPayoutLabel(labels: string[]): boolean {
  return labels.includes('auto-payout:on')
}

export function upsertLabel(labels: string[], nextLabel: string, matcher: RegExp): string[] {
  const filtered = labels.filter((label) => !matcher.test(label))
  return Array.from(new Set([...filtered, nextLabel]))
}
