import { hasMysqlConfig } from '@/lib/db'

export type RuntimeDataBackend = 'auto' | 'mysql' | 'file'

export function getRuntimeDataBackend(): RuntimeDataBackend {
  const raw = process.env.RUNTIME_DATA_BACKEND?.trim().toLowerCase()
  if (raw === 'mysql' || raw === 'file' || raw === 'auto') return raw
  return 'auto'
}

export function shouldUseFileStorage(): boolean {
  const backend = getRuntimeDataBackend()
  if (hasMysqlConfig()) return backend === 'file'
  if (backend === 'mysql') return false
  return true
}
