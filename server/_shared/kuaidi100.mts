import { createHash } from 'node:crypto'
import { env } from './config.mjs'

export type Kuaidi100TrackingCandidate = {
  trackingNo: string
  carrierCode?: string
  carrierName?: string
  /**
   * 收、寄件人的电话号码。快递100 官方文档明确「顺丰速运、顺丰快运、中通快递」为**必填**，
   * 其他承运商选填。缺该参数时上游返回 408「快递公司参数异常：验证码错误」。
   */
  phone?: string
  initialTraces?: Kuaidi100Trace[]
}

export type Kuaidi100Trace = {
  occurredAt?: string
  title: string
  description: string
  location?: string
  latitude?: number
  longitude?: number
}

export type Kuaidi100TrackingDetail = {
  carrierCode?: string
  carrierName?: string
  status: string
  statusDetail?: string
  location?: string
  eta?: string
  latitude?: number
  longitude?: number
  traces: Kuaidi100Trace[]
}

export type Kuaidi100Pickup = {
  code?: string
  location?: string
}

export const KUAIDI100_SUPPORTED_CARRIER_CODES: readonly string[] = ['shunfeng', 'jd', 'zto', 'yto', 'yunda', 'sto', 'jtexpress', 'deppon', 'ems', 'best', 'youshunda', 'anep', 'china_post', 'zjs']

/**
 * 快递100 要求必填 phone 的承运商编码。
 * 依据官方《实时快递查询接口》文档：phone 字段「顺丰速运、顺丰快运、中通快递必填，其他快递公司选填」；
 * 错误码表 408 =「快递公司参数异常：验证码错误 —— 电话号码校验不通过」。
 * 本项目顺丰速运与顺丰快运共用 shunfeng 编码。
 */
export const KUAIDI100_PHONE_REQUIRED_CARRIER_CODES: readonly string[] = ['shunfeng', 'zto']

export function requiresQueryPhone(carrierCode?: string | null): boolean {
  const normalized = (carrierCode ?? '').trim().toLowerCase()
  return normalized !== '' && KUAIDI100_PHONE_REQUIRED_CARRIER_CODES.includes(normalized)
}

/**
 * 归一化收寄件人电话：接受手机号、座机、电商虚拟号「-」后的后四位。
 * 返回 null 表示「给了但格式不可用」；调用方需自行区分「没给」与「给了但非法」。
 */
export function normalizeQueryPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^[0-9+\-\s()]{4,32}$/.test(trimmed)) return null
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length < 4 || digits.length > 20) return null
  return digits
}

/** 上游返回了业务错误码（非「单号无效」类）。保留 returnCode 供调用方做精确映射。 */
export class Kuaidi100UpstreamError extends Error {
  readonly returnCode: string

  constructor(returnCode: string, message: string) {
    super(message)
    this.name = 'Kuaidi100UpstreamError'
    this.returnCode = returnCode
  }
}

/**
 * 上游 408：电话号码校验不通过。
 * 注意这与「账号权限」无关——2026-09-17 对照实验证明同一单号不带 phone 即 408、带 phone 即进入正常查询流程。
 */
export class Kuaidi100PhoneRequiredError extends Error {
  readonly code = 'PHONE_REQUIRED' as const

  constructor(message: string) {
    super(message)
    this.name = 'Kuaidi100PhoneRequiredError'
  }
}

export class Kuaidi100InvalidTrackingError extends Error {
  readonly code = 'INVALID_TRACKING_NO' as const

  constructor() {
    super('未查询到该平台对应的物流，请检查快递平台和运单号是否匹配')
    this.name = 'Kuaidi100InvalidTrackingError'
  }
}

function required(name: string): string {
  const value = env(name)?.trim()
  if (!value) throw new Error(`${name} 未配置`)
  return value
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstText(record: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = optionalText(record[name])
    if (value) return value
  }
  return undefined
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isFinite(number) ? number : undefined
}

function firstNumber(record: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = finiteNumber(record[name])
    if (value !== undefined) return value
  }
  return undefined
}

function coordinatePair(value: unknown): { latitude: number; longitude: number } | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split(/[,，\s]+/).map((part) => finiteNumber(part)).filter((part): part is number => part !== undefined)
  if (parts.length < 2) return undefined
  const [first, second] = parts
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { latitude: first, longitude: second }
  if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { latitude: second, longitude: first }
  return undefined
}

function coordinatesFrom(record: Record<string, unknown>, position: Record<string, unknown>): { latitude?: number; longitude?: number } {
  const pair = coordinatePair(record.areaCenter) ?? coordinatePair(record.coordinate) ?? coordinatePair(record.coordinates) ?? coordinatePair(position.areaCenter)
  if (pair) return pair
  const latitude = firstNumber(record, ['latitude', 'lat']) ?? firstNumber(position, ['latitude', 'lat'])
  const longitude = firstNumber(record, ['longitude', 'lng', 'lon']) ?? firstNumber(position, ['longitude', 'lng', 'lon'])
  return { ...(latitude !== undefined ? { latitude } : {}), ...(longitude !== undefined ? { longitude } : {}) }
}

function messageFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  return firstText(record, ['message', 'msg', 'reason', 'errorMessage'])
}

function isInvalidTrackingResponse(payload: Record<string, unknown>): boolean {
  const returnCode = String(payload.returnCode ?? '')
  const message = messageFrom(payload) ?? ''
  return returnCode === '201' || /不是有效的快递单号|运单号无效|运单号不存在|单号不存在|查无此单/.test(message)
}

function ensureSuccess(payload: unknown): void {
  if (!payload || typeof payload !== 'object') throw new Error('快递100返回了无效数据')
  const record = payload as Record<string, unknown>
  const status = record.status ?? record.success ?? record.result
  if (status === false || status === '0' || status === 0) {
    if (isInvalidTrackingResponse(record)) throw new Kuaidi100InvalidTrackingError()
    // 保留 returnCode：调用方需要把 408 之类的参数类错误映射成用户能看懂、能自己修的提示，
    // 而不是统一降级为「服务暂时不可用」——那会让用户完全无从下手。
    throw new Kuaidi100UpstreamError(String(record.returnCode ?? ''), messageFrom(payload) ?? '快递100查询失败')
  }
}

function sign(param: string, key: string, customer: string): string {
  return createHash('md5').update(`${param}${key}${customer}`, 'utf8').digest('hex').toUpperCase()
}

async function request(urlName: string, payload: Record<string, unknown>): Promise<unknown> {
  const url = required(urlName)
  const key = required('KUAIDI100_KEY')
  const customer = required('KUAIDI100_CUSTOMER')
  const param = JSON.stringify(payload)
  const body = new URLSearchParams({
    param,
    key,
    customer,
    sign: sign(param, key, customer),
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`快递100响应格式错误（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
    // 用 HTTP_ 前缀与「上游业务码」区分开：否则 HTTP 500 会被误当成快递100 的 500「查询无结果」。
    throw new Kuaidi100UpstreamError(`HTTP_${record.returnCode ?? response.status}`, messageFrom(data) ?? `快递100请求失败（HTTP ${response.status}）`)
  }
  ensureSuccess(data)
  return data
}

function normalizedStatus(value: unknown): string {
  const state = String(value ?? '').trim()
  if (['3', '5', '301', '302', '303'].includes(state) || /签收|已取件|妥投/.test(state)) return '已完成'
  if (['202', '204', '205', '208', '209', '304'].includes(state) || /驿站|快递柜|待取件|代收/.test(state)) return '待取件'
  return '运输中'
}

// 快递100 的 state 是物流状态码（数字），不是给人看的文案。
// 上游通常不返回 stateEx，所以这里把状态码映射为可读文本，避免把裸数字存进 status_detail。
const STATE_TEXT: Record<string, string> = {
  '0': '快件在途中',
  '1': '快件已揽收',
  '2': '物流运输中，存在疑难',
  '3': '快件已签收',
  '4': '快件已退签',
  '5': '快件派送中',
  '6': '快件已退回',
  '7': '快件转投中',
  '8': '快件清关中',
  '14': '快件已拒签',
}

function stateText(value: unknown): string | undefined {
  const state = String(value ?? '').trim()
  if (!state) return undefined
  return STATE_TEXT[state]
}

function tracesFrom(payload: Record<string, unknown>): Kuaidi100Trace[] {
  const raw = payload.data ?? payload.traces ?? payload.route
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const description = firstText(record, ['context', 'desc', 'description', 'status', 'remark']) ?? '物流状态已更新'
    const position = record.position && typeof record.position === 'object' ? record.position as Record<string, unknown> : {}
    const { latitude, longitude } = coordinatesFrom(record, position)
    return {
      occurredAt: firstText(record, ['ftime', 'time', 'acceptTime', 'datetime']),
      title: firstText(record, ['status', 'statusName', 'remark']) ?? description,
      description,
      location: firstText(record, ['location', 'areaName', 'city']),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
    }
  }).filter((item) => item.description)
}

export async function queryTracking(candidate: Kuaidi100TrackingCandidate): Promise<Kuaidi100TrackingDetail> {
  const resultv2 = env('KUAIDI100_RESULTV2')?.trim()
  const phone = candidate.phone?.trim()
  let payload: unknown
  try {
    payload = await request('KUAIDI100_TRACK_QUERY_URL', {
      com: candidate.carrierCode ?? '',
      num: candidate.trackingNo,
      ...(phone ? { phone } : {}),
      ...(resultv2 ? { resultv2 } : {}),
    })
  } catch (error) {
    // 408 是「电话号码校验不通过」。分成两种情况给出不同指引：
    // 没填 → 让他去填；填了仍不通过 → 号码与运单的收寄件人不一致，改号码而不是重试。
    if (error instanceof Kuaidi100UpstreamError && error.returnCode === '408') {
      throw new Kuaidi100PhoneRequiredError(phone
        ? '手机号与运单的收寄件人不一致，请核对后重试'
        : '该快递平台需填写收件人或寄件人手机号后才能查询')
    }
    throw error
  }
  const record = payload as Record<string, unknown>
  const traces = tracesFrom(record)
  const latest = traces[0]
  // record.status 是请求结果码（"200" 表示查询成功），不能当作物流状态或状态详情。
  const statusText = stateText(record.state)
  return {
    carrierCode: firstText(record, ['com', 'companyCode']) ?? candidate.carrierCode,
    carrierName: firstText(record, ['company', 'companyName', 'comName']) ?? candidate.carrierName,
    status: normalizedStatus(record.state ?? record.stateEx ?? latest?.title),
    statusDetail: firstText(record, ['stateEx', 'statusText', 'stateName']) ?? statusText ?? latest?.description,
    location: firstText(record, ['location', 'currentLocation']) ?? latest?.location,
    eta: firstText(record, ['estimatedTime', 'estimateTime', 'eta']),
    ...(latest?.latitude !== undefined ? { latitude: latest.latitude } : {}),
    ...(latest?.longitude !== undefined ? { longitude: latest.longitude } : {}),
    traces,
  }
}


