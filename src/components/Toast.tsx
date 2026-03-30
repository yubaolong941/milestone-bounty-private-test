'use client'
import { useCallback, useEffect, useState } from 'react'

type ToastItem = { id: string; tone: 'success' | 'warning' | 'danger' | 'info'; message: string }
let addToastGlobal: ((toast: Omit<ToastItem, 'id'>) => void) | null = null

export function showToast(tone: ToastItem['tone'], message: string) {
  addToastGlobal?.({ tone, message })
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...toast, id }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  useEffect(() => { addToastGlobal = addToast; return () => { addToastGlobal = null } }, [addToast])

  if (toasts.length === 0) return null

  const toneStyles = {
    success: 'border-apple-green/30 bg-apple-green/10 text-apple-green',
    warning: 'border-apple-orange/30 bg-apple-orange/10 text-apple-orange',
    danger: 'border-apple-red/30 bg-apple-red/10 text-apple-red',
    info: 'border-apple-blue/30 bg-apple-blue/10 text-apple-blue'
  }

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2" aria-live="polite">
      {toasts.map(toast => (
        <div key={toast.id} className={`rounded-xl border px-4 py-3 text-sm font-medium backdrop-blur-lg shadow-lg overlay-enter ${toneStyles[toast.tone]}`}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}
