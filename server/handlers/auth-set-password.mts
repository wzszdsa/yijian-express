import { setUserPassword, userFromRequest } from '../_shared/auth.mjs'
import { bodyOf, internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../_shared/security.mjs'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const user = await userFromRequest(request)
    if (!user) return json({ message: '请先登录后再设置密码', code: 'AUTH_REQUIRED' }, 401)
    if (user.passwordHash) return json({ message: '当前账号已经设置过密码，请使用密码登录或验证码登录', code: 'PASSWORD_ALREADY_SET' }, 409)

    const body = await bodyOf(request)
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return json({ message: `密码长度需为 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`, code: 'INVALID_PASSWORD' }, 400)
    }

    const updated = await setUserPassword(user.id, password)
    if (!updated) return json({ message: '密码已设置或账号状态已变化，请刷新后重试', code: 'PASSWORD_ALREADY_SET' }, 409)
    return json({ message: '登录密码设置成功，以后可以直接使用密码登录' })
  } catch (error) {
    return internalError('auth:set-password', error)
  }
}


