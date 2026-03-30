import fs from 'fs'
import path from 'path'
import mysql from 'mysql2/promise'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'))
loadEnvFile(path.join(process.cwd(), '.env'))

const host = process.env.MYSQL_HOST || process.env.DB_HOST
const port = Number(process.env.MYSQL_PORT || process.env.DB_PORT || '3306')
const user = process.env.MYSQL_USER || process.env.DB_USER
const password = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD
const database = process.env.MYSQL_DATABASE || process.env.DB_NAME

if (!host || !user || !password || !database) {
  console.error('Missing MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE')
  process.exit(1)
}

const conn = await mysql.createConnection({ host, port, user, password, database })
const [rows] = await conn.query('SELECT DATABASE() AS db, NOW() AS now')
console.log(JSON.stringify(rows[0], null, 2))
await conn.end()
