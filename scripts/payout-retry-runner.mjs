const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
const secret = process.env.PAYOUT_RETRY_CRON_SECRET || ''
const limit = Number(process.env.PAYOUT_RETRY_LIMIT || process.argv[2] || 10)

async function main() {
  const res = await fetch(`${baseUrl}/api/internal/payout-retries`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-payout-retry-secret': secret } : {})
    },
    body: JSON.stringify({ limit })
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Payout retry runner failed.')
    console.error(JSON.stringify(data, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify(data, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
