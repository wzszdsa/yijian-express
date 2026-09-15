import { userFromRequest } from '../_shared/auth.mjs'
import { detectCarrier } from '../_shared/carrier-detect.mjs'
import { bodyOf, internalError, json, methodNotAllowed } from '../_shared/http.mjs'

/**
 * 运单号 → 快递平台识别（只读、不落库）。
 *
 * 需要登录：运单号属于可关联到个人的业务数据，不应对匿名请求开放，
 * 否则等于提供一个公开的单号格式探测端点。
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  try {
    const user = await userFromRequest(request)
    if (!user) return json({ message: '请先登录后再识别运单号', code: 'AUTH_REQUIRED' }, 401)
    const body = await bodyOf(request)
    const trackingNo = typeof body.trackingNo === 'string' ? body.trackingNo : ''
    return json({ detection: detectCarrier(trackingNo) })
  } catch (error) {
    return internalError('parcel:detect-carrier', error)
  }
}
