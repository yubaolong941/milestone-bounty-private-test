'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const platformSignals = [
  {
    title: 'Clear decisions',
    desc: 'AI, reviewer, and finance gates remain explicit and auditable.',
    badge: 'Decisions',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="rgba(10,132,255,0.12)" />
        <path d="M10 16.5L14 20.5L22 12.5" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    title: 'Verifiable payout',
    desc: 'Issue, PR, and payout evidence stay in one ledger trail.',
    badge: 'Evidence',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="rgba(48,209,88,0.12)" />
        <path d="M11 12H21M11 16H18M11 20H15" stroke="#30D158" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  },
  {
    title: 'Role-aware access',
    desc: 'Every action is scoped to the right role, company, and permission.',
    badge: 'Security',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="rgba(191,90,242,0.12)" />
        <path d="M16 10V14M16 14L20 14M16 14L12 14M12 18H20C20.5523 18 21 18.4477 21 19V21C21 21.5523 20.5523 22 20 22H12C11.4477 22 11 21.5523 11 21V19C11 18.4477 11.4477 18 12 18Z" stroke="#BF5AF2" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
]

const routeCards = [
  {
    title: 'Company Team Access',
    href: '/api/auth/github/start?next=/staff',
    cta: 'Continue with GitHub',
    meta: 'GitHub SSO / staff console',
    variant: 'primary' as const
  },
  {
    title: 'Bounty Contributor Access',
    href: '/api/auth/github/start?next=/external',
    cta: 'Enter GitHub Bounty Portal',
    meta: 'claim / submit / payout',
    variant: 'ghost' as const
  }
]

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="github-icon">
      <path
        fill="currentColor"
        d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.39l-.01-1.37c-2.23.49-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82A7.7 7.7 0 0 1 8 4.88c.68 0 1.36.09 2 .28 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.47l-.01 2.18c0 .22.14.47.55.39A8 8 0 0 0 8 0Z"
      />
    </svg>
  )
}

function LoginContent() {
  const [githubLoadingPath, setGithubLoadingPath] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!searchParams) return
    const authError = searchParams.get('auth_error')
    if (!authError) return
    const detail = searchParams.get('auth_detail') || ''
    const errorMap: Record<string, string> = {
      missing_code: 'GitHub login failed: authorization code is missing.',
      state_mismatch: 'GitHub login failed: state verification failed.',
      oauth_not_configured: 'GitHub login failed: OAuth is not configured on server.',
      token_exchange_failed: 'GitHub login failed: could not exchange code for token.',
      missing_access_token: 'GitHub login failed: access token was not returned.',
      load_user_failed: 'GitHub login failed: cannot load GitHub user profile.',
      callback_exception: 'GitHub login failed: callback exception occurred.'
    }
    const base = errorMap[authError] || 'GitHub login failed. Please retry in a moment.'
    if (detail) {
      setMessage(`${base} (${detail})`)
      return
    }
    setMessage(base)
  }, [searchParams])

  const startGitHubLogin = (href: string) => {
    setGithubLoadingPath(href)
    setMessage('')
    window.location.assign(href)
  }

  return (
    <main className="login-stage core-page">
      <div className="login-shell core-shell grid min-h-[calc(100vh-3rem)] overflow-hidden rounded-[20px] border border-white/[0.08] bg-black/30 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Left — Auth */}
        <section className="login-sidebar flex flex-col justify-between px-7 py-8 md:px-10 md:py-10">
          <div className="space-y-12">
            <div className="space-y-8">
              <div className="inline-flex items-center rounded-full border border-white/[0.10] bg-white/[0.06] px-4 py-2 text-xs font-semibold tracking-[0.18em] text-white/70">
                TOMO
              </div>
              <div>
                <h1 className="login-sidebar-title mt-2 max-w-xl text-white/90">
                  Select Role
                </h1>
              </div>
            </div>

            <div className="space-y-5">
              {routeCards.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  disabled={githubLoadingPath !== null}
                  onClick={() => startGitHubLogin(item.href)}
                  className={item.variant === 'primary' ? 'login-route login-route-primary' : 'login-route login-route-secondary'}
                >
                  <div>
                    <p className="text-sm font-semibold text-white/90">{item.title}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="login-route-cta-wrap">
                      <span className="github-icon-badge">
                        <GitHubMark />
                      </span>
                      <span className="login-route-cta">
                      {githubLoadingPath === item.href ? 'Connecting...' : item.cta}
                      </span>
                    </span>
                    <span className="text-[0.625rem] uppercase tracking-wider text-white/30">{item.meta}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="login-entry-proof rounded-xl px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">GitHub SSO</span>
                <span className="chip">Role-Aware Access</span>
                <span className="chip">Audit-Ready</span>
              </div>
            </div>
          </div>
        </section>

        {/* Right — Showcase */}
        <section className="login-showcase relative flex flex-col justify-center border-t border-white/[0.06] px-8 py-10 md:px-12 md:py-14 lg:border-l lg:border-t-0 lg:px-16">
          <div className="relative z-10 mx-auto w-full max-w-lg space-y-10">
            {/* Hero statement */}
            <div className="space-y-4">
              <p className="text-[0.6875rem] font-medium uppercase tracking-[0.2em] text-apple-blue/70">How it works</p>
              <h2 className="text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-tight tracking-tight text-white/90">
                From task to payout,<br />every step auditable.
              </h2>
              <p className="max-w-md text-[0.9375rem] leading-relaxed text-white/40">
                tomo connects delivery, review, and settlement into one verifiable pipeline.
              </p>
            </div>

            {/* Feature cards */}
            <div className="space-y-3">
              {platformSignals.map((signal, index) => (
                <div
                  key={signal.title}
                  className="group flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.05]"
                >
                  <div className="shrink-0 mt-0.5">{signal.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[0.9375rem] font-semibold text-white/90">{signal.title}</p>
                      <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-white/35">
                        {signal.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-white/40">{signal.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom pills */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="core-pill">Issue-linked</span>
              <span className="core-pill">Policy-aware</span>
              <span className="core-pill">Audit-traceable</span>
            </div>
          </div>

          {message && (
            <div className="relative z-10 mx-auto mt-8 w-full max-w-lg rounded-xl border border-apple-red/25 bg-apple-red/10 px-5 py-4 text-sm text-apple-red">
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default function LoginClient() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
