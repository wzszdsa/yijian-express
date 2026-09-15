/**
 * 运单号 → 快递平台识别（纯本地规则，零外部依赖）
 *
 * ── 重要前提（务必先读）───────────────────────────────────────────────
 * 1. 国内运单号没有统一的、由快递公司自行声明的编码规范。单号本身**不携带公司标识**，
 *    尤其是纯数字单号，多家公司之间存在真实重叠。因此本模块：
 *      - 对特征明确的单号（字母前缀 / 国际件国别后缀 / 特定长度区间）给出唯一 best；
 *      - 对只能靠长度判断的数字单号**不臆断唯一归属**，返回候选集 + ambiguous 标记。
 * 2. 本模块只做"格式匹配"，不代表"该单号真实存在于该公司系统"。真正的确认必须由
 *    上游查询接口返回结果完成。
 * 3. 依据（evidence）只标注可查证的事实。**不编造校验位算法**：国内主流快递的单号校验
 *    规则未公开，因此本模块不使用 checksum 证据类型；EMS 的 CN 国别后缀属于格式事实。
 *
 * ── 规则来源 ──────────────────────────────────────────────────────
 * - 淘宝开放平台「物流公司」接口的 reg_mail_no 字段（公开镜像，更新时间 2024-09-27）
 * - 快递100 公开的快递公司编码（与 KUAIDI100_SUPPORTED_CARRIER_CODES 对齐）
 * - 各快递公司公开帮助中心的单号格式说明
 *
 * ── 历史教训 ──────────────────────────────────────────────────────
 * 本项目上一版曾用快递100 ~~autoComNum~~ 做"全自动识别 + 查询失败即静默换平台重试"，
 * 语义倒置（把上游查询失败当成识别纠错信号），已回退。本模块**只输出建议**，
 * 绝不驱动静默重试；人工指定的平台永远优先。
 */

export type DetectionConfidence = 'high' | 'medium' | 'low'

export type DetectionEvidenceType = 'prefix' | 'length' | 'charset' | 'suffix' | 'pattern' | 'source'

export type DetectionEvidence = {
  type: DetectionEvidenceType
  value: string
  note: string
}

export type CarrierCandidate = {
  carrierCode: string
  carrierName: string
  short: string
  confidence: DetectionConfidence
  evidence: DetectionEvidence[]
}

export type DetectionResult = {
  trackingNo: string
  normalized: string
  matched: boolean
  /** 仅当有唯一的高置信度候选时给出；否则为 null，调用方必须让用户确认 candidates */
  best: CarrierCandidate | null
  candidates: CarrierCandidate[]
  unmatchedReason: DetectionUnmatchedReason | null
}

export type DetectionUnmatchedReason =
  | 'empty'
  | 'invalid_format'
  | 'too_short'
  | 'too_long'
  | 'no_rule_matched'

/**
 * 公司编码与展示名。编码与 KUAIDI100_SUPPORTED_CARRIER_CODES 保持一致，
 * 便于识别结果直接用于上游查询。
 */
const CARRIER_NAMES: Record<string, { carrierName: string; short: string }> = {
  shunfeng: { carrierName: '顺丰速运', short: '顺丰' },
  jd: { carrierName: '京东物流', short: '京东' },
  zto: { carrierName: '中通快递', short: '中通' },
  yto: { carrierName: '圆通速递', short: '圆通' },
  yunda: { carrierName: '韵达快递', short: '韵达' },
  sto: { carrierName: '申通快递', short: '申通' },
  ems: { carrierName: 'EMS', short: 'EMS' },
  jtexpress: { carrierName: '极兔速递', short: '极兔' },
  deppon: { carrierName: '德邦快递', short: '德邦' },
  best: { carrierName: '百世快递', short: '百世' },
  youshunda: { carrierName: '优速快递', short: '优速' },
  anep: { carrierName: '安能物流', short: '安能' },
  china_post: { carrierName: '中国邮政', short: '邮政' },
  zjs: { carrierName: '宅急送', short: '宅急送' },
}

export function carrierDisplayName(carrierCode: string): { carrierName: string; short: string } {
  const known = CARRIER_NAMES[carrierCode.trim().toLowerCase()]
  if (known) return known
  return { carrierName: carrierCode, short: carrierCode.slice(0, 2) }
}

type Rule = {
  carrierCode: string
  /** 判定为命中的正则（针对归一化后的大写单号） */
  pattern: RegExp
  confidence: DetectionConfidence
  label: string
  /** 规则出处，会作为 source 证据输出 */
  source: string
  /** 需要额外附加的证据（长度、后缀等） */
  extraEvidence?: (normalized: string) => DetectionEvidence[]
}

const SOURCE_TAOBAO = '淘宝开放平台 reg_mail_no（2024-09-27 版）'
const SOURCE_PUBLIC = '快递公司公开单号格式说明 + 快递100 公司编码'

/** 第一层：特征明确，可单独定案 */
const STRONG_RULES: Rule[] = [
  {
    carrierCode: 'shunfeng',
    pattern: /^SF[0-9]{12}$/,
    confidence: 'high',
    label: 'SF + 12 位数字',
    source: SOURCE_PUBLIC,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 14 位，符合顺丰 SF 前缀单号长度' },
    ],
  },
  {
    carrierCode: 'shunfeng',
    pattern: /^SF[0-9]{13,20}$/,
    confidence: 'high',
    label: 'SF + 13-20 位数字',
    source: SOURCE_PUBLIC,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 ' + value.length + ' 位，符合顺丰 SF 前缀（国际件/电子面单）长度区间' },
    ],
  },
  {
    carrierCode: 'ems',
    pattern: /^[ELRSVA][A-Z][0-9]{9}CN$/,
    confidence: 'high',
    label: '两字母 + 9 位数字 + CN',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'suffix', value: value.slice(-2), note: 'CN 为万国邮联国际邮件单号的国别后缀，指向中国邮政体系' },
      { type: 'length', value: String(value.length), note: '总长度 13 位，符合万国邮联 S10 标准单号格式' },
    ],
  },
  {
    carrierCode: 'china_post',
    pattern: /^(KA|KQ|PH|GA|PA|SA|XA|XB)[0-9]{9}[0-9]{0,2}$/,
    confidence: 'high',
    label: '邮政字母前缀 + 9-11 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'prefix', value: value.slice(0, 2), note: '该两字母前缀属于中国邮政快递包裹专用段' },
    ],
  },
  {
    carrierCode: 'jd',
    pattern: /^JDV?[0-9]{10,20}$/,
    confidence: 'high',
    label: 'JD / JDV + 数字',
    source: SOURCE_PUBLIC,
    extraEvidence: (value) => [
      { type: 'prefix', value: value.startsWith('JDV') ? 'JDV' : 'JD', note: '京东物流专用字母前缀' },
    ],
  },
  {
    carrierCode: 'jd',
    pattern: /^JD[0-9A-Z]{11,17}$/,
    confidence: 'medium',
    label: 'JD + 字母数字混合（京东仓配/大件）',
    source: SOURCE_TAOBAO,
    extraEvidence: () => [
      { type: 'prefix', value: 'JD', note: '京东物流字母前缀，但后半段为混合字符，长度区间与部分其他公司重叠' },
    ],
  },
  {
    carrierCode: 'jtexpress',
    pattern: /^JT[0-9]{10,20}$/,
    confidence: 'high',
    label: 'JT + 数字',
    source: SOURCE_PUBLIC,
    extraEvidence: () => [
      { type: 'prefix', value: 'JT', note: '极兔速递专用字母前缀' },
    ],
  },
  {
    carrierCode: 'jtexpress',
    pattern: /^(K8|BXA)[0-9]{9,18}$/,
    confidence: 'medium',
    label: 'K8 / BXA + 数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'prefix', value: value.startsWith('BXA') ? 'BXA' : 'K8', note: '极兔（原百世/天天体系）字母前缀段' },
    ],
  },
  {
    carrierCode: 'deppon',
    pattern: /^DPK[0-9]{9,18}$/,
    confidence: 'high',
    label: 'DPK + 数字',
    source: SOURCE_PUBLIC,
    extraEvidence: () => [{ type: 'prefix', value: 'DPK', note: '德邦快递专用字母前缀' }],
  },
  {
    carrierCode: 'zjs',
    pattern: /^ZJS[0-9]{12}$/,
    confidence: 'high',
    label: 'ZJS + 12 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: () => [{ type: 'prefix', value: 'ZJS', note: '宅急送专用字母前缀' }],
  },
  {
    carrierCode: 'yto',
    pattern: /^YT[0-9]{10,16}$/,
    confidence: 'high',
    label: 'YT + 10-16 位数字',
    source: SOURCE_PUBLIC,
    extraEvidence: () => [{ type: 'prefix', value: 'YT', note: '圆通速递专用字母前缀（YT 为 yuantong 缩写）' }],
  },
]

/**
 * 第二层：弱规则。仅能给出候选，不能定案。
 * 纯数字单号在多家公司间真实重叠，规则具体度决定 confidence 上限。
 */
const WEAK_RULES: Rule[] = [
  {
    carrierCode: 'zto',
    pattern: /^(010|768|765|778|779|719|828|618|680|518|688|880|660|805|988|628|205|717|718|728|738|761|762|763|701|757|751|359|358|100|200|118|128|689|528|852)[0-9]{9}$/,
    confidence: 'medium',
    label: '中通号段前缀 + 9 位数字（总长 12 位）',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 12 位' },
      { type: 'prefix', value: value.slice(0, 3), note: '三位号段落在中通公开的单号号段表中' },
    ],
  },
  {
    carrierCode: 'zto',
    pattern: /^(5711|2008|2009|2010|2013)[0-9]{8}$/,
    confidence: 'medium',
    label: '中通四位号段 + 8 位数字（总长 12 位）',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 12 位' },
      { type: 'prefix', value: value.slice(0, 4), note: '四位号段落在中通公开的单号号段表中' },
    ],
  },
  {
    carrierCode: 'zto',
    pattern: /^(4|9[0-8]|2[1-9]|5[4-6]|6[3-4]|7[2-9])[0-9]{10}$/,
    confidence: 'low',
    label: '中通双位号段 + 10 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'prefix', value: value.slice(0, 2), note: '双位号段落在中通公开号段表中，但与圆通/韵达存在重叠' },
    ],
  },
  {
    carrierCode: 'yunda',
    pattern: /^(10|11|12|13|14|15|16|17|18|19|31|39|50|55|58|66|77|80|88)[0-9]{11}$/,
    confidence: 'medium',
    label: '韵达号段前缀 + 11 位数字（总长 13 位）',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 13 位' },
      { type: 'prefix', value: value.slice(0, 2), note: '双位号段落在韵达公开号段表中' },
    ],
  },
  {
    carrierCode: 'yunda',
    pattern: /^(10|11|12|13|14|15|16|17|19|18|50|55|58|80|88|66|31|77|39)[0-9]{14}$/,
    confidence: 'medium',
    label: '韵达号段前缀 + 14 位数字（总长 16 位）',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 16 位' },
      { type: 'prefix', value: value.slice(0, 2), note: '双位号段落在韵达公开号段表中' },
    ],
  },
  {
    carrierCode: 'sto',
    pattern: /^(268|888|588|688|368|468|568|668|768|868|968)[0-9]{9}$/,
    confidence: 'medium',
    label: '申通号段前缀 + 9 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 12 位' },
      { type: 'prefix', value: value.slice(0, 3), note: '三位号段落在申通公开号段表中' },
    ],
  },
  {
    carrierCode: 'sto',
    pattern: /^STO[0-9]{10}$/,
    confidence: 'medium',
    label: 'STO + 10 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: () => [{ type: 'prefix', value: 'STO', note: '申通拼音缩写前缀' }],
  },
  {
    carrierCode: 'yto',
    pattern: /^[Y][0-9]{12}$/,
    confidence: 'low',
    label: 'Y + 12 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: () => [{ type: 'prefix', value: 'Y', note: '圆通单字母前缀，单字母区分度较低' }],
  },
  {
    carrierCode: 'yto',
    pattern: /^[6-9][0-9]{17}$/,
    confidence: 'low',
    label: '6-9 开头共 18 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '总长度 18 位' },
      { type: 'prefix', value: value.slice(0, 1), note: '首位落在圆通长单号段' },
    ],
  },
  {
    carrierCode: 'youshunda',
    pattern: /^(VIP[0-9]{9}|V[0-9]{11}|9001[0-9]{8})$/,
    confidence: 'medium',
    label: 'VIP / V / 9001 前缀',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'prefix', value: value.slice(0, Math.min(4, value.length)), note: '优速快递公开前缀段' },
    ],
  },
]

/**
 * 第三层：仅长度可判的泛化规则。这些规则几乎必然产生多个候选，
 * 因此 confidence 一律为 low，且只在没有更强规则命中时才参与排序。
 */
const LOOSE_RULES: Rule[] = [
  {
    carrierCode: 'shunfeng',
    pattern: /^[0-9]{12}$/,
    confidence: 'low',
    label: '12 位纯数字',
    source: SOURCE_PUBLIC,
    extraEvidence: () => [
      { type: 'length', value: '12', note: '顺丰国内件常见 12 位纯数字，但中通/圆通/韵达同样存在 12 位单号，无法据此定案' },
    ],
  },
  {
    carrierCode: 'best',
    pattern: /^[0-9]{11,12}$/,
    confidence: 'low',
    label: '11-12 位纯数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '百世公开规则为 11-12 位纯数字，与多家公司重叠' },
    ],
  },
  {
    carrierCode: 'anep',
    pattern: /^[0-9]{10,13}$/,
    confidence: 'low',
    label: '10-13 位纯数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '安能公开规则为 10-12 位纯数字，与多家公司重叠' },
    ],
  },
  {
    carrierCode: 'deppon',
    pattern: /^[0-9]{8,10}$/,
    confidence: 'low',
    label: '8-10 位纯数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '德邦公开规则为 8-10 位纯数字，与多家公司重叠' },
    ],
  },
  {
    carrierCode: 'sto',
    pattern: /^[0-9]{12,15}$/,
    confidence: 'low',
    label: '12-15 位纯数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'length', value: String(value.length), note: '申通公开规则含 12-15 位纯数字，与多家公司重叠' },
    ],
  },
  {
    carrierCode: 'yto',
    pattern: /^[A-Z0-9]{2}[0-9]{8,10}$/,
    confidence: 'low',
    label: '两字符 + 8-10 位数字',
    source: SOURCE_TAOBAO,
    extraEvidence: (value) => [
      { type: 'prefix', value: value.slice(0, 2), note: '圆通公开规则允许任意两字符前缀，区分度低' },
    ],
  },
]

const ALL_RULES: Rule[] = [...STRONG_RULES, ...WEAK_RULES, ...LOOSE_RULES]

const MAX_TRACKING_NO_LENGTH = 128
/** 低于该长度的单号不参与识别：太短则规则命中无意义 */
const MIN_DETECTABLE_LENGTH = 8

/**
 * 归一化：去除空白（含全角空格）、连字符与常见分隔符，统一转大写。
 * 保留原始输入用于回显。
 */
export function normalizeTrackingNo(input: string): string {
  return input
    .replace(/[\s\u3000\u00a0]/g, '')
    .replace(/[-_/\\]/g, '')
    .toUpperCase()
}

const CONFIDENCE_ORDER: Record<DetectionConfidence, number> = { high: 0, medium: 1, low: 2 }
const RULE_TIER_ORDER: Record<DetectionConfidence, number> = { high: 0, medium: 1, low: 2 }

function candidateFrom(rule: Rule, normalized: string): CarrierCandidate {
  const { carrierName, short } = carrierDisplayName(rule.carrierCode)
  const evidence: DetectionEvidence[] = [
    { type: 'pattern', value: rule.label, note: '命中规则：' + rule.pattern.source },
  ]
  if (rule.extraEvidence) evidence.push(...rule.extraEvidence(normalized))
  evidence.push({ type: 'source', value: rule.source, note: '规则出处' })
  return { carrierCode: rule.carrierCode, carrierName, short, confidence: rule.confidence, evidence }
}

function compareCandidates(a: CarrierCandidate, b: CarrierCandidate): number {
  const byConfidence = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]
  if (byConfidence !== 0) return byConfidence
  return a.carrierCode.localeCompare(b.carrierCode)
}

function emptyResult(trackingNo: string, normalized: string, reason: DetectionUnmatchedReason, candidates: CarrierCandidate[] = []): DetectionResult {
  return { trackingNo, normalized, matched: false, best: null, candidates, unmatchedReason: reason }
}

/**
 * 识别运单号所属快递平台。
 *
 * 返回语义：
 * - best 非空 且 confidence === 'high' → 可自动采用
 * - best 非空 但 confidence !== 'high' → 必须让用户从 candidates 中确认
 * - best 为 null → 未能识别，需用户手动指定
 */
export function detectCarrier(input: string): DetectionResult {
  const trackingNo = typeof input === 'string' ? input : ''
  const normalized = normalizeTrackingNo(trackingNo)

  if (!normalized) return emptyResult(trackingNo, normalized, 'empty')
  if (normalized.length > MAX_TRACKING_NO_LENGTH) return emptyResult(trackingNo, normalized, 'too_long')
  if (!/^[A-Z0-9]+$/.test(normalized)) return emptyResult(trackingNo, normalized, 'invalid_format')
  if (normalized.length < MIN_DETECTABLE_LENGTH) return emptyResult(trackingNo, normalized, 'too_short')

  const matched: Array<{ rule: Rule; candidate: CarrierCandidate }> = []
  for (const rule of ALL_RULES) {
    if (!rule.pattern.test(normalized)) continue
    matched.push({ rule, candidate: candidateFrom(rule, normalized) })
  }

  if (!matched.length) return emptyResult(trackingNo, normalized, 'no_rule_matched')

  // 同一公司可能命中多条规则（如顺丰同时命中 SF 前缀与 12 位纯数字），取最高置信度那条，
  // 但把其余命中规则的依据合并进去，避免丢失信息。
  const byCarrier = new Map<string, { candidate: CarrierCandidate; tier: number }>()
  for (const { rule, candidate } of matched) {
    const tier = RULE_TIER_ORDER[rule.confidence]
    const existing = byCarrier.get(candidate.carrierCode)
    if (!existing) {
      byCarrier.set(candidate.carrierCode, { candidate, tier })
      continue
    }
    if (tier < existing.tier) {
      byCarrier.set(candidate.carrierCode, { candidate, tier })
    } else if (tier === existing.tier) {
      existing.candidate.evidence.push(...candidate.evidence)
    }
  }

  const candidates = Array.from(byCarrier.values()).map((entry) => entry.candidate).sort(compareCandidates)
  const strongHit = candidates.find((candidate) => candidate.confidence === 'high')
  if (strongHit) {
    return { trackingNo, normalized, matched: true, best: strongHit, candidates, unmatchedReason: null }
  }

  // 没有 high 命中时，仅当候选集里**只有一家**公司命中了 medium（比 low 更具体）的规则，
  // 才允许给出建议性 best。否则一律交回候选集，由用户确认。
  // 注意：这里刻意不采用"排序后取第一个"的策略——第一个候选只是按字母序排列的展示顺序，
  // 把它当成唯一归属会误导用户。
  const mediumHits = candidates.filter((candidate) => candidate.confidence === 'medium')
  if (mediumHits.length === 1) {
    return { trackingNo, normalized, matched: true, best: mediumHits[0], candidates, unmatchedReason: null }
  }

  return emptyResult(trackingNo, normalized, 'no_rule_matched', candidates)
}

/** 供上游查询前做最后一道字符集校验（与既有接口契约保持一致）。 */
export function isWellFormedTrackingNo(input: string): boolean {
  const normalized = normalizeTrackingNo(input)
  return /^[A-Z0-9]{4,128}$/.test(normalized)
}
