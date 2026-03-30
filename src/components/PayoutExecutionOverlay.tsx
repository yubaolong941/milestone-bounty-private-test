'use client'

interface Props {
  visible: boolean
  title?: string
  detail?: string
}

export default function PayoutExecutionOverlay({
  visible,
  title = 'wlfi-agentic-sdk is processing payout',
  detail = 'Do not close this page. The system is processing the on-chain payout and receipt sync.'
}: Props) {
  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-label="Processing payout"
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 backdrop-blur-xl overlay-enter"
    >
      <div className="w-[min(92vw,32rem)] rounded-[20px] border border-apple-blue/25 bg-[#1c1c1e]/95 p-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-apple-blue/30 bg-apple-blue/10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/[0.10] border-t-apple-blue" />
        </div>
        <p className="mt-6 text-xl font-semibold text-white">{title}</p>
        <p className="mt-3 text-sm leading-6 text-slate-300">{detail}</p>
      </div>
    </div>
  )
}
