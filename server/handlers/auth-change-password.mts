import { currentSessionHash, replaceUserPassword, revokeOtherSessions, userFromRequest, verifyOtp, verifyPassword } from '../_shared/auth.mjs'
import { bodyOf, internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../_shared/security.mjs'

/**
 * 修改登录密码。与 /api/auth/set-password 的区别：
 * - set-password 用于「尚未设置密码」的账号首次设置，不需要验证身份；
 * - change-password 用于已有密码的账号，必须先证明身份。
 *
 * 身份证明有两条路径，二选一：
 * 1. currentPassword —— 记得原密码，最常用；
 * 2. code —— 邮箱验证码（purpose=login），给「忘了原密码但还留着登录态」的用户兜底，
 *    否则这类用户会被永久锁在密码登录之外。
 *
 * 校验顺序刻意安排为「先证明身份、再判断新旧是否相同」：这样身份没通过时永远返回身份类错误，
 * 不会因为新旧字符串相同而产生误导性提示。
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const user = await userFromRequest(request)
    if (!user) return json({ message: '登录状态已失效，请重新登录后再修改密码', code: 'AUTH_REQUIRED' }, 401)
    if (!user.passwordHash) {
      return json({ message: '当前账号还没有登录密码，请先设置密码', code: 'PASSWORD_NOT_SET' }, 409)
    }

    const body = await bodyOf(request)
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (!currentPassword && !code) {
      return json({ message: '请输入当前密码，或使用邮箱验证码验证身份', code: 'CREDENTIAL_REQUIRED' }, 400)
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
      return json({ message: `新密码长度需为 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`, code: 'INVALID_PASSWORD' }, 400)
    }

    if (currentPassword) {
      if (!await verifyPassword(currentPassword, user.passwordHash)) {
        return json({ message: '当前密码不正确，请重新输入', code: 'INVALID_CURRENT_PASSWORD' }, 401)
      }
      if (newPassword === currentPassword) {
        return json({ message: '新密码不能与当前密码相同', code: 'PASSWORD_UNCHANGED' }, 400)
      }
    } else {
      if (!/^\d{6}$/.test(code)) return json({ message: '请输入 6 位验证码', code: 'INVALID_OTP' }, 400)
      if (!await verifyOtp(user.email, 'login', code)) {
        return json({ message: '验证码错误或已过期，请重新获取验证码', code: 'INVALID_VERIFICATION_CODE' }, 401)
      }
      // 走验证码路径时拿不到原密码明文，改用哈希校验判断「新密码是否就是旧密码」
      if (await verifyPassword(newPassword, user.passwordHash)) {
        return json({ message: '新密码不能与当前密码相同', code: 'PASSWORD_UNCHANGED' }, 400)
      }
    }

    const updated = await replaceUserPassword(user.id, newPassword)
    if (!updated) return json({ message: '密码修改失败，请稍后重试', code: 'PASSWORD_UPDATE_FAILED' }, 409)

    // 改密码的语义是「旧凭据可能已泄露」，因此保留本机、让其他设备的会话立即失效。
    // 这一步失败不回滚密码（密码已经改成功了），但必须如实告知用户，不能假装已全部下线。
    let revokedSessions = 0
    let revokeFailed = false
    try {
      revokedSessions = await revokeOtherSessions(user.id, currentSessionHash(request))
    } catch (error) {
      revokeFailed = true
      console.error('[yijian:auth:change-password] 其他会话清理失败', error instanceof Error ? error.message : 'unknown error')
    }

    const message = revokeFailed
      ? '登录密码已更新；其他设备的登录状态未能一并清理，建议在那些设备上手动退出'
      : revokedSessions > 0
        ? `登录密码已更新，其他 ${revokedSessions} 台设备已退出登录`
        : '登录密码已更新，下次登录请使用新密码'

    return json({ message, revokedSessions, revokeFailed })
  } catch (error) {
    return internalError('auth:change-password', error)
  }
}
