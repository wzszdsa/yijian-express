import path from 'node:path'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createPool, type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { env, isProduction } from './config.mjs'

const LOCAL_ROOT = path.resolve(process.cwd(), 'server-data')
const USER_TABLE = 'yijian_users'
const OTP_TABLE = 'yijian_otp_challenges'
const SESSION_TABLE = 'yijian_sessions'

type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null
type StorageProvider = 'mysql' | 'local'

type UserRow = {
  id: string
  email: string
  password_hash: string | null
  email_verified_at: string | null
  created_at: string
  updated_at: string
  password_set_at: string | null
}

type OtpRow = {
  email: string
  purpose: string
  code_hash: string
  sent_at: string
  expires_at: string
  attempts: number
  window_started_at: string
  sent_count: number
  used_at: string | null
}

type SessionRow = {
  token_hash: string
  user_id: string
  expires_at: string
}

type MysqlUserRow = UserRow & RowDataPacket
type MysqlOtpRow = OtpRow & RowDataPacket
type MysqlSessionRow = SessionRow & RowDataPacket

export type StoredUser = {
  id: string
  email: string
  passwordHash?: string
  emailVerifiedAt?: string
  createdAt: string
  updatedAt: string
  passwordSetAt?: string
}

export type StoredOtp = {
  hash: string
  sentAt: number
  expiresAt: number
  attempts: number
  windowStartedAt: number
  sentCount: number
  usedAt?: number
}

export type StoredSession = {
  userId: string
  expiresAt: number
}

let mysqlPoolInstance: Pool | undefined

export function storageProvider(): StorageProvider {
  const configured = (env('STORAGE_PROVIDER', isProduction() ? 'mysql' : 'local') ?? 'local').trim().toLowerCase()
  if (configured === 'mysql' || configured === 'local') return configured
  throw new Error('STORAGE_PROVIDER 仅支持 mysql 或 local')
}

export function usesMysqlStorage(): boolean {
  return storageProvider() === 'mysql'
}

function localFile(key: string): string {
  const encoded = Buffer.from(key, 'utf8').toString('base64url')
  return path.join(LOCAL_ROOT, `${encoded}.json`)
}

export async function readLocalRecord<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(localFile(key), 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeLocalRecord(key: string, data: JsonValue): Promise<void> {
  await mkdir(LOCAL_ROOT, { recursive: true })
  await writeFile(localFile(key), JSON.stringify(data), 'utf8')
}

export async function deleteLocalRecord(key: string): Promise<void> {
  try {
    await unlink(localFile(key))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function getMysqlPool(): Pool {
  if (mysqlPoolInstance) return mysqlPoolInstance

  const connectionUrl = (env('MYSQL_URL') ?? env('DATABASE_URL'))?.trim()
  if (!connectionUrl) throw new Error('MYSQL_URL 或 DATABASE_URL 未配置')

  let parsed: URL
  try {
    parsed = new URL(connectionUrl)
  } catch {
    throw new Error('MYSQL_URL 格式不正确，应为 mysql://用户名:密码@主机:端口/数据库')
  }
  if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mysqls:') {
    throw new Error('MYSQL_URL 必须使用 mysql:// 或 mysqls://')
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  if (!parsed.hostname || !parsed.username || !database) {
    throw new Error('MYSQL_URL 必须包含主机、用户名和数据库名')
  }

  const connectionLimit = Number(env('MYSQL_CONNECTION_LIMIT', '4') ?? '4')
  const sslEnabled = parsed.protocol === 'mysqls:' || env('MYSQL_SSL') === 'true'
  let ssl: object | undefined
  if (sslEnabled) {
    const sslCaPath = env('MYSQL_SSL_CA')?.trim()
    ssl = {
      rejectUnauthorized: env('MYSQL_SSL_REJECT_UNAUTHORIZED', 'true') !== 'false',
      ...(sslCaPath ? { ca: readFileSync(sslCaPath, 'utf8') } : {}),
    }
  }

  mysqlPoolInstance = createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    waitForConnections: true,
    connectionLimit: Number.isFinite(connectionLimit) && connectionLimit > 0 ? connectionLimit : 4,
    queueLimit: 0,
    enableKeepAlive: true,
    dateStrings: true,
    timezone: 'Z',
    ...(ssl ? { ssl } : {}),
  })
  return mysqlPoolInstance
}

function parseDatabaseDate(value: string | Date): number {
  if (value instanceof Date) return value.getTime()
  const text = String(value)
  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

function userFromRow(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    ...(row.password_hash ? { passwordHash: row.password_hash } : {}),
    ...(row.email_verified_at ? { emailVerifiedAt: row.email_verified_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.password_set_at ? { passwordSetAt: row.password_set_at } : {}),
  }
}

function otpFromRow(row: OtpRow): StoredOtp {
  return {
    hash: row.code_hash,
    sentAt: parseDatabaseDate(row.sent_at),
    expiresAt: parseDatabaseDate(row.expires_at),
    attempts: Number(row.attempts),
    windowStartedAt: parseDatabaseDate(row.window_started_at),
    sentCount: Number(row.sent_count),
    ...(row.used_at ? { usedAt: parseDatabaseDate(row.used_at) } : {}),
  }
}

function sessionFromRow(row: SessionRow): StoredSession {
  return { userId: row.user_id, expiresAt: parseDatabaseDate(row.expires_at) }
}

export async function readUserByEmail(email: string): Promise<StoredUser | null> {
  if (storageProvider() === 'local') return readLocalRecord<StoredUser>(`user:email:${email}`)
  const [rows] = await getMysqlPool().query<MysqlUserRow[]>(
    `SELECT id,email,password_hash,email_verified_at,created_at,updated_at,password_set_at
     FROM ${USER_TABLE} WHERE email = ? LIMIT 1`,
    [email],
  )
  return rows[0] ? userFromRow(rows[0]) : null
}

export async function readUserById(id: string): Promise<StoredUser | null> {
  if (storageProvider() === 'local') return readLocalRecord<StoredUser>(`user:id:${id}`)
  const [rows] = await getMysqlPool().query<MysqlUserRow[]>(
    `SELECT id,email,password_hash,email_verified_at,created_at,updated_at,password_set_at
     FROM ${USER_TABLE} WHERE id = ? LIMIT 1`,
    [id],
  )
  return rows[0] ? userFromRow(rows[0]) : null
}

export async function saveUser(user: StoredUser): Promise<void> {
  if (storageProvider() === 'local') {
    await writeLocalRecord(`user:email:${user.email}`, user)
    await writeLocalRecord(`user:id:${user.id}`, user)
    return
  }
  const passwordSetAt = user.passwordSetAt ?? (user.passwordHash ? user.updatedAt : null)
  await getMysqlPool().execute<ResultSetHeader>(
    `INSERT INTO ${USER_TABLE}
      (id,email,password_hash,email_verified_at,created_at,updated_at,password_set_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      user.id,
      user.email,
      user.passwordHash ?? null,
      new Date(user.emailVerifiedAt ?? user.createdAt),
      new Date(user.createdAt),
      new Date(user.updatedAt),
      passwordSetAt ? new Date(passwordSetAt) : null,
    ],
  )
}

export async function setUserPassword(userId: string, passwordHash: string, passwordSetAt: string): Promise<boolean> {
  if (storageProvider() === 'local') {
    const user = await readLocalRecord<StoredUser>(`user:id:${userId}`)
    if (!user || user.passwordHash) return false
    const next = { ...user, passwordHash, passwordSetAt, updatedAt: passwordSetAt }
    await writeLocalRecord(`user:email:${user.email}`, next)
    await writeLocalRecord(`user:id:${user.id}`, next)
    return true
  }
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    `UPDATE ${USER_TABLE}
     SET password_hash = ?, password_set_at = ?, updated_at = ?
     WHERE id = ? AND password_hash IS NULL`,
    [passwordHash, new Date(passwordSetAt), new Date(passwordSetAt), userId],
  )
  return result.affectedRows > 0
}

/**
 * 无条件覆盖已有密码（用于「修改密码」）。
 * 与 setUserPassword 的区别：setUserPassword 只在 password_hash IS NULL 时写入（首次设置），
 * 本函数不做该限制，因此调用方必须已经完成身份校验（原密码或验证码）。
 */
export async function replaceUserPassword(userId: string, passwordHash: string, passwordSetAt: string): Promise<boolean> {
  if (storageProvider() === 'local') {
    const user = await readLocalRecord<StoredUser>(`user:id:${userId}`)
    if (!user) return false
    const next = { ...user, passwordHash, passwordSetAt, updatedAt: passwordSetAt }
    await writeLocalRecord(`user:email:${user.email}`, next)
    await writeLocalRecord(`user:id:${user.id}`, next)
    return true
  }
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    `UPDATE ${USER_TABLE}
     SET password_hash = ?, password_set_at = ?, updated_at = ?
     WHERE id = ?`,
    [passwordHash, new Date(passwordSetAt), new Date(passwordSetAt), userId],
  )
  return result.affectedRows > 0
}

export async function readOtp(email: string, purpose: string): Promise<StoredOtp | null> {
  if (storageProvider() === 'local') return readLocalRecord<StoredOtp>(`otp:${purpose}:${email}`)
  const [rows] = await getMysqlPool().query<MysqlOtpRow[]>(
    `SELECT email,purpose,code_hash,sent_at,expires_at,attempts,window_started_at,sent_count,used_at
     FROM ${OTP_TABLE} WHERE email = ? AND purpose = ? LIMIT 1`,
    [email, purpose],
  )
  return rows[0] ? otpFromRow(rows[0]) : null
}

export async function writeOtp(email: string, purpose: string, record: StoredOtp): Promise<void> {
  if (storageProvider() === 'local') {
    await writeLocalRecord(`otp:${purpose}:${email}`, record)
    return
  }
  await getMysqlPool().execute<ResultSetHeader>(
    `INSERT INTO ${OTP_TABLE}
      (email,purpose,code_hash,sent_at,expires_at,attempts,window_started_at,sent_count,used_at)
     VALUES (?,?,?,?,?,?,?, ?, NULL)
     ON DUPLICATE KEY UPDATE
      code_hash = VALUES(code_hash), sent_at = VALUES(sent_at), expires_at = VALUES(expires_at),
      attempts = VALUES(attempts), window_started_at = VALUES(window_started_at),
      sent_count = VALUES(sent_count), used_at = NULL`,
    [email, purpose, record.hash, new Date(record.sentAt), new Date(record.expiresAt), record.attempts, new Date(record.windowStartedAt), record.sentCount],
  )
}

export async function incrementOtpAttempts(email: string, purpose: string, expectedAttempts: number): Promise<boolean> {
  if (storageProvider() === 'local') {
    const key = `otp:${purpose}:${email}`
    const current = await readLocalRecord<StoredOtp>(key)
    if (!current || current.attempts !== expectedAttempts) return false
    await writeLocalRecord(key, { ...current, attempts: current.attempts + 1 })
    return true
  }
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    `UPDATE ${OTP_TABLE}
     SET attempts = attempts + 1
     WHERE email = ? AND purpose = ? AND attempts = ? AND used_at IS NULL`,
    [email, purpose, expectedAttempts],
  )
  return result.affectedRows > 0
}

export async function consumeOtp(email: string, purpose: string, expectedHash: string): Promise<boolean> {
  if (storageProvider() === 'local') {
    const key = `otp:${purpose}:${email}`
    const current = await readLocalRecord<StoredOtp>(key)
    if (!current || current.hash !== expectedHash || current.usedAt || current.expiresAt <= Date.now()) return false
    await deleteLocalRecord(key)
    return true
  }
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    `UPDATE ${OTP_TABLE}
     SET used_at = UTC_TIMESTAMP(3)
     WHERE email = ? AND purpose = ? AND code_hash = ?
       AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
    [email, purpose, expectedHash],
  )
  return result.affectedRows > 0
}

export async function readSession(tokenHash: string): Promise<StoredSession | null> {
  if (storageProvider() === 'local') return readLocalRecord<StoredSession>(`session:${tokenHash}`)
  const [rows] = await getMysqlPool().query<MysqlSessionRow[]>(
    `SELECT token_hash,user_id,expires_at FROM ${SESSION_TABLE} WHERE token_hash = ? LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ? sessionFromRow(rows[0]) : null
}

export async function writeSession(tokenHash: string, session: StoredSession): Promise<void> {
  if (storageProvider() === 'local') {
    await writeLocalRecord(`session:${tokenHash}`, session)
    return
  }
  await getMysqlPool().execute<ResultSetHeader>(
    `INSERT INTO ${SESSION_TABLE} (token_hash,user_id,expires_at) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), expires_at = VALUES(expires_at)`,
    [tokenHash, session.userId, new Date(session.expiresAt)],
  )
}

export async function deleteSession(tokenHash: string): Promise<void> {
  if (storageProvider() === 'local') {
    await deleteLocalRecord(`session:${tokenHash}`)
    return
  }
  await getMysqlPool().execute<ResultSetHeader>(`DELETE FROM ${SESSION_TABLE} WHERE token_hash = ?`, [tokenHash])
}

/**
 * 清理某个用户的会话（改密码后让其他设备下线）。
 * exceptTokenHash 用于保留当前设备：本地存储需要遍历目录，因为 session 的 key 是 token 哈希，
 * 没有 userId 索引，无法直接定位。
 */
export async function deleteUserSessions(userId: string, exceptTokenHash?: string): Promise<number> {
  if (storageProvider() === 'local') {
    let entries: string[]
    try {
      entries = await readdir(LOCAL_ROOT)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let removed = 0
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      // 文件名是 key 的 base64url，先还原再按前缀筛出会话记录
      const key = Buffer.from(entry.slice(0, -'.json'.length), 'base64url').toString('utf8')
      if (!key.startsWith('session:')) continue
      if (exceptTokenHash && key === `session:${exceptTokenHash}`) continue
      const record = await readLocalRecord<StoredSession>(key)
      if (!record || record.userId !== userId) continue
      await deleteLocalRecord(key)
      removed += 1
    }
    return removed
  }
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    `DELETE FROM ${SESSION_TABLE} WHERE user_id = ?${exceptTokenHash ? ' AND token_hash <> ?' : ''}`,
    exceptTokenHash ? [userId, exceptTokenHash] : [userId],
  )
  return result.affectedRows
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string | number; errno?: number }
  return candidate.code === 'ER_DUP_ENTRY' || candidate.errno === 1062
}

