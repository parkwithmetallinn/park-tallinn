/**
 * Community parking reports — Supabase `parking_reports` table.
 *
 * POST { parkingId, statusType, comment }
 *   → insert row; rate-limit 3 posts / 2 minutes per client IP
 *
 * GET → JSON array (last 45 min, grouped by parking_id):
 *   [{ parkingId, isFull, lastReportedMinutesAgo }]
 *
 * Env: SUPABASE_URL + SUPABASE_ANON_KEY (or VITE_* aliases).
 * Without Supabase, uses an in-memory fallback (local/dev).
 */

const WINDOW_MS = 45 * 60 * 1000
const RATE_WINDOW_MS = 2 * 60 * 1000
const RATE_MAX = 3
const COMMENT_MAX = 150
const TABLE = 'parking_reports'

/** Normalize UI / legacy status → DB status_type (UPPER). */
const STATUS_MAP = {
  full: 'FULL',
  FULL: 'FULL',
  prices: 'PRICES',
  PRICES: 'PRICES',
  closed: 'CLOSED',
  CLOSED: 'CLOSED',
}

/**
 * In-memory fallback + rate buckets (per serverless isolate).
 * @type {Map<string, { parkingId: string, statusType: string, comment: string, clientIp: string, createdAt: number }>}
 */
const memStore =
  globalThis.__parkReportsMem instanceof Map
    ? globalThis.__parkReportsMem
    : new Map()
globalThis.__parkReportsMem = memStore

/** @type {Map<string, number[]>} */
const rateBuckets =
  globalThis.__parkReportsRate instanceof Map
    ? globalThis.__parkReportsRate
    : new Map()
globalThis.__parkReportsRate = rateBuckets

function supabaseEnv() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()
  return { url: url.replace(/\/$/, ''), key }
}

function hasSupabase() {
  const { url, key } = supabaseEnv()
  return Boolean(url && key)
}

function restHeaders(extra = {}) {
  const { key } = supabaseEnv()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function clientIp(req) {
  const xf = req.headers?.['x-forwarded-for']
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim()
  const real = req.headers?.['x-real-ip']
  if (typeof real === 'string' && real.length) return real.trim()
  return req.socket?.remoteAddress || 'unknown'
}

function parseBody(req) {
  let body = req.body
  if (body == null || body === '') return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  if (typeof body === 'object' && !Array.isArray(body)) return body
  return null
}

function normalizeStatus(raw) {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  return STATUS_MAP[t] || STATUS_MAP[t.toUpperCase()] || STATUS_MAP[t.toLowerCase()] || null
}

/** Best-effort in-memory rate limit (always applied). */
function checkRateLimit(ip, now = Date.now()) {
  const cutoff = now - RATE_WINDOW_MS
  let hits = rateBuckets.get(ip) || []
  hits = hits.filter((t) => t > cutoff)
  if (hits.length >= RATE_MAX) {
    rateBuckets.set(ip, hits)
    return false
  }
  hits.push(now)
  rateBuckets.set(ip, hits)
  return true
}

async function countRecentByIp(ip, now = Date.now()) {
  if (!hasSupabase() || !ip || ip === 'unknown') return 0
  const { url } = supabaseEnv()
  const since = new Date(now - RATE_WINDOW_MS).toISOString()
  const q = new URLSearchParams({
    select: 'id',
    client_ip: `eq.${ip}`,
    created_at: `gt.${since}`,
  })
  try {
    const res = await fetch(`${url}/rest/v1/${TABLE}?${q}`, {
      method: 'GET',
      headers: {
        ...restHeaders(),
        Prefer: 'count=exact',
        Range: '0-0',
      },
    })
    const range = res.headers.get('content-range') // e.g. 0-0/4
    if (range && range.includes('/')) {
      const total = Number(range.split('/')[1])
      if (Number.isFinite(total)) return total
    }
    if (!res.ok) return 0
    const rows = await res.json()
    return Array.isArray(rows) ? rows.length : 0
  } catch {
    return 0
  }
}

async function insertReport(row) {
  if (!hasSupabase()) {
    const id = `${row.parkingId}:${row.createdAt}:${Math.random().toString(36).slice(2, 8)}`
    memStore.set(id, row)
    // prune older than 45m
    const cutoff = Date.now() - WINDOW_MS
    for (const [k, v] of memStore) {
      if (v.createdAt < cutoff) memStore.delete(k)
    }
    return { ok: true, fallback: true }
  }

  const { url } = supabaseEnv()
  const payload = {
    parking_id: row.parkingId,
    status_type: row.statusType,
    comment: row.comment || null,
    client_ip: row.clientIp || null,
  }

  let res = await fetch(`${url}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  })

  // Retry without client_ip if column missing (PGRST204 / 400)
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    const { client_ip: _drop, ...withoutIp } = payload
    res = await fetch(`${url}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: restHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(withoutIp),
    })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      status: res.status,
      message: text.slice(0, 200) || 'Andmebaasi salvestamine ebaõnnestus',
    }
  }
  return { ok: true }
}

/**
 * Fetch last-45-min rows and group by parking_id.
 * @returns {Promise<Array<{ parkingId: string, isFull: boolean, lastReportedMinutesAgo: number }>>}
 */
async function listGrouped(now = Date.now()) {
  const sinceIso = new Date(now - WINDOW_MS).toISOString()
  /** @type {Array<{ parking_id: string, status_type: string, created_at: string }>} */
  let rows = []

  if (hasSupabase()) {
    const { url } = supabaseEnv()
    const q = new URLSearchParams({
      select: 'parking_id,status_type,created_at',
      created_at: `gt.${sinceIso}`,
      order: 'created_at.desc',
    })
    try {
      const res = await fetch(`${url}/rest/v1/${TABLE}?${q}`, {
        method: 'GET',
        headers: restHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) rows = data
      }
    } catch {
      rows = []
    }
  } else {
    const cutoff = now - WINDOW_MS
    for (const v of memStore.values()) {
      if (v.createdAt >= cutoff) {
        rows.push({
          parking_id: v.parkingId,
          status_type: v.statusType,
          created_at: new Date(v.createdAt).toISOString(),
        })
      }
    }
  }

  /** @type {Map<string, { isFull: boolean, latestMs: number }>} */
  const byLot = new Map()
  for (const r of rows) {
    const id = String(r.parking_id || '').trim()
    if (!id) continue
    const createdMs = Date.parse(r.created_at)
    if (!Number.isFinite(createdMs)) continue
    const status = String(r.status_type || '').toUpperCase()
    const prev = byLot.get(id)
    if (!prev) {
      byLot.set(id, {
        isFull: status === 'FULL',
        latestMs: createdMs,
      })
    } else {
      if (status === 'FULL') prev.isFull = true
      if (createdMs > prev.latestMs) prev.latestMs = createdMs
    }
  }

  const out = []
  for (const [parkingId, agg] of byLot) {
    const mins = Math.max(0, Math.round((now - agg.latestMs) / 60_000))
    out.push({
      parkingId,
      isFull: agg.isFull,
      lastReportedMinutesAgo: mins,
    })
  }
  // Newest reports first
  out.sort((a, b) => a.lastReportedMinutesAgo - b.lastReportedMinutesAgo)
  return out
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(204).end()
    return
  }

  if (req.method === 'GET') {
    try {
      const reports = await listGrouped()
      // Contract: bare JSON array
      res.status(200).json(reports)
    } catch {
      res.status(500).json([])
    }
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' })
    return
  }

  const body = parseBody(req)
  if (!body) {
    res.status(400).json({ success: false, message: 'Vigane päring' })
    return
  }

  const parkingId = String(body.parkingId || body.spotId || '').trim()
  if (!parkingId || parkingId.length > 128) {
    res.status(400).json({ success: false, message: 'Vigane päring' })
    return
  }

  // Legacy { spotId, isFull: true } → FULL
  let statusType = normalizeStatus(body.statusType)
  if (!statusType && body.isFull === true) statusType = 'FULL'
  if (!statusType && body.isFull === false) {
    res.status(400).json({ success: false, message: 'Vigane päring' })
    return
  }
  if (!statusType) {
    res.status(400).json({ success: false, message: 'Vigane päring' })
    return
  }

  const comment =
    typeof body.comment === 'string' ? body.comment.trim().slice(0, COMMENT_MAX) : ''

  const ip = clientIp(req)
  const now = Date.now()

  // Dual rate limit: memory + Supabase count when available
  if (!checkRateLimit(ip, now)) {
    res.status(429).json({
      success: false,
      message: 'Liiga palju teavitusi — proovi 2 minuti pärast uuesti',
    })
    return
  }
  const dbCount = await countRecentByIp(ip, now)
  if (dbCount >= RATE_MAX) {
    res.status(429).json({
      success: false,
      message: 'Liiga palju teavitusi — proovi 2 minuti pärast uuesti',
    })
    return
  }

  const row = {
    parkingId,
    statusType,
    comment,
    clientIp: ip,
    createdAt: now,
  }

  const inserted = await insertReport(row)
  if (!inserted.ok) {
    res.status(502).json({
      success: false,
      message: inserted.message || 'Andmebaasi salvestamine ebaõnnestus',
    })
    return
  }

  const reports = await listGrouped(now)
  res.status(200).json({
    success: true,
    message: 'Aitäh! Sinu teavitus aitab teisi autojuhte.',
    reports,
  })
}
