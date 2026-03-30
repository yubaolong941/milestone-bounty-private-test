import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

declare global {
  // eslint-disable-next-line no-var
  var __wlfiMysqlPool: Pool | undefined
}

function getDatabaseConfig() {
  const host = process.env.MYSQL_HOST || process.env.DB_HOST
  const port = Number(process.env.MYSQL_PORT || process.env.DB_PORT || '3306')
  const user = process.env.MYSQL_USER || process.env.DB_USER || process.env.DB_USERNAME
  const password = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD
  const database = process.env.MYSQL_DATABASE || process.env.DB_NAME

  if (!host || !user || !password || !database) {
    throw new Error('Missing MySQL configuration. Please set MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE')
  }

  return {
    host,
    port,
    user,
    password,
    database
  }
}

export function hasMysqlConfig() {
  const host = process.env.MYSQL_HOST || process.env.DB_HOST
  const user = process.env.MYSQL_USER || process.env.DB_USER || process.env.DB_USERNAME
  const password = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD
  const database = process.env.MYSQL_DATABASE || process.env.DB_NAME

  return Boolean(host && user && password && database)
}

export function getMysqlPool() {
  if (!global.__wlfiMysqlPool) {
    const config = getDatabaseConfig()
    global.__wlfiMysqlPool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60000,
      queueLimit: 0,
      charset: 'utf8mb4'
    })
  }
  return global.__wlfiMysqlPool
}

export async function queryMysql<T = RowDataPacket[] | ResultSetHeader>(sql: string, params?: unknown[]) {
  const pool = getMysqlPool()
  const [rows] = await pool.query(sql, params)
  return rows as T
}

export async function getMysqlHealth() {
  const pool = getMysqlPool()
  const [rows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS db, NOW() AS now')
  return rows[0]
}
