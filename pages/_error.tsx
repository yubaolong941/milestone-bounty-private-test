import type { NextPageContext } from 'next'

type ErrorPageProps = {
  statusCode?: number
}

function ErrorPage({ statusCode }: ErrorPageProps) {
  const title = statusCode ? `Request failed (${statusCode})` : 'Application temporarily unavailable'

  return (
    <main className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="panel rounded-[20px] p-8">
          <p className="section-title">Fallback Error</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">{title}</h1>
          <p className="mt-4 text-sm leading-7 subtle">
            This is the Next.js Pages Router fallback error page, ensuring a usable error exit is always available during build and startup.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/login" className="btn-primary">Back to login</a>
            <a href="/" className="btn-ghost">Back to home</a>
          </div>
        </div>
      </div>
    </main>
  )
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode || err?.statusCode || 500
  return { statusCode }
}

export default ErrorPage
