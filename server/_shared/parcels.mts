import { createHash, randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, readLocalRecord, storageProvider, writeLocalRecord } from './storage.mjs'
import type { Kuaidi100Pickup, Kuaidi100TrackingCandidate, Kuaidi100TrackingDetail, Kuaidi100Trace } from './kuaidi100.mjs'

export type StoredParcel = {
  id: string
  carrier: string
  short: string
  color: string
  pale: string
  tracking: string
  title: string
  route: string
  status: '待取件' | '运输中' | '已完成'
  eta: string
  updated: string
  location: string
  code?: string
  spot?: string
  events: Array<{ time: string; title: string; text: string; active?: boolean; location?: string; lat?: number; lng?: number }>
}

type ParcelRow = {
  id: string
  user_id: string
  tracking_no: string
  carrier_code: string | null
  carrier_name: string | null
  status: StoredParcel['status']
  status_detail: string | null
  location: string | null
  pickup_code: string | null
  pickup_location: string | null
  eta: string | null
  last_synced_at: string
}

type EventRow = {
  id?: string
  parcel_id: string
  event_key?: string
  event_at: string | null
  title: string
  description: string
  location: string | null
  latitude: number | null
  longitude: number | null
}

type MysqlParcelRow = ParcelRow & RowDataPacket
type MysqlEventRow = EventRow & RowDataPacket

type LocalParcelRecord = {
  row: ParcelRow
  events: EventRow[]
}

const CARRIER_STYLE: Record<string, Pick<StoredParcel, 'carrier' | 'short' | 'color' | 'pale'>> = {
  shunfeng: { carrier: '顺丰速运', short: '顺丰', color: '#ed6b4d', pale: '#fff0ea' },
  jd: { carrier: '京东物流', short: '京东', color: '#4a6ff0', pale: '#edf2ff' },
  zto: { carrier: '中通快递', short: '中通', color: '#1d9f73', pale: '#e9faf3' },
  yto: { carrier: '圆通速递', short: '圆通', color: '#f0a334', pale: '#fff6e4' },
  yunda: { carrier: '韵达快递', short: '韵达', color: '#7659d6', pale: '#f1edff' },
  sto: { carrier: '申通快递', short: '申通', color: '#ef7c35', pale: '#fff0e7' },
  ems: { carrier: 'EMS', short: 'EMS', color: '#2b7bb9', pale: '#eaf5fd' },
  jtexpress: { carrier: '极兔速递', short: '极兔', color: '#e95c72', pale: '#fff0f3' },
  deppon: { carrier: '德邦快递', short: '德邦', color: '#3193bf', pale: '#eaf7fc' },
  best: { carrier: '百世快递', short: '百世', color: '#e5a52f', pale: '#fff8e5' },
  youshunda: { carrier: '优速快递', short: '优速', color: '#6b61ca', pale: '#f1efff' },
  anep: { carrier: '安能物流', short: '安能', color: '#e06e3a', pale: '#fff0e8' },
  china_post: { carrier: '中国邮政', short: '邮政', color: '#cf4e4e', pale: '#fff0f0' },
  zjs: { carrier: '宅急送', short: '宅急送', color: '#d96e3e', pale: '#fff1eb' },
}

function displayTime(value?: string | null): string {
  if (!value) return '刚刚'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return value
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time))
}

function eventTime(value?: string | null): string {
  if (!value) return '刚刚'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time))
}

function styleFor(code: string | null, name: string | null): Pick<StoredParcel, 'carrier' | 'short' | 'color' | 'pale'> {
  const normalized = (code ?? '').toLowerCase()
  if (CARRIER_STYLE[normalized]) return CARRIER_STYLE[normalized]
  const carrier = name || code || '快递服务'
  return { carrier, short: carrier.slice(0, 2), color: '#667785', pale: '#eef2f4' }
}

// 兜底：上游历史上曾把状态码（纯数字）写进 status_detail。
// 这里做一层防护，避免把裸数字当成文案展示给用户。
function readableDetail(status: StoredParcel['status'], detail: string | null): string {
  const text = (detail ?? '').trim()
  if (text && !/^\d+$/.test(text)) return text
  if (status === '已完成') return '包裹已签收'
  if (status === '待取件') return '包裹已到站，等待取件'
  return '包裹运输中'
}

function parcelFromRow(row: ParcelRow, events: EventRow[]): StoredParcel {
  const style = styleFor(row.carrier_code, row.carrier_name)
  const parcelEvents = events.map((event, index) => ({
    time: eventTime(event.event_at),
    title: event.title,
    text: event.location ? `${event.description} · ${event.location}` : event.description,
    active: index === 0,
    ...(event.location ? { location: event.location } : {}),
    ...(event.latitude !== null ? { lat: Number(event.latitude) } : {}),
    ...(event.longitude !== null ? { lng: Number(event.longitude) } : {}),
  }))
  return {
    id: row.id,
    ...style,
    tracking: row.tracking_no,
    title: row.carrier_name ? `${row.carrier_name}包裹` : '快递包裹',
    route: readableDetail(row.status, row.status_detail),
    status: row.status,
    eta: row.eta || (row.status === '已完成' ? '已签收' : row.status === '待取件' ? '等待取件' : '运输中'),
    updated: displayTime(row.last_synced_at),
    location: row.location || '暂未返回当前位置',
    ...(row.pickup_code ? { code: row.pickup_code } : {}),
    ...(row.pickup_location ? { spot: row.pickup_location } : {}),
    events: parcelEvents.length ? parcelEvents : [{ time: displayTime(row.last_synced_at), title: '物流信息已同步', text: readableDetail(row.status, row.status_detail), active: true }],
  }
}

function dateOrNull(value?: string | null): Date | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time)
}

function eventKey(eventAt: string | null, title: string, description: string): string {
  return createHash('sha256').update(`${eventAt ?? ''}\n${title}\n${description}`, 'utf8').digest('hex')
}

function eventFromTrace(parcelId: string, trace: Kuaidi100Trace): EventRow {
  const eventAt = trace.occurredAt ? new Date(trace.occurredAt).toISOString() : null
  return {
    id: randomUUID(),
    parcel_id: parcelId,
    event_key: eventKey(eventAt, trace.title, trace.description),
    event_at: eventAt,
    title: trace.title,
    description: trace.description,
    location: trace.location ?? null,
    latitude: trace.latitude ?? null,
    longitude: trace.longitude ?? null,
  }
}

async function listLocal(userId: string): Promise<StoredParcel[]> {
  const records = await readLocalRecord<LocalParcelRecord[]>(`parcels:${userId}`) ?? []
  return records
    .sort((a, b) => Date.parse(b.row.last_synced_at) - Date.parse(a.row.last_synced_at))
    .map((record) => parcelFromRow(record.row, record.events))
}

export async function listParcels(userId: string): Promise<StoredParcel[]> {
  if (storageProvider() === 'local') return listLocal(userId)
  const pool = getMysqlPool()
  const [rows] = await pool.query<MysqlParcelRow[]>(
    `SELECT id,user_id,tracking_no,carrier_code,carrier_name,status,status_detail,location,
            pickup_code,pickup_location,eta,last_synced_at
     FROM yijian_parcels WHERE user_id = ? ORDER BY last_synced_at DESC`,
    [userId],
  )
  if (!rows.length) return []
  const parcelIds = rows.map((row) => row.id)
  const [events] = await pool.query<MysqlEventRow[]>(
    `SELECT id,parcel_id,event_key,event_at,title,description,location,latitude,longitude
     FROM yijian_parcel_events WHERE parcel_id IN (?) ORDER BY event_at DESC, id DESC`,
    [parcelIds],
  )
  const byParcel = new Map<string, EventRow[]>()
  for (const event of events) {
    const current = byParcel.get(event.parcel_id) ?? []
    current.push(event)
    byParcel.set(event.parcel_id, current)
  }
  return rows.map((row) => parcelFromRow(row, byParcel.get(row.id) ?? []))
}

export async function confirmParcelPickup(userId: string, parcelId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const title = '用户已确认取件'
  const description = '取件码已按隐私策略删除。'
  if (storageProvider() === 'local') {
    const key = `parcels:${userId}`
    const records = await readLocalRecord<LocalParcelRecord[]>(key) ?? []
    const record = records.find((item) => item.row.id === parcelId)
    if (!record) return false
    record.row = {
      ...record.row,
      status: '已完成',
      status_detail: title,
      location: '已从驿站取出',
      pickup_code: null,
      pickup_location: null,
      eta: '已取件',
      last_synced_at: now,
    }
    record.events.unshift({
      id: randomUUID(),
      parcel_id: parcelId,
      event_key: eventKey(now, title, description),
      event_at: now,
      title,
      description,
      location: '已从驿站取出',
      latitude: null,
      longitude: null,
    })
    await writeLocalRecord(key, records)
    return true
  }

  const connection = await getMysqlPool().getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE yijian_parcels
       SET status = '已完成', status_detail = ?, location = '已从驿站取出',
           pickup_code = NULL, pickup_location = NULL, eta = '已取件',
           updated_at = UTC_TIMESTAMP(3), last_synced_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND user_id = ?`,
      [title, parcelId, userId],
    )
    if (result.affectedRows === 0) {
      await connection.rollback()
      return false
    }
    await connection.execute<ResultSetHeader>(
      `INSERT INTO yijian_parcel_events
        (id,parcel_id,event_key,event_at,title,description,location,latitude,longitude)
       VALUES (?,?,?,?,?,?,?,NULL,NULL)
       ON DUPLICATE KEY UPDATE event_at = VALUES(event_at)`,
      [randomUUID(), parcelId, eventKey(now, title, description), new Date(now), title, description, '已从驿站取出'],
    )
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function saveParcel(userId: string, candidate: Kuaidi100TrackingCandidate, detail: Kuaidi100TrackingDetail, pickup: Kuaidi100Pickup = {}): Promise<void> {
  const now = new Date().toISOString()
  const carrierCode = detail.carrierCode ?? candidate.carrierCode ?? ''
  const carrierName = detail.carrierName ?? candidate.carrierName ?? null
  const eventRows = detail.traces.map((trace) => eventFromTrace('', trace))

  if (storageProvider() === 'local') {
    const key = `parcels:${userId}`
    const records = await readLocalRecord<LocalParcelRecord[]>(key) ?? []
    const existing = records.find((item) => item.row.tracking_no === candidate.trackingNo && item.row.carrier_code === carrierCode)
    const id = existing?.row.id ?? randomUUID()
    const row: ParcelRow = {
      id,
      user_id: userId,
      tracking_no: candidate.trackingNo,
      carrier_code: carrierCode,
      carrier_name: carrierName,
      status: detail.status === '已完成' || detail.status === '待取件' ? detail.status : '运输中',
      status_detail: detail.statusDetail ?? null,
      location: detail.location ?? null,
      pickup_code: pickup.code ?? null,
      pickup_location: pickup.location ?? null,
      eta: detail.eta ?? null,
      last_synced_at: now,
    }
    const nextEvents = [...(existing?.events ?? []), ...eventRows.map((event) => ({ ...event, parcel_id: id }))]
    const uniqueEvents = Array.from(new Map(nextEvents.map((event) => [event.event_key ?? eventKey(event.event_at, event.title, event.description), event])).values())
    const next: LocalParcelRecord = { row, events: uniqueEvents }
    const nextRecords = existing ? records.map((item) => item === existing ? next : item) : [...records, next]
    await writeLocalRecord(key, nextRecords)
    return
  }

  const connection = await getMysqlPool().getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute<ResultSetHeader>(
      `INSERT INTO yijian_parcels
        (id,user_id,tracking_no,carrier_code,carrier_name,status,status_detail,location,
         pickup_code,pickup_location,eta,last_synced_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
        carrier_name = VALUES(carrier_name), status = VALUES(status), status_detail = VALUES(status_detail),
        location = VALUES(location), pickup_code = VALUES(pickup_code), pickup_location = VALUES(pickup_location),
        eta = VALUES(eta), last_synced_at = VALUES(last_synced_at), updated_at = UTC_TIMESTAMP(3)`,
      [randomUUID(), userId, candidate.trackingNo, carrierCode, carrierName, detail.status, detail.statusDetail ?? null, detail.location ?? null, pickup.code ?? null, pickup.location ?? null, detail.eta ?? null, new Date(now)],
    )
    const [parcelRows] = await connection.query<MysqlParcelRow[]>(
      `SELECT id,user_id,tracking_no,carrier_code,carrier_name,status,status_detail,location,
              pickup_code,pickup_location,eta,last_synced_at
       FROM yijian_parcels WHERE user_id = ? AND tracking_no = ? AND carrier_code = ? LIMIT 1`,
      [userId, candidate.trackingNo, carrierCode],
    )
    const parcel = parcelRows[0]
    if (!parcel) throw new Error('包裹保存后无法读取记录')
    for (const event of eventRows) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO yijian_parcel_events
          (id,parcel_id,event_key,event_at,title,description,location,latitude,longitude)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE location = VALUES(location), latitude = VALUES(latitude), longitude = VALUES(longitude)`,
        [event.id ?? randomUUID(), parcel.id, event.event_key ?? eventKey(event.event_at, event.title, event.description), dateOrNull(event.event_at), event.title, event.description, event.location, event.latitude, event.longitude],
      )
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}



