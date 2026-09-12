import { userFromRequest } from '../_shared/auth.mjs'
import { bodyOf, internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { queryTracking, recognizeTrackingNo } from '../_shared/kuaidi100.mjs'
import { saveParcel } from '../_shared/parcels.mjs'

function normalizeTrackingNo(value: unknown): string | null {
  const trackingNo = typeof value === 'string' ? value.trim().replace(/\s/g, '') : ''
  return /^[A-Za-z0-9-]{4,128}$/.test(trackingNo) ? trackingNo : null
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  try {
    const user = await userFromRequest(request)
    if (!user) return json({ message: '请先登录后再查询运单号', code: 'AUTH_REQUIRED' }, 401)
    const trackingNo = normalizeTrackingNo((await bodyOf(request)).trackingNo)
    if (!trackingNo) return json({ message: '请输入正确的快递运单号', code: 'INVALID_TRACKING_NO' }, 400)

    const candidates = await recognizeTrackingNo(trackingNo)
    let lastError: unknown
    for (const candidate of candidates) {
      try {
        const detail = await queryTracking(candidate)
        await saveParcel(user.id, candidate, detail)
        return json({ parcel: { trackingNo, status: detail.status }, message: '物流信息已同步' })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error('暂时无法查询该运单')
  } catch (error) {
    return internalError('parcel:tracking-query', error)
  }
}


