import { destroySession } from '../_shared/auth.mjs'
import { clearSessionCookie, json, methodNotAllowed } from '../_shared/http.mjs'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const cookie = await destroySession(request)
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  } catch (error) {
    console.error('[yijian:auth:logout]', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, message: '退出登录未完全完成，请稍后重试', code: 'LOGOUT_PARTIAL' }, 503, { 'set-cookie': clearSessionCookie(request) })
  }
}



