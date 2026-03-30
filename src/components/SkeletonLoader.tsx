'use client'
export function SkeletonLoader({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded-lg bg-white/[0.06]" style={{ width: `${85 - i * 10}%` }} />
      ))}
    </div>
  )
}
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`panel rounded-2xl p-6 animate-pulse ${className}`}>
      <div className="h-3 w-24 rounded bg-white/[0.06] mb-4" />
      <div className="h-8 w-32 rounded bg-white/[0.06] mb-3" />
      <div className="space-y-2">
        <div className="h-3 rounded bg-white/[0.06]" style={{ width: '90%' }} />
        <div className="h-3 rounded bg-white/[0.06]" style={{ width: '70%' }} />
      </div>
    </div>
  )
}
