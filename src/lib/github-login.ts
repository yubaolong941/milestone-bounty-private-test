export type GitHubLoginConfig = {
  clientId: string
  clientSecret: string
}

function trimEnv(name: string) {
  return (process.env[name] || '').trim()
}

export function resolveGitHubLoginConfig(): GitHubLoginConfig | null {
  const loginClientId = trimEnv('GITHUB_LOGIN_CLIENT_ID')
  const loginClientSecret = trimEnv('GITHUB_LOGIN_CLIENT_SECRET')

  if (loginClientId && loginClientSecret) {
    return {
      clientId: loginClientId,
      clientSecret: loginClientSecret
    }
  }

  const legacyClientId = trimEnv('GITHUB_CLIENT_ID')
  const legacyClientSecret = trimEnv('GITHUB_CLIENT_SECRET')
  if (legacyClientId && legacyClientSecret && !legacyClientId.startsWith('Iv')) {
    return {
      clientId: legacyClientId,
      clientSecret: legacyClientSecret
    }
  }

  return null
}

export function getGitHubLoginConfigErrorDetail() {
  const loginClientId = trimEnv('GITHUB_LOGIN_CLIENT_ID')
  const loginClientSecret = trimEnv('GITHUB_LOGIN_CLIENT_SECRET')
  const legacyClientId = trimEnv('GITHUB_CLIENT_ID')
  const legacyClientSecret = trimEnv('GITHUB_CLIENT_SECRET')

  if (loginClientId && !loginClientSecret) {
    return 'GITHUB_LOGIN_CLIENT_SECRET is missing. Configure the OAuth App credentials used for GitHub user login.'
  }
  if (!loginClientId && loginClientSecret) {
    return 'GITHUB_LOGIN_CLIENT_ID is missing. Configure the OAuth App credentials used for GitHub user login.'
  }
  if (legacyClientId.startsWith('Iv')) {
    return 'GITHUB_CLIENT_ID currently points to a GitHub App (Iv...). Configure GITHUB_LOGIN_CLIENT_ID and GITHUB_LOGIN_CLIENT_SECRET for user login, and keep GITHUB_APP_* for repository installation.'
  }
  if (legacyClientId && !legacyClientSecret) {
    return 'GITHUB_CLIENT_SECRET is missing for the legacy OAuth login configuration.'
  }
  if (!legacyClientId && legacyClientSecret) {
    return 'GITHUB_CLIENT_ID is missing for the legacy OAuth login configuration.'
  }

  return 'Configure GITHUB_LOGIN_CLIENT_ID and GITHUB_LOGIN_CLIENT_SECRET for GitHub user login. Keep GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_PRIVATE_KEY_BASE64 for the GitHub App installation flow.'
}
