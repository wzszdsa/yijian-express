import { consumeOtp, deleteSession, incrementOtpAttempts, readOtp, readSession, readUserByEmail as readStoredUserByEmail, readUserById as readStoredUserById, saveUser as saveStoredUser, setUserPassword as setStoredUserPassword, writeSession, type StoredOtp, type StoredSession, type StoredUser } from './storage.mjs'
import { bodyOf, clearSessionCookie, cookieValue, json, sessionCookie } from './http.mjs'
import { createToken, hashSecret, hashToken, OTP_MAX_ATTEMPTS, SESSION_TTL_SECONDS, verifySecret } from './security.mjs'

export type AuthPurpose = 'login' | 'register'
export type UserRecord = StoredUser
export type OtpRecord = StoredOtp
export type SessionRecord = StoredSession

export async function readUserByEmail(email: string): Promise<UserRecord | null> {
  return readStoredUserByEmail(email)
}

export async function readUserById(id: string): Promise<UserRecord | null> {
  return readStoredUserById(id)
}

export async function saveUser(user: UserRecord): Promise<void> {
  return saveStoredUser(user)
}

export async function createPasswordHash(password: string): Promise<string> {
  return hashSecret(password)
}

export async function verifyPassword(password: string, passwordHash?: string): Promise<boolean> {
  return Boolean(passwordHash && await verifySecret(password, passwordHash))
}

export async function setUserPassword(userId: string, password: string): Promise<boolean> {
  return setStoredUserPassword(userId, await createPasswordHash(password), new Date().toISOString())
}

export function publicUser(user: UserRecord): Record<string, unknown> {
  return { id: user.id, email: user.email, createdAt: user.createdAt, passwordSet: Boolean(user.passwordHash) }
}

export async function createSession(userId: string, request: Request): Promise<{ token: string; cookie: string }> {
  const token = createToken()
  await writeSession(hashToken(token), { userId, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 })
  return { token, cookie: sessionCookie(token, request) }
}

export async function userFromRequest(request: Request): Promise<UserRecord | null> {
  const token = cookieValue(request, 'yijian_session')
  if (!token) return null
  const key = hashToken(token)
  const session = await readSession(key)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    await deleteSession(key)
    return null
  }
  const user = await readUserById(session.userId)
  if (!user) {
    await deleteSession(key)
    return null
  }
  return user
}

export async function destroySession(request: Request): Promise<string> {
  const token = cookieValue(request, 'yijian_session')
  if (token) await deleteSession(hashToken(token))
  return clearSessionCookie(request)
}

export function otpKey(email: string, purpose: AuthPurpose): string {
  return `otp:${purpose}:${email}`
}

export async function verifyOtp(email: string, purpose: AuthPurpose, code: string): Promise<boolean> {
  const record = await readOtp(email, purpose)
  if (!record || record.usedAt || record.expiresAt <= Date.now() || record.attempts >= OTP_MAX_ATTEMPTS) return false
  const valid = await verifySecret(code, record.hash)
  if (!valid) {
    await incrementOtpAttempts(email, purpose, record.attempts)
    return false
  }
  return consumeOtp(email, purpose, record.hash)
}

export async function parseAuthBody(request: Request): Promise<Record<string, unknown>> {
  return bodyOf(request)
}

export function authResponse(data: Record<string, unknown>, tokenCookie?: string): Response {
  return json(data, 200, tokenCookie ? { 'set-cookie': tokenCookie } : undefined)
}
