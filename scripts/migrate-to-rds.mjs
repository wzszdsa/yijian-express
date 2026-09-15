// 本地 MySQL → 阿里云 RDS 数据迁移脚本
//
//   node scripts/migrate-to-rds.mjs            预检：连通性、表结构、数据量对比（不改任何数据）
//   node scripts/migrate-to-rds.mjs --create   预检 + 在 RDS 上建表（执行 mysql/schema.sql）
//   node scripts/migrate-to-rds.mjs --apply    预检 + 建表（如需） + 迁移数据
//
// 设计要点：
//   1. 默认只读预检，任何写操作都必须显式加 --create / --apply。
//   2. 显式 SET NAMES utf8mb4 —— 本机 mysql 客户端默认 GBK，不设置会导致中文默认值/数据损坏。
//   3. 迁移顺序遵循外键依赖：users → sessions → parcels → parcel_events → otp_challenges。
//   4. 写入使用 INSERT ... ON DUPLICATE KEY UPDATE，可重复执行（幂等）。
//   5. 全程不打印任何密码。

import { readFile } from 'node:fs/promises'
import { createPool } from 'mysql2/promise'

const APPLY = process.argv.includes('--apply')
const CREATE = process.argv.includes('--create') || APPLY

// 源库（本地）读 .env；目标库（RDS）读 .env.rds
const SOURCE_ENV = '.env'
const TARGET_ENV = '.env.rds'

async function loadEnvFile(path) {
  const text = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

function poolOptions(env, label) {
  const raw = env.MYSQL_URL
  if (!raw) throw new Error(`${label}: 未找到 MYSQL_URL`)
  const u = new URL(raw)
  const database = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
  if (!u.hostname || !database) throw new Error(`${label}: MYSQL_URL 缺少主机或库名`)
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    connectionLimit: 2,
    // 关键：统一字符集，避免 GBK 默认值污染
    charset: 'utf8mb4',
    multipleStatements: true,
    dateStrings: true,
    timezone: 'Z',
    connectTimeout: 20_000,
  }
}

async function connect(env, label) {
  const pool = createPool(poolOptions(env, label))
  // 双保险：显式声明会话字符集
  await pool.query('SET NAMES utf8mb4')
  const [rows] = await pool.query('SELECT VERSION() AS version, DATABASE() AS db, @@character_set_connection AS cs')
  return { pool, info: rows[0] }
}

const TABLES = ['yijian_users', 'yijian_sessions', 'yijian_parcels', 'yijian_parcel_events', 'yijian_otp_challenges']

async function countRows(pool, table) {
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)
    return rows[0].n
  } catch {
    return null // 表不存在
  }
}

// 比较源库与目标库的列定义，防止迁移进结构不一致的表。
// 返回每个表的差异列表（空数组 = 一致）。
async function compareStructure(sourcePool, targetPool, table) {
  const q = `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`
  const [src] = await sourcePool.query(q, [table])
  const [dst] = await targetPool.query(q, [table])
  const sig = (r) => `${r.COLUMN_NAME}:${r.COLUMN_TYPE}:${r.IS_NULLABLE}:${r.COLUMN_KEY}`
  const srcMap = new Map(src.map((r) => [r.COLUMN_NAME, sig(r)]))
  const dstMap = new Map(dst.map((r) => [r.COLUMN_NAME, sig(r)]))
  const diffs = []
  for (const [name, s] of srcMap) {
    if (!dstMap.has(name)) diffs.push(`目标库缺少列 ${name}`)
    else if (dstMap.get(name) !== s) diffs.push(`列 ${name} 定义不同：源 ${s} / 目标 ${dstMap.get(name)}`)
  }
  for (const name of dstMap.keys()) {
    if (!srcMap.has(name)) diffs.push(`目标库多出列 ${name}`)
  }
  return diffs
}

async function main() {
  console.log('═'.repeat(72))
  console.log(APPLY ? '模式：迁移数据（--apply）' : CREATE ? '模式：建表（--create）' : '模式：只读预检')
  console.log('═'.repeat(72))

  const sourceEnv = await loadEnvFile(SOURCE_ENV)
  const targetEnv = await loadEnvFile(TARGET_ENV)

  console.log('\n[1/5] 连接源库（本地）与目标库（RDS）')
  const source = await connect(sourceEnv, '源库')
  console.log(`  源库   ${source.info.db}  MySQL ${source.info.version}  字符集=${source.info.cs}`)
  const target = await connect(targetEnv, '目标库')
  console.log(`  目标库 ${target.info.db}  MySQL ${target.info.version}  字符集=${target.info.cs}`)

  try {
    console.log('\n[2/5] 检查目标库表结构')
    const missing = []
    for (const t of TABLES) {
      const n = await countRows(target.pool, t)
      console.log(`  ${t.padEnd(24)} ${n === null ? '✘ 不存在' : `✔ ${n} 行`}`)
      if (n === null) missing.push(t)
    }

    if (missing.length && !CREATE) {
      console.log(`\n目标库缺少 ${missing.length} 张表。请加 --create 建表，或加 --apply 一步完成建表与迁移。`)
    }

    // 结构一致性校验：只对两侧都存在的表做比较
    const existing = TABLES.filter((t) => !missing.includes(t))
    if (existing.length) {
      console.log('\n  结构一致性校验（源库 vs 目标库）：')
      let structureMismatch = 0
      for (const t of existing) {
        const diffs = await compareStructure(source.pool, target.pool, t)
        if (diffs.length) {
          structureMismatch += 1
          console.log(`  ${t.padEnd(24)} ✘ ${diffs.length} 处不一致`)
          for (const d of diffs.slice(0, 5)) console.log(`      · ${d}`)
          if (diffs.length > 5) console.log(`      · …另有 ${diffs.length - 5} 处`)
        } else {
          console.log(`  ${t.padEnd(24)} ✔ 一致`)
        }
      }
      if (structureMismatch && APPLY) {
        throw new Error(`目标库有 ${structureMismatch} 张表结构与源库不一致，已中止迁移以免写入错误数据。请先对齐表结构。`)
      }
    }

    if (missing.length && CREATE) {
      console.log('\n[3/5] 在目标库执行 mysql/schema.sql 建表')
      const sql = await readFile(new URL('../mysql/schema.sql', import.meta.url), 'utf8')
      await target.pool.query(sql)
      console.log('  ✔ schema.sql 已执行')
      for (const t of TABLES) {
        const n = await countRows(target.pool, t)
        console.log(`  ${t.padEnd(24)} ${n === null ? '✘ 仍不存在' : '✔ 已创建'}`)
      }
    } else {
      console.log('\n[3/5] 建表：跳过')
    }

    console.log('\n[4/5] 数据量对比')
    const plan = []
    for (const t of TABLES) {
      const s = await countRows(source.pool, t)
      const d = await countRows(target.pool, t)
      console.log(`  ${t.padEnd(24)} 源 ${String(s ?? '-').padStart(5)}  →  目标 ${String(d ?? '-').padStart(5)}`)
      if (s !== null && s > 0 && d !== null) plan.push({ table: t, rows: s })
    }

    if (!APPLY) {
      console.log('\n[5/5] 迁移：跳过（预检模式）')
      const needCreate = missing.length > 0
      console.log('\n' + '─'.repeat(72))
      if (needCreate) {
        console.log('下一步：node scripts/migrate-to-rds.mjs --apply    （将先建表，再迁移数据）')
      } else {
        console.log('下一步：node scripts/migrate-to-rds.mjs --apply    （将迁移数据）')
      }
      console.log('─'.repeat(72))
      return
    }

    console.log('\n[5/5] 迁移数据（按外键依赖顺序，幂等写入）')
    let grandTotal = 0
    for (const { table } of plan) {
      const [rows] = await source.pool.query(`SELECT * FROM ${table}`)
      if (!rows.length) {
        console.log(`  ${table.padEnd(24)} 无数据，跳过`)
        continue
      }
      const columns = Object.keys(rows[0])
      const colList = columns.map((c) => `\`${c}\``).join(',')
      const placeholders = `(${columns.map(() => '?').join(',')})`
      // 冲突时以源库为准覆盖（主键与唯一键本身不更新）
      const skip = new Set(['id', 'token_hash', 'email'])
      const updateCols = columns.filter((c) => !skip.has(c))
      const updates = updateCols.length
        ? updateCols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')
        : `\`${columns[0]}\` = \`${columns[0]}\``
      const sql = `INSERT INTO ${table} (${colList}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`

      let written = 0
      for (const row of rows) {
        const values = columns.map((c) => row[c])
        await target.pool.execute(sql, values)
        written += 1
      }
      grandTotal += written
      console.log(`  ${table.padEnd(24)} 已写入 ${written} 行`)
    }

    console.log('\n' + '═'.repeat(72))
    console.log(`迁移完成，共写入 ${grandTotal} 行。`)
    console.log('═'.repeat(72))
    console.log('\n迁移后目标库数据量：')
    for (const t of TABLES) {
      const n = await countRows(target.pool, t)
      console.log(`  ${t.padEnd(24)} ${n === null ? '-' : n} 行`)
    }
  } finally {
    await source.pool.end()
    await target.pool.end()
  }
}

main().catch((error) => {
  console.error('\n迁移失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
