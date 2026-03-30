'use client'
import { useCallback, useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
  }, [onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 backdrop-blur-sm overlay-enter" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={onKeyDown}>
      <div ref={dialogRef} tabIndex={-1} className="w-[min(90vw,400px)] rounded-2xl border border-white/[0.08] bg-[#1c1c1e] p-6 shadow-2xl slide-in-right" onClick={e => e.stopPropagation()}>
        <h3 id="confirm-title" className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm subtle">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button onClick={onConfirm} className="btn-primary bg-apple-red">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
