import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const poolState = vi.hoisted(() => ({
  query: vi.fn()
}))

const createPoolMock = vi.hoisted(() => vi.fn(() => ({
  query: poolState.query
})))

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: createPoolMock
  },
  createPool: createPoolMock
}))

import { getMysqlHealth, getMysqlPool, hasMysqlConfig, queryMysql } from '@/lib/db'

describe('db helpers', () => {
  const envKeys = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    global.__wlfiMysqlPool = undefined
    for (const key of envKeys) saved[key] = process.env[key]
    delete process.env.MYSQL_HOST
    delete process.env.MYSQL_PORT
    delete process.env.MYSQL_USER
    delete process.env.MYSQL_PASSWORD
    delete process.env.MYSQL_DATABASE
    delete process.env.DB_HOST
    delete process.env.DB_USER
    delete process.env.DB_PASSWORD
    delete process.env.DB_NAME
  })

  afterEach(() => {
    global.__wlfiMysqlPool = undefined
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('detects whether mysql env config is present', () => {
    expect(hasMysqlConfig()).toBe(false)

    process.env.MYSQL_HOST = 'localhost'
    process.env.MYSQL_USER = 'root'
    process.env.MYSQL_PASSWORD = 'secret'
    process.env.MYSQL_DATABASE = 'wlfi'

    expect(hasMysqlConfig()).toBe(true)
  })

  it('creates and caches a mysql pool using env config', () => {
    process.env.MYSQL_HOST = 'localhost'
    process.env.MYSQL_PORT = '3307'
    process.env.MYSQL_USER = 'root'
    process.env.MYSQL_PASSWORD = 'secret'
    process.env.MYSQL_DATABASE = 'wlfi'

    const first = getMysqlPool()
    const second = getMysqlPool()

    expect(first).toBe(second)
    expect(createPoolMock).toHaveBeenCalledTimes(1)
    expect(createPoolMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'localhost',
      port: 3307,
      user: 'root',
      password: 'secret',
      database: 'wlfi',
      waitForConnections: true
    }))
  })

  it('delegates queryMysql and getMysqlHealth to the pooled connection', async () => {
    process.env.MYSQL_HOST = 'localhost'
    process.env.MYSQL_USER = 'root'
    process.env.MYSQL_PASSWORD = 'secret'
    process.env.MYSQL_DATABASE = 'wlfi'
    poolState.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([[{ db: 'wlfi', now: '2026-03-29 00:00:00' }]])

    await expect(queryMysql('SELECT 1')).resolves.toEqual([{ id: 1 }])
    await expect(getMysqlHealth()).resolves.toEqual({ db: 'wlfi', now: '2026-03-29 00:00:00' })
  })

  it('throws a helpful error when required config is missing', () => {
    expect(() => getMysqlPool()).toThrow('Missing MySQL configuration')
  })
})
