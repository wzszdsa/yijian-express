import { createSession, parseAuthBody, publicUser, readUserByEmail, verifyOtp, verifyPassword, authResponse } from '../_shared/auth.mjs'
import { internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { normalizeEmail, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../_shared/security.mjs'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const body = await parseAuthBody(request)
    const email = normalizeEmail(body.email)
    const modeValue = typeof body.mode === 'string' ? body.mode : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email) return json({ message: '请输入正确的邮箱地址', code: 'INVALID_EMAIL' }, 400)
    if (modeValue !== 'code' && modeValue !== 'password') return json({ message: '登录方式不正确，请刷新页面后重试', code: 'INVALID_MODE' }, 400)
    if (modeValue === 'code' && !/^\d{6}$/.test(code)) return json({ message: '请输入 6 位验证码', code: 'INVALID_OTP' }, 400)
    if (modeValue === 'password' && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
      return json({ message: `密码长度需为 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`, code: 'INVALID_PASSWORD' }, 400)
    }

    const user = await readUserByEmail(email)
    if (!user) return json({ message: '该邮箱尚未注册，请先注册账号', code: 'EMAIL_NOT_REGISTERED' }, 404)

    if (modeValue === 'password' && !user.passwordHash) return json({ message: '该账号尚未设置登录密码，请改用邮箱验证码登录', code: 'PASSWORD_NOT_SET' }, 409)
    const valid = modeValue === 'password' ? await verifyPassword(password, user.passwordHash) : await verifyOtp(email, 'login', code)
    if (!valid) return json({ message: modeValue === 'password' ? '邮箱或密码错误，请检查后重试' : '验证码错误或已过期，请重新获取验证码', code: 'AUTH_FAILED' }, 401)

    const session = await createSession(user.id, request)
    return authResponse({ user: publicUser(user) }, session.cookie)
  } catch (error) {
    return internalError('auth:login', error)
  }
}



