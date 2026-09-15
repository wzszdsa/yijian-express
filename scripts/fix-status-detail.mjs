// 一次性订正脚本：把 yijian_parcels.status_detail 中遗留的裸数字状态码
// （快递100 的 state 字段）转换为可读中文文案。
//
// 默认只预览（dry-run），不改动任何数据。确认无误后加 --apply 才会写库。
//
//   node scripts/fix-status-detail.mjs            预览
//   node scripts/fix-status-detail.mjs --apply    执行
//
// 说明：该缺陷的成因见 server/_shared/kuaidi100.mts 中 statusDetail 字段的修复。
// 数字码映射表与那边保持一致，避免两处定义漂移。

import { readFile } from 'node:fs/promises'

const STATE_TEXT = {
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

const apply = process.argv.includes('--apply')

async function loadMysqlConfig() {
  const text = await readFile(new URL('../.env', import.meta.url), 'utf8')
  const config = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) config[match[1]] = match[2]
  }
  return config
}

function parseMysqlUrl(value) {
  const url = new URL(value)
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  }
}

const config = await loadMysqlConfig()
const mysqlUrl = config.MYSQL_URL
if (!mysqlUrl) {
  console.error('未在 .env 中找到 MYSQL_URL')
  process.exit(1)
}

const { createPool } = await import('../node_modules/mysql2/promise.js')
const pool = createPool({ ...parseMysqlUrl(mysqlUrl), connectionLimit: 2 })

try {
  const [rows] = await pool.query(
    `SELECT id, tracking_no, status, status_detail
     FROM yijian_parcels
     WHERE status_detail REGEXP '^[0-9]+$'`,
  )

  if (!rows.length) {
    console.log('没有需要订正的记录（status_detail 中已无裸数字）。')
  } else {
    console.log(`发现 ${rows.length} 条 status_detail 为裸数字的记录：\n`)
    let unknown = 0
    for (const row of rows) {
      const mapped = STATE_TEXT[row.status_detail] ?? '(无对应映射，保持原值)'
      if (!STATE_TEXT[row.status_detail]) unknown += 1
      console.log(`  ${row.tracking_no.padEnd(20)} [${row.status}] ${row.status_detail} -> ${mapped}`)
    }
    if (unknown) console.log(`\n注意：有 ${unknown} 条无对应映射，将被跳过。`)

    if (!apply) {
      console.log('\n以上为预览。确认无误后执行：node scripts/fix-status-detail.mjs --apply')
    } else {
      let changed = 0
      for (const row of rows) {
        const mapped = STATE_TEXT[row.status_detail]
        if (!mapped) continue
        const [result] = await pool.execute(
          `UPDATE yijian_parcels SET status_detail = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE id = ? AND status_detail = ?`,
          [mapped, row.id, row.status_detail],
        )
        if (result.affectedRows > 0) changed += 1
      }
      console.log(`\n已订正 ${changed} 条记录。`)
    }
  }

  const [check] = await pool.query(
    `SELECT status, status_detail, COUNT(*) n
     FROM yijian_parcels GROUP BY status, status_detail ORDER BY status`,
  )
  console.log('\n订正后 status_detail 分布：')
  for (const row of check) console.log(`  ${row.status.padEnd(8)} | ${String(row.status_detail ?? '(NULL)').padEnd(24)} | ${row.n} 条`)
} finally {
  await pool.end()
}
