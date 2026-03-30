export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  isOkxWallet?: boolean
}

type WindowWithWallets = Window & typeof globalThis & {
  ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] }
  okxwallet?: Eip1193Provider
}

export function listAvailableWalletProviders() {
  if (typeof window === 'undefined') return []

  const runtime = window as WindowWithWallets
  const providers: Array<{ id: 'okx' | 'injected'; label: string; provider: Eip1193Provider }> = []

  if (runtime.okxwallet?.request) {
    providers.push({ id: 'okx', label: 'OKX Wallet', provider: runtime.okxwallet })
  }

  const injectedProviders = runtime.ethereum?.providers?.filter((provider) => provider?.request) || []
  for (const provider of injectedProviders) {
    const id = provider.isOkxWallet ? 'okx' : 'injected'
    const label = provider.isOkxWallet ? 'OKX Wallet' : 'Browser Wallet'
    if (!providers.some((item) => item.provider === provider || item.id === id)) {
      providers.push({ id, label, provider })
    }
  }

  if (runtime.ethereum?.request && !providers.some((item) => item.provider === runtime.ethereum)) {
    providers.push({
      id: runtime.ethereum.isOkxWallet ? 'okx' : 'injected',
      label: runtime.ethereum.isOkxWallet ? 'OKX Wallet' : 'Browser Wallet',
      provider: runtime.ethereum
    })
  }

  return providers
}

export async function connectBrowserWallet(preferred: 'okx' | 'injected' = 'okx') {
  const providers = listAvailableWalletProviders()
  const selected = providers.find((item) => item.id === preferred) || providers[0]
  if (!selected) {
    throw new Error('No compatible wallet extension detected. Please install and unlock OKX Wallet or a compatible EVM wallet extension.')
  }

  const accounts = await selected.provider.request({ method: 'eth_requestAccounts' })
  const walletAddress = Array.isArray(accounts) ? String(accounts[0] || '') : ''
  if (!walletAddress) {
    throw new Error('The wallet did not return any usable accounts. Please unlock your wallet extension and select an account first.')
  }

  return {
    providerId: selected.id,
    providerLabel: selected.label,
    provider: selected.provider,
    walletAddress
  }
}

export async function signWalletMessage(provider: Eip1193Provider, walletAddress: string, message: string) {
  try {
    return await provider.request({
      method: 'personal_sign',
      params: [message, walletAddress]
    })
  } catch {
    return await provider.request({
      method: 'personal_sign',
      params: [walletAddress, message]
    })
  }
}

export async function switchEvmChain(provider: Eip1193Provider, chainIdHex: string) {
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: chainIdHex }]
  })
}
