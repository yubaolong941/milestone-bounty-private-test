#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SQL_DIR = path.join(ROOT_DIR, 'sql')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function readMigrationFiles() {
  return fs
    .readdirSync(SQL_DIR)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b))
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function getDbConfig() {
  loadEnv(path.join(ROOT_DIR, '.env.local'))
  loadEnv(path.join(ROOT_DIR, '.env'))

  const host = process.env.MYSQL_HOST || process.env.DB_HOST
  const port = Number(process.env.MYSQL_PORT || process.env.DB_PORT || '3306')
  const user = process.env.MYSQL_USER || process.env.DB_USER
  const password = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD
  const database = process.env.MYSQL_DATABASE || process.env.DB_NAME

  if (!host || !user || !password || !database) {
    throw new Error('Missing MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE')
  }
  return { host, port, user, password, database }
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_schema_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

async function loadAppliedMigrations(pool) {
  const [rows] = await pool.query(
    'SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY id ASC'
  )
  const map = new Map()
  for (const row of rows) {
    map.set(String(row.filename), {
      checksum: String(row.checksum),
      appliedAt: String(row.applied_at)
    })
  }
  return map
}

async function run() {
  const mode = process.argv.includes('--status') ? 'status' : 'migrate'
  const dbConfig = getDbConfig()
  const pool = await mysql.createPool({
    ...dbConfig,
    multipleStatements: true,
    charset: 'utf8mb4',
    connectionLimit: 2
  })

  try {
    await ensureMigrationsTable(pool)
    const applied = await loadAppliedMigrations(pool)
    const files = readMigrationFiles()
    const pending = []

    for (const filename of files) {
      const sql = fs.readFileSync(path.join(SQL_DIR, filename), 'utf8')
      const checksum = sha256(sql)
      const existing = applied.get(filename)
      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Checksum mismatch for applied migration ${filename}`)
        }
        continue
      }
      pending.push({ filename, sql, checksum })
    }

    if (mode === 'status') {
      const status = {
        success: true,
        applied: files.length - pending.length,
        pending: pending.length,
        files,
        pendingFiles: pending.map((item) => item.filename)
      }
      console.log(JSON.stringify(status, null, 2))
      return
    }

    for (const item of pending) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        await conn.query(item.sql)
        await conn.query(
          'INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES (?, ?, NOW(3))',
          [item.filename, item.checksum]
        )
        await conn.commit()
        console.log(`[db-migrate] applied ${item.filename}`)
      } catch (error) {
        await conn.rollback()
        throw error
      } finally {
        conn.release()
      }
    }

    console.log(JSON.stringify({
      success: true,
      appliedCount: pending.length,
      appliedFiles: pending.map((item) => item.filename)
    }))
  } finally {
    await pool.end()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
