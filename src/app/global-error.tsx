'use client'

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="app-shell text-gray-100 min-h-screen">
        <div className="min-h-screen px-6 py-10 md:px-10">
          <div className="mx-auto max-w-3xl">
            <div className="panel rounded-[20px] p-8">
              <p className="section-title">Global Error</p>
              <h1 className="mt-3 text-3xl font-semibold text-white">The application encountered an error on startup</h1>
              <p className="mt-4 text-sm leading-7 subtle">
                This usually means the root layout, route tree, or dev build artifacts are temporarily incomplete. Try once; if it persists, restart the dev server.
              </p>
              <div className="mt-6 rounded-xl border border-apple-red/25 bg-apple-red/10 p-4 text-sm text-apple-red">
                {error.message || 'Unknown error'}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={reset} className="btn-primary">Retry</button>
                <a href="/" className="btn-ghost">Back to home</a>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
