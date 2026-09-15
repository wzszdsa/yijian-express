/**
 * 运单号识别结果核对脚本（零依赖）
 *
 * 运行：npm run detect:check
 * 读取编译产物 server-dist/_shared/carrier-detect.mjs，因此先执行 build:server。
 *
 * 目的不是"跑通"，而是把识别依据打印出来供人工核对：
 * 每条 evidence 是否真实、是否编造，看输出即可判断。
 * 断言失败时以非 0 退出码结束。
 */
import assert from 'node:assert/strict'

const { detectCarrier, normalizeTrackingNo } = await import('../server-dist/_shared/carrier-detect.mjs')

const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' }

const cases = [
  // ── 精确规则：应给出唯一且高置信度的 best ────────────────────────────
  { no: 'SF1234567890123', expectCode: 'shunfeng', expectConfidence: 'high', note: '顺丰 SF + 13 位数字' },
  { no: 'SF123456789012', expectCode: 'shunfeng', expectConfidence: 'high', note: '顺丰 SF + 12 位数字' },
  { no: 'sf 1234 5678 9012', expectCode: 'shunfeng', expectConfidence: 'high', note: '小写+空格输入应被归一化' },
  { no: 'SF-1234-5678-9012-3', expectCode: 'shunfeng', expectConfidence: 'high', note: '含连字符输入应被归一化' },
  { no: 'EA123456789CN', expectCode: 'ems', expectConfidence: 'high', note: 'EMS 万国邮联国际件格式' },
  { no: 'RR123456789CN', expectCode: 'ems', expectConfidence: 'high', note: 'EMS 国际挂号小包' },
  { no: 'KA123456789', expectCode: 'china_post', expectConfidence: 'high', note: '中国邮政快递包裹' },
  { no: 'JDV1234567890123', expectCode: 'jd', expectConfidence: 'high', note: '京东 JDV 前缀' },
  { no: 'JDA12345678901', expectCode: 'jd', expectConfidence: 'medium', note: '京东混合字符单号（中置信度，需确认）' },
  { no: 'JT1234567890123', expectCode: 'jtexpress', expectConfidence: 'high', note: '极兔 JT 前缀' },
  { no: 'YT1234567890123', expectCode: 'yto', expectConfidence: 'high', note: '圆通 YT 前缀' },
  { no: 'DPK1234567890', expectCode: 'deppon', expectConfidence: 'high', note: '德邦 DPK 前缀' },
  { no: 'ZJS123456789012', expectCode: 'zjs', expectConfidence: 'high', note: '宅急送 ZJS 前缀' },

  // ── 弱规则：必须给出候选集，不得唯一断言 ────────────────────────────
  // 号段类规则（中通/申通/韵达）在公开号段表之间本身就存在重叠，
  // 例如 768 同时出现在中通与申通的号段表中。这类冲突只会返回候选集，
  // 因此这里的断言目标是"候选集包含该公司 + 置信度不超过 medium"，而非唯一归属。
  { no: '768123456789', expectCandidateCode: 'zto', maxConfidence: 'medium', note: '中通三位号段 12 位（768 与申通号段重叠，应只进候选）' },
  { no: '200812345678', expectCandidateCode: 'zto', maxConfidence: 'medium', note: '中通四位号段 2008 + 8 位' },
  { no: '888123456789', expectCandidateCode: 'sto', maxConfidence: 'medium', note: '申通三位号段 12 位' },
  { no: '1301234567890', expectCandidateCode: 'yunda', maxConfidence: 'medium', note: '韵达号段 13 位' },
  { no: 'STO1234567890', expectCode: 'sto', expectConfidence: 'medium', note: '申通 STO 前缀（唯一命中，可给出建议）' },
  { no: 'VIP123456789', expectCode: 'youshunda', expectConfidence: 'medium', note: '优速 VIP 前缀（唯一命中，可给出建议）' },

  // ── 歧义数字单号：不得给出高置信度 best ─────────────────────────────
  { no: '123456789012', ambiguous: true, note: '12 位纯数字：顺丰/中通/圆通/申通均可匹配' },
  { no: '12345678901234', ambiguous: true, note: '14 位纯数字：无号段规则命中' },
  { no: '906919164534', ambiguous: true, note: '真实量级的 12 位纯数字' },

  // ── 非法/边界输入 ────────────────────────────────────────────────
  { no: '', reason: 'empty', note: '空输入' },
  { no: '   ', reason: 'empty', note: '纯空白输入' },
  { no: 'ABC', reason: 'too_short', note: '过短' },
  { no: 'ABC!@#$%^&*', reason: 'invalid_format', note: '含非法字符' },
  { no: '0'.repeat(129), reason: 'too_long', note: '超出最大长度' },
]

let failed = 0

console.log('\n运单号识别核对\n' + '─'.repeat(96))

for (const testCase of cases) {
  const result = detectCarrier(testCase.no)
  const normalized = normalizeTrackingNo(testCase.no)
  const bestCode = result.best?.carrierCode ?? null
  const bestConfidence = result.best?.confidence ?? null
  const candidateSummary = result.candidates.map((c) => `${c.short}(${c.carrierCode}/${c.confidence})`).join(', ') || '无'
  const problems = []

  try {
    if (testCase.expectCode) {
      assert.equal(bestCode, testCase.expectCode, `best 应为 ${testCase.expectCode}，实际 ${bestCode}`)
      if (testCase.expectConfidence) {
        assert.equal(bestConfidence, testCase.expectConfidence, `置信度应为 ${testCase.expectConfidence}，实际 ${bestConfidence}`)
      }
      assert.ok(result.candidates.some((c) => c.carrierCode === testCase.expectCode), '候选集中应包含预期公司')
    }
    if (testCase.ambiguous) {
      // 关键断言：歧义数字单号不得出现 high，避免误导用户
      assert.notEqual(bestConfidence, 'high', `歧义单号不应给出 high 置信度，实际 ${bestConfidence}`)
      assert.ok(result.candidates.length >= 1, '歧义单号应至少给出一个候选')
      assert.equal(result.matched, false, '无唯一归属时 matched 应为 false')
    }
    if (testCase.expectCandidateCode) {
      assert.ok(
        result.candidates.some((c) => c.carrierCode === testCase.expectCandidateCode),
        `候选集应包含 ${testCase.expectCandidateCode}，实际 ${candidateSummary || '无'}`,
      )
    }
    if (testCase.maxConfidence) {
      const ceiling = testCase.maxConfidence === 'high' ? 0 : testCase.maxConfidence === 'medium' ? 1 : 2
      const actual = bestConfidence === null ? 2 : bestConfidence === 'high' ? 0 : bestConfidence === 'medium' ? 1 : 2
      assert.ok(actual >= ceiling, `置信度不应高于 ${testCase.maxConfidence}，实际 ${bestConfidence}（冲突时不得唯一断言）`)
    }
    if (testCase.reason) {
      assert.equal(result.unmatchedReason, testCase.reason, `unmatchedReason 应为 ${testCase.reason}，实际 ${result.unmatchedReason}`)
      assert.equal(result.best, null, '未能识别时 best 应为 null')
      assert.equal(result.candidates.length, 0, '未能识别时不应返回候选')
      assert.equal(result.matched, false, '未能识别时 matched 应为 false')
    }
  } catch (error) {
    failed += 1
    problems.push(error instanceof Error ? error.message : String(error))
  }

  const status = problems.length ? '✗ 失败' : '✓ 通过'
  console.log(`\n${status}  ${testCase.note}`)
  console.log(`  输入      ${JSON.stringify(testCase.no === '' ? '(空)' : testCase.no)}`)
  console.log(`  归一化    ${normalized || '(空)'}`)
  console.log(`  识别结果  ${result.matched ? '已定案' : result.candidates.length ? '返回候选待确认' : '未能识别'}`)
  if (bestCode) console.log(`  best      ${result.best.carrierName} (${bestCode}) 置信度=${CONFIDENCE_LABEL[bestConfidence]}`)
  console.log(`  候选      ${candidateSummary}`)
  if (result.unmatchedReason) console.log(`  未命中    ${result.unmatchedReason}`)
  if (result.best) {
    for (const evidence of result.best.evidence) {
      console.log(`    依据[${evidence.type}] ${evidence.value} — ${evidence.note}`)
    }
  } else if (result.candidates[0]) {
    console.log(`    首个候选取证（${result.candidates[0].short}）：`)
    for (const evidence of result.candidates[0].evidence.slice(0, 3)) {
      console.log(`    依据[${evidence.type}] ${evidence.value} — ${evidence.note}`)
    }
  }
  if (problems.length) for (const problem of problems) console.log(`  !! ${problem}`)
}

console.log('\n' + '─'.repeat(96))
if (failed) {
  console.error(`核对失败：${failed}/${cases.length} 条用例未通过\n`)
  process.exitCode = 1
} else {
  console.log(`全部通过：${cases.length} 条用例\n`)
}
