/**
 * Community parking reports.
 *
 * GET  /api/reports → { success, reports: [...] }
 * POST /api/reports → body either:
 *   Legacy: { spotId, isFull?, lat?, lng? }
 *   Crowd:  { parkingId, statusType, comment?, lat?, lng? }
 *
 * When SUPABASE_URL + SUPABASE_ANON_KEY (or VITE_*) are set, inserts into
 * public.community_reports. Always mirrors isFull alerts in memory for the map.
 */

const TTL_MS = 60 * 60 * 1000
const MAX_REPORTS = 2_000
const STATUS_TYPES = new Set(['full', 'prices', 'closed'])

/** @type {Map<string, { spotId: string, isFull: boolean, statusType?: string, comment?: string, lat?: number, lng?: number, until: number }>} */
const store =
  globalThis.__parkCommunityReports instanceof Map
    ? globalThis.__parkCommunityReports
    : new Map()
globalThis.__parkCommunityReports = store

function prune(now = Date.now()) {
  for (const [id, row] of store) {
    if (!row || row.until <= now) store.delete(id)
  }
  if (store.size > MAX_REPORTS) {
    const sorted = [...store.entries()].sort((a, b) => a[1].until - b[1].until)
    const drop = sorted.length - MAX_REPORTS
    for (let i = 0; i < drop; i++) store.delete(sorted[i][0])
  }
}

function listActive(now = Date.now()) {
  prune(now)
  const reports = []
  for (const row of store.values()) {
    reports.push({
      spotId: row.spotId,
      parkingId: row.spotId,
      isFull: Boolean(row.isFull),
      statusType: row.statusType || (row.isFull ? 'full' : undefined),
      comment: row.comment,
      lat: row.lat,
      lng: row.lng,
      until: row.until,
    })
  }
  return reports
}

function supabaseEnv() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  return { url: url.trim(), key: key.trim() }
}

async function insertSupabase(row) {
  const { url, key } = supabaseEnv()
  if (!url || !key) return { ok: true, skipped: true }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/community_reports`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        parking_id: row.spotId,
        status_type: row.statusType || 'full',
        comment: row.comment || null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        is_full: Boolean(row.isFull),
      }),
    })
    if (!res.ok) {
      // Table may not exist yet — memory store still works
      return { ok: false, status: res.status }
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

function upsert(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Vigane päring' }
  }

  const parkingId = String(
    body.parkingId || body.spotId || body.id || '',
  ).trim()
  if (!parkingId || parkingId.length > 128) {
    return { ok: false, message: 'Vigane päring' }
  }

  let statusType =
    typeof body.statusType === 'string' ? body.statusType.trim() : ''
  if (statusType && !STATUS_TYPES.has(statusType)) {
    return { ok: false, message: 'Vigane päring' }
  }

  // Legacy boolean path
  if (!statusType) {
    if (body.isFull === false) {
      store.delete(parkingId)
      return { ok: true, reports: listActive(now) }
    }
    statusType = 'full'
  }

  const commentRaw =
    typeof body.comment === 'string' ? body.comment.trim().slice(0, 150) : ''
  const isFull = statusType === 'full' || statusType === 'closed'
  const lat =
    typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : undefined
  const lng =
    typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : undefined

  const row = {
    spotId: parkingId,
    isFull,
    statusType,
    comment: commentRaw || undefined,
    lat,
    lng,
    until: now + TTL_MS,
  }

  // Map pulse only for full/closed; prices updates stay in list without isFull pin
  if (isFull) {
    store.set(parkingId, row)
  } else {
    store.set(`${parkingId}:${statusType}:${now}`, row)
  }
  prune(now)

  return { ok: true, reports: listActive(now), row }
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
    res.status(200).json({
      success: true,
      reports: listActive().filter((r) => r.isFull),
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({ success: false, message: 'Vigane päring' })
      return
    }
  }

  const result = upsert(body)
  if (!result.ok) {
    res.status(400).json({ success: false, message: result.message })
    return
  }

  if (result.row) {
    await insertSupabase(result.row)
  }

  res.status(200).json({
    success: true,
    message: 'Aitäh! Sinu teavitus aitab teisi autojuhte.',
    reports: result.reports.filter((r) => r.isFull),
  })
}
