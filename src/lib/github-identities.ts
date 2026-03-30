export function normalizeGithubLogin(value?: string | null): string | undefined {
  const normalized = String(value || '').trim().replace(/^@/, '').toLowerCase()
  return normalized || undefined
}

export function isBotGithubLogin(value?: string | null): boolean {
  const normalized = normalizeGithubLogin(value)
  return Boolean(normalized && /\[bot\]$/i.test(normalized))
}

export function normalizeHumanGithubLogin(value?: string | null): string | undefined {
  const normalized = normalizeGithubLogin(value)
  if (!normalized || isBotGithubLogin(normalized)) return undefined
  return normalized
}
