import { env } from '../_shared/config.mjs'
import { readOtp, readUserByEmail, writeOtp, type StoredOtp } from '../_shared/storage.mjs'
import { bodyOf, clientIp, exposeDemoCode, internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { hashSecret, createOtpCode, normalizeEmail, OTP_MAX_PER_HOUR, OTP_RESEND_SECONDS, OTP_TTL_MS } from '../_shared/security.mjs'
import type { AuthPurpose } from '../_shared/auth.mjs'
import { sendVerificationEmail } from '../_shared/email.mjs'

const HOUR_MS = 60 * 60 * 1000

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const body = await bodyOf(request)
    const email = normalizeEmail(body.email)
    const purposeValue = typeof body.purpose === 'string' ? body.purpose : ''
    if (!email) return json({ message: '请输入正确的邮箱地址', code: 'INVALID_EMAIL' }, 400)
    if (purposeValue !== 'login' && purposeValue !== 'register') return json({ message: '验证码用途不正确，请刷新页面后重试', code: 'INVALID_PURPOSE' }, 400)
    const purpose: AuthPurpose = purposeValue

    const existingUser = await readUserByEmail(email)
    if (purpose === 'login' && !existingUser) {
      return json({ message: '该邮箱尚未注册，无法发送验证码，请先注册', code: 'EMAIL_NOT_REGISTERED' }, 404)
    }
    if (purpose === 'register' && existingUser) {
      return json({ message: '该邮箱已经注册，已为你切换到登录', code: 'EMAIL_ALREADY_REGISTERED' }, 409)
    }

    const previous = await readOtp(email, purpose)
    const now = Date.now()
    if (previous && now - previous.sentAt < OTP_RESEND_SECONDS * 1000) {
      const retryAfter = Math.ceil((previous.sentAt + OTP_RESEND_SECONDS * 1000 - now) / 1000)
      return json({ message: `验证码发送过于频繁，请 ${retryAfter} 秒后再试`, code: 'OTP_TOO_FREQUENT', retryAfter }, 429, { 'retry-after': String(retryAfter) })
    }

    const windowStartedAt = previous && now - previous.windowStartedAt < HOUR_MS ? previous.windowStartedAt : now
    const sentCount = previous && windowStartedAt === previous.windowStartedAt ? previous.sentCount : 0
    if (sentCount >= OTP_MAX_PER_HOUR) {
      const retryAfter = Math.max(1, Math.ceil((windowStartedAt + HOUR_MS - now) / 1000))
      return json({ message: '验证码发送次数已达上限，请稍后再试', code: 'OTP_RATE_LIMITED', retryAfter }, 429, { 'retry-after': String(retryAfter) })
    }

    const code = createOtpCode()
    await sendVerificationEmail(email, code)
    await writeOtp(email, purpose, {
      hash: await hashSecret(code),
      sentAt: now,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      windowStartedAt,
      sentCount: sentCount + 1,
    } satisfies StoredOtp)

    const response: Record<string, unknown> = { message: '验证码已发送，5 分钟内有效', retryAfter: OTP_RESEND_SECONDS }
    if (exposeDemoCode()) response.demoCode = code
    return json(response)
  } catch (error) {
    console.error('[yijian:auth:send-code]', { ip: clientIp(request), error: error instanceof Error ? error.message : 'unknown error', provider: env('EMAIL_PROVIDER', 'console') })
    return internalError('auth:send-code', error)
  }
}



