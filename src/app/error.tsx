'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="panel rounded-[20px] p-8">
          <p className="section-title">Application Error</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Something went wrong, but the app is still running</h1>
          <p className="mt-4 text-sm leading-7 subtle">
            This is usually caused by a component error, an unexpected API response, or a temporary hot-reload inconsistency in development. Try reloading first; if it persists, check the browser console and server logs.
          </p>
          <div className="mt-6 rounded-xl border border-apple-red/25 bg-apple-red/10 p-4 text-sm text-apple-red">
            {error.message || 'Unknown error'}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={reset} className="btn-primary">Reload page</button>
            <a href="/staff" className="btn-ghost">Back to console</a>
            <a href="/" className="btn-ghost">Back to home</a>
          </div>
        </div>
      </div>
    </div>
  )
}
