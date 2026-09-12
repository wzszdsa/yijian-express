import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'

export const OTP_TTL_MS = 5 * 60 * 1000
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
export const OTP_RESEND_SECONDS = 60
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_PER_HOUR = 5
export const PASSWORD_MIN_LENGTH = 6
export const PASSWORD_MAX_LENGTH = 128

export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

export function createOtpCode(): string {
  return randomInt(100000, 1000000).toString()
}

export function createToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await deriveSecret(secret, salt)
  return `s1:${salt.toString('base64url')}:${derived.toString('base64url')}`
}

export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const [version, saltValue, hashValue] = encoded.split(':')
  if (version !== 's1' || !saltValue || !hashValue) return false
  const salt = Buffer.from(saltValue, 'base64url')
  const expected = Buffer.from(hashValue, 'base64url')
  const actual = await deriveSecret(secret, salt)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function deriveSecret(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}
