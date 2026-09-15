import { userFromRequest } from '../_shared/auth.mjs'
import { detectCarrier, normalizeTrackingNo, type DetectionResult } from '../_shared/carrier-detect.mjs'
import { bodyOf, internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { KUAIDI100_SUPPORTED_CARRIER_CODES, Kuaidi100InvalidTrackingError, queryTracking } from '../_shared/kuaidi100.mjs'
import { saveParcel } from '../_shared/parcels.mjs'

function normalizeCarrierCode(value: unknown): string | null {
  const carrierCode = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return KUAIDI100_SUPPORTED_CARRIER_CODES.includes(carrierCode) ? carrierCode : null
}

/** 请求体里是否显式提供了平台字段（用于区分"没给"与"给了但不合法"）。 */
function hasCarrierField(body: Record<string, unknown>): boolean {
  return typeof body.carrierCode === 'string' && body.carrierCode.trim() !== ''
}

function rawTrackingNo(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  try {
    const user = await userFromRequest(request)
    if (!user) return json({ message: '请先登录后再查询运单号', code: 'AUTH_REQUIRED' }, 401)
    const body = await bodyOf(request)
    const trackingNo = normalizeTrackingNo(rawTrackingNo(body.trackingNo))
    // 与既有契约一致：仅校验字符集与长度，不在此处做平台判断。
    if (!/^[A-Z0-9-]{4,128}$/.test(trackingNo)) {
      return json({ message: '请输入正确的快递运单号', code: 'INVALID_TRACKING_NO' }, 400)
    }

    // 显式指定了平台就必须合法：传了不支持的编码要明确报错，
    // 而不是把它当作"没传"再走识别，否则用户以为的平台与实际查询的平台会不一致。
    const requestedCarrierCode = normalizeCarrierCode(body.carrierCode)
    if (hasCarrierField(body) && !requestedCarrierCode) {
      return json({ message: '请选择支持的快递平台', code: 'INVALID_CARRIER' }, 400)
    }

    // 人工指定的平台优先：只要在白名单内就直接采用，不做二次猜测。
    let carrierCode = requestedCarrierCode
    let detection: DetectionResult | null = null

    if (!carrierCode) {
      detection = detectCarrier(trackingNo)
      if (!detection.best || detection.best.confidence !== 'high') {
        // 不臆断唯一归属：把候选与依据交回前端，由用户确认后再查询。
        const ambiguous = detection.candidates.length > 0
        return json(
          {
            message: ambiguous ? '该运单号可能属于多个平台，请确认快递平台' : '未能识别该运单号所属平台，请手动选择快递平台',
            code: ambiguous ? 'AMBIGUOUS_CARRIER' : 'INVALID_CARRIER',
            detection,
          },
          400,
        )
      }
      carrierCode = detection.best.carrierCode
    }

    const candidate = { trackingNo, carrierCode }
    const detail = await queryTracking(candidate)
    await saveParcel(user.id, candidate, detail)
    return json({
      parcel: { trackingNo, status: detail.status, carrierCode },
      ...(detection ? { detection } : {}),
      message: detection ? `已识别为${detection.best?.carrierName ?? carrierCode}，物流信息已同步` : '物流信息已同步',
    })
  } catch (error) {
    if (error instanceof Kuaidi100InvalidTrackingError) {
      return json({ message: error.message, code: error.code }, 400)
    }
    return internalError('parcel:tracking-query', error)
  }
}
