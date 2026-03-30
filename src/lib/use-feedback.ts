import { useCallback, useEffect, useRef, useState } from 'react'

export type FeedbackTone = 'success' | 'warning' | 'danger'

/**
 * Generic feedback state hook with auto-dismiss for success messages.
 * Works with any shape that has a `tone` field.
 */
export function useFeedback<T extends { tone: FeedbackTone }>(autoDismissMs = 5000) {
  const [feedback, setFeedbackRaw] = useState<T | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const setFeedback = useCallback((next: T | null) => {
    clearTimer()
    setFeedbackRaw(next)
    if (next?.tone === 'success') {
      timerRef.current = setTimeout(() => setFeedbackRaw(null), autoDismissMs)
    }
  }, [autoDismissMs, clearTimer])

  const dismiss = useCallback(() => {
    clearTimer()
    setFeedbackRaw(null)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  return { feedback, setFeedback, dismiss }
}
