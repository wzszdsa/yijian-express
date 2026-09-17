import { userFromRequest } from '../_shared/auth.mjs'
import { carrierDisplayName, detectCarrier, normalizeTrackingNo, type DetectionResult } from '../_shared/carrier-detect.mjs'
import { bodyOf, internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import {
  KUAIDI100_SUPPORTED_CARRIER_CODES,
  Kuaidi100InvalidTrackingError,
  Kuaidi100PhoneRequiredError,
  Kuaidi100UpstreamError,
  normalizeQueryPhone,
  queryTracking,
  requiresQueryPhone,
} from '../_shared/kuaidi100.mjs'
import { readParcelQueryPhone, saveParcel } from '../_shared/parcels.mjs'

/**
 * 上游业务错误码 → 用户可读文案与 HTTP 状态。
 *
 * 这些错误此前统一被 internalError 降级成 503「服务暂时不可用，请稍后重试」，
 * 用户只能反复重试，永远看不到真正原因。这里按「用户能否自己解决」分类：
 * 能自己换平台 / 核对单号的给 400 或 404，属于服务侧问题的给 503。
 */
const UPSTREAM_FAILURES: Record<string, { status: number; code: string; message: string }> = {
  '400': { status: 400, code: 'UPSTREAM_BAD_REQUEST', message: '快递100 未能识别该快递公司，请确认快递平台选择是否正确' },
  '401': { status: 400, code: 'CARRIER_UNSUPPORTED', message: '该快递平台暂不支持查询，请更换平台或稍后再试' },
  '500': { status: 404, code: 'NO_TRACKING_RESULT', message: '暂未查询到该单号的物流信息，请确认运单号与快递平台是否匹配，或稍后再试' },
  '501': { status: 503, code: 'UPSTREAM_ERROR', message: '物流查询服务暂时异常，请稍后重试' },
  '502': { status: 503, code: 'UPSTREAM_BUSY', message: '物流查询服务繁忙，请稍后重试' },
  '503': { status: 503, code: 'UPSTREAM_SIGNATURE', message: '物流查询服务校验失败，请联系管理员' },
  '504': { status: 429, code: 'QUERY_TOO_FREQUENT', message: '查询过于频繁，请稍后再试' },
  '601': { status: 503, code: 'UPSTREAM_QUOTA', message: '物流查询额度已用完，请联系管理员' },
}

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
  // 提到 try 之外：错误分支需要知道当前平台，才能给出「该平台需要手机号」这类精确提示。
  let carrierCode: string | null = null
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

    // 收寄件人电话。区分三态：没给 / 给了但非法 / 合法——前两者不能混为一谈。
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const phone = rawPhone ? normalizeQueryPhone(rawPhone) : null
    if (rawPhone && !phone) {
      return json({ message: '请填写正确的手机号（电商虚拟号请填「-」后四位）', code: 'INVALID_PHONE' }, 400)
    }

    // 人工指定的平台优先：只要在白名单内就直接采用，不做二次猜测。
    carrierCode = requestedCarrierCode
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

    // 中通/顺丰在快递100 是 phone 必填。若该单号此前存过电话就直接复用，用户不必每次重填；
    // 仍缺才提前拦截——而不是把请求发出去等 408 回来：既省一次上游调用（上游对同一单号有查询频率限制），
    // 也让用户直接看到「缺什么」。
    let effectivePhone = phone
    if (requiresQueryPhone(carrierCode) && !effectivePhone) {
      effectivePhone = await readParcelQueryPhone(user.id, trackingNo, carrierCode)
    }
    if (requiresQueryPhone(carrierCode) && !effectivePhone) {
      const { carrierName } = carrierDisplayName(carrierCode)
      return json(
        {
          message: `查询${carrierName}需要填写收件人或寄件人手机号（电商虚拟号请填「-」后四位）`,
          code: 'PHONE_REQUIRED',
          carrierCode,
          ...(detection ? { detection } : {}),
        },
        400,
      )
    }

    const candidate = { trackingNo, carrierCode, ...(effectivePhone ? { phone: effectivePhone } : {}) }
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
    // 408 不能再被吞成 503「服务暂时不可用」——那样用户只能反复重试，永远不知道该去补手机号。
    if (error instanceof Kuaidi100PhoneRequiredError) {
      return json({ message: error.message, code: error.code, ...(carrierCode ? { carrierCode } : {}) }, 400)
    }
    if (error instanceof Kuaidi100UpstreamError) {
      const mapped = UPSTREAM_FAILURES[error.returnCode]
      if (mapped) return json({ message: mapped.message, code: mapped.code }, mapped.status)
      // 未收录的错误码：透出上游原文（是给人看的业务文案），至少比通用「服务不可用」有信息量。
      return json({ message: error.message, code: 'UPSTREAM_ERROR' }, 502)
    }
    return internalError('parcel:tracking-query', error)
  }
}
