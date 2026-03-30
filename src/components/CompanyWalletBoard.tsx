'use client'

import { useEffect, useMemo, useState } from 'react'
import { connectBrowserWallet, signWalletMessage } from '@/lib/browser-wallet'
import { useFeedback } from '@/lib/use-feedback'

interface CompanyWallet {
  id: string
  companyName: string
  walletAddress: string
  network: string
  tokenSymbol: string
  active: boolean
  verifiedAt: string
}

interface AuthMeResponse {
  companyContext?: {
    company?: {
      name?: string
    }
  }
}

type FeedbackState =
  | { tone: 'success' | 'warning' | 'danger'; text: string }
  | null

type WizardStep = 1 | 2 | 3

export default function CompanyWalletBoard() {
  const [items, setItems] = useState<CompanyWallet[]>([])
  const [companyName, setCompanyName] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [network, setNetwork] = useState('base')
  const [tokenSymbol, setTokenSymbol] = useState('USD1')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<WizardStep>(1)
  const { feedback, setFeedback, dismiss } = useFeedback<{ tone: 'success' | 'warning' | 'danger'; text: string }>()

  const notifySetupUpdated = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('wlfi:setup-updated'))
  }

  const load = async () => {
    const [walletsRes, meRes] = await Promise.all([
      fetch('/api/company-wallets').catch(() => null),
      fetch('/api/auth/me').catch(() => null)
    ])
    const [walletsData, meData] = await Promise.all([
      walletsRes ? walletsRes.json().catch(() => []) : Promise.resolve([]),
      meRes ? meRes.json().catch(() => ({})) : Promise.resolve({})
    ])
    setItems(Array.isArray(walletsData) ? walletsData : [])
    const nextCompanyName = (meData as AuthMeResponse)?.companyContext?.company?.name || ''
    setCompanyName(nextCompanyName)
  }

  useEffect(() => {
    load()
  }, [])

  const canGoNext = useMemo(() => {
    if (step === 1) return Boolean(companyName.trim())
    if (step === 2) return Boolean(network.trim() && tokenSymbol.trim())
    return true
  }, [companyName, network, step, tokenSymbol])

  const bind = async () => {
    try {
      const payerCompanyName = companyName.trim()
      if (!payerCompanyName) return
      setLoading(true)
      const connection = await connectBrowserWallet('okx')
      setWalletAddress(connection.walletAddress)
      const challengeRes = await fetch('/api/company-wallets/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: payerCompanyName, walletAddress: connection.walletAddress })
      })
      const challenge = await challengeRes.json().catch(() => ({}))
      if (!challengeRes.ok) {
        setFeedback({ tone: 'danger', text: challenge?.error || 'Failed to obtain wallet challenge.' })
        setLoading(false)
        return
      }

      const signature = await signWalletMessage(connection.provider, connection.walletAddress, challenge.message)

      const res = await fetch('/api/company-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bind',
          companyName: payerCompanyName,
          walletAddress: connection.walletAddress,
          network,
          tokenSymbol,
          message: challenge.message,
          signature
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFeedback({ tone: 'danger', text: data?.error || 'Failed to bind company wallet.' })
        setLoading(false)
        return
      }
      setFeedback({ tone: 'success', text: `Wallet ${connection.walletAddress} linked to ${payerCompanyName}.` })
      setWalletAddress('')
      setNetwork('base')
      setTokenSymbol('USD1')
      setStep(1)
      await load()
      notifySetupUpdated()
    } catch (error) {
      setFeedback({ tone: 'warning', text: error instanceof Error ? error.message : 'Wallet signing cancelled or failed.' })
    } finally {
      setLoading(false)
    }
  }

  const activate = async (id: string) => {
    const res = await fetch('/api/company-wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate', id })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFeedback({ tone: 'danger', text: data?.error || 'Failed to switch wallet.' })
      return
    }
    setFeedback({ tone: 'success', text: 'Active payout wallet updated.' })
    await load()
    notifySetupUpdated()
  }

  return (
    <div className="space-y-4">
      <div className="panel rounded-[1.7rem] p-6">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="chip">wallet wizard</span>
              <span className="chip">step {step}/3</span>
              <span className="chip">{items.length} wallets</span>
            </div>
            <div>
              <p className="section-title">Payout Setup</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Confirm the payer entity before completing wallet binding and signing</h2>
              <p className="mt-2 text-sm leading-6 subtle">
                This step is not just entering an address. It clarifies which company is paying, on which chain, and which token will be used for settlement.
              </p>
            </div>
            <div className="space-y-3">
              {[
                ['1', 'Payer Entity', 'Confirm which company this wallet belongs to.'],
                ['2', 'Settlement Environment', 'Select the network and settlement token.'],
                ['3', 'Connect & Sign', 'Complete address ownership verification with your browser wallet.']
              ].map(([num, title, desc], index) => (
                <div key={title} className="rounded-xl border border-white/[0.08] bg-white/[0.05] p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${step > index ? 'bg-white text-slate-950' : 'bg-white/10 text-white'}`}>{num}</div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 subtle">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="command-card space-y-4">
            {step === 1 && (
              <div>
                <label htmlFor="field-company-name" className="label">Company Name</label>
                <input
                  id="field-company-name"
                  className="input mt-2"
                  value={companyName}
                  readOnly
                  disabled
                  placeholder="No active company selected"
                />
                <p className="mt-2 text-xs subtle">
                  Wallet binding uses the current active company context and cannot be edited here.
                </p>
              </div>
            )}
            {step === 2 && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="field-network" className="label">Network</label>
                  <input id="field-network" className="input mt-2" value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Network, e.g. bsc" />
                </div>
                <div>
                  <label htmlFor="field-token-symbol" className="label">Token Symbol</label>
                  <input id="field-token-symbol" className="input mt-2" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)} placeholder="Settlement token, e.g. USD1" />
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.05] p-4 text-sm subtle">
                <p>Payer: {companyName || '(not set)'}</p>
                <p>Network: {network || '-'}</p>
                <p>Token: {tokenSymbol || '-'}</p>
                <p className="mt-3">Clicking below will open your browser wallet, generate a challenge, and use a signature to prove that the address belongs to this company.</p>
                {walletAddress && <p className="mt-3 break-all">Last connected address: {walletAddress}</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {step > 1 && <button onClick={() => setStep((prev) => (prev === 3 ? 2 : 1))} className="btn-ghost">Back</button>}
              {step < 3 ? (
                <button onClick={() => setStep((prev) => (prev === 1 ? 2 : 3))} className="btn-primary" disabled={!canGoNext}>Next</button>
              ) : (
                <button onClick={bind} disabled={loading || !canGoNext} className="btn-primary">
                  {loading ? 'Connecting & signing...' : 'Connect OKX / browser wallet'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div aria-live="polite" role="status" className={`feedback-banner feedback-${feedback.tone}`}>
          <div className="text-sm text-white">{feedback.text}</div>
          <button onClick={dismiss} className="btn-ghost px-4 py-2 text-xs">Dismiss</button>
        </div>
      )}

      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="panel rounded-2xl p-10 text-center subtle">No company wallets configured</div>
        ) : items.map((item) => (
          <div key={item.id} className="panel rounded-2xl p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-white">{item.companyName}</p>
                  {item.active && <span className="chip">Active</span>}
                </div>
                <p className="mt-2 break-all text-sm subtle">{item.walletAddress}</p>
                <p className="mt-1 text-xs subtle">{item.network} / {item.tokenSymbol} / Verified {new Date(item.verifiedAt).toLocaleString('en-US')}</p>
              </div>
              {!item.active && <button onClick={() => activate(item.id)} className="btn-ghost">Set as active payout wallet</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
