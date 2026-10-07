/**
 * Community parking reports (isFull alerts).
 * In-memory store with 60-minute TTL — shared across warm isolates via globalThis.
 *
 * GET  /api/reports → { success, reports: [{ spotId, isFull, lat?, lng?, until }] }
 * POST /api/reports → body { spotId, isFull?, lat?, lng? }
 */

const TTL_MS = 60 * 60 * 1000
const MAX_REPORTS = 2_000

/** @type {Map<string, { spotId: string, isFull: boolean, lat?: number, lng?: number, until: number }>} */
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
    if (row.isFull) {
      reports.push({
        spotId: row.spotId,
        isFull: true,
        lat: row.lat,
        lng: row.lng,
        until: row.until,
      })
    }
  }
  return reports
}

function upsert(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Vigane päring' }
  }
  const spotId = String(body.spotId || body.id || '').trim()
  if (!spotId || spotId.length > 128) {
    return { ok: false, message: 'Vigane päring' }
  }
  const isFull = body.isFull !== false
  if (!isFull) {
    store.delete(spotId)
    return { ok: true, reports: listActive(now) }
  }
  const lat =
    typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : undefined
  const lng =
    typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : undefined
  store.set(spotId, {
    spotId,
    isFull: true,
    lat,
    lng,
    until: now + TTL_MS,
  })
  prune(now)
  return { ok: true, reports: listActive(now) }
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
    res.status(200).json({ success: true, reports: listActive() })
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
  res.status(200).json({ success: true, reports: result.reports })
}
