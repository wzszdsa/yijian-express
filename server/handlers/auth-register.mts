import { readUserByEmail, saveUser, createPasswordHash, createSession, publicUser, parseAuthBody, verifyOtp, authResponse } from '../_shared/auth.mjs'
import { internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { isUniqueViolation } from '../_shared/storage.mjs'
import { normalizeEmail, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../_shared/security.mjs'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const body = await parseAuthBody(request)
    const email = normalizeEmail(body.email)
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email) return json({ message: '请输入正确的邮箱地址', code: 'INVALID_EMAIL' }, 400)
    if (!/^\d{6}$/.test(code)) return json({ message: '请输入 6 位验证码', code: 'INVALID_OTP' }, 400)
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return json({ message: `请设置 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位登录密码`, code: 'INVALID_PASSWORD' }, 400)
    }
    if (await readUserByEmail(email)) return json({ message: '该邮箱已经注册，请直接登录', code: 'EMAIL_ALREADY_REGISTERED' }, 409)
    if (!await verifyOtp(email, 'register', code)) return json({ message: '验证码错误或已过期，请重新获取验证码', code: 'INVALID_OTP' }, 401)

    const now = new Date().toISOString()
    const user = {
      id: crypto.randomUUID(),
      email,
      ...(password ? { passwordHash: await createPasswordHash(password) } : {}),
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
      passwordSetAt: now,
    }

    try {
      await saveUser(user)
    } catch (error) {
      if (isUniqueViolation(error)) return json({ message: '该邮箱已经注册，请直接登录', code: 'EMAIL_ALREADY_REGISTERED' }, 409)
      throw error
    }

    const session = await createSession(user.id, request)
    return authResponse({ user: publicUser(user) }, session.cookie)
  } catch (error) {
    return internalError('auth:register', error)
  }
}



