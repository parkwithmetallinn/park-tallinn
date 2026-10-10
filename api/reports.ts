/**
 * Hardened community parking reports (spot is full / free).
 *
 * POST { parkingId, statusType, comment? }
 * GET  → [{ parkingId, isFull, status, lastReportedMinutesAgo }]
 *
 * Server-only: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ REPORT_SALT).
 * Browser talks only to /api/reports — never the anon key.
 * Mem fallback is DEV ONLY — production returns 503 when DB is unavailable.
 */

import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const MIN_FULL_VOTES = 2
const WINDOW_MS = 45 * 60 * 1000
const RATE_WINDOW_MS = 2 * 60 * 1000
const RATE_MAX = 3
/** Same user + same lot + same status — reject for 5 min (matches client cooldown). */
const DUP_WINDOW_MS = 5 * 60 * 1000
const COMMENT_MAX = 200
const GET_LIMIT = 2000
const TABLE = 'parking_reports'
// Slash allowed so OSM-style ids (w/123, way/…) match map spot.id without map changes.
const PARKING_ID_RE = /^[A-Za-z0-9_/-]{1,64}$/

/** Statuses the app accepts — PRICES/CLOSED are rejected (400). */
const ALLOWED_STATUS = new Set(['FULL', 'FREE'])

type ReportRow = {
  parking_id: string
  status_type: string
  client_hash: string
  created_at: string
}

type MemRow = {
  parkingId: string
  statusType: string
  clientHash: string
  createdAt: number
}

export type ReportLotStatus = 'FULL' | 'FREE' | 'UNKNOWN'

export type GroupedReport = {
  parkingId: string
  isFull: boolean
  status: ReportLotStatus
  lastReportedMinutesAgo: number
}

type ApiReq = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  socket?: { remoteAddress?: string }
}

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void
    end: (body?: unknown) => void
  }
  setHeader: (name: string, value: string) => void
}

class DbUnavailableError extends Error {
  constructor() {
    super('DB_UNAVAILABLE')
    this.name = 'DbUnavailableError'
  }
}

const memStore: Map<string, MemRow> =
  ((globalThis as { __parkReportsMemV2?: Map<string, MemRow> }).__parkReportsMemV2 ??=
    new Map())

function isProduction(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
  )
}

function getServiceClient(): SupabaseClient | null {
  const url = String(process.env.SUPABASE_URL ?? '').trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function headerValue(
  headers: ApiReq['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === 'string' ? raw : undefined
}

function firstForwardedIp(req: ApiReq): string {
  const xf = headerValue(req.headers, 'x-forwarded-for')
  if (xf && xf.trim()) return xf.split(',')[0]!.trim()
  const real = headerValue(req.headers, 'x-real-ip')
  if (real && real.trim()) return real.trim()
  return req.socket?.remoteAddress?.trim() || 'unknown'
}

function clientHash(req: ApiReq): string {
  const salt = String(process.env.REPORT_SALT ?? '').trim()
  const ip = firstForwardedIp(req)
  return createHash('sha256').update(`${ip}${salt}`, 'utf8').digest('hex')
}

function parseBody(req: ApiReq): Record<string, unknown> | null {
  let body = req.body
  if (body == null || body === '') return null
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body) as unknown
    } catch {
      return null
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

function sanitizeComment(raw: unknown): string | null {
  if (raw == null || raw === '') return ''
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .trim()
    // Strip ASCII control chars (incl. newlines → space) then re-trim
    // eslint-disable-next-line no-control-regex -- intentional control-char strip
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length > COMMENT_MAX) return null
  return cleaned
}

export function normalizeStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toUpperCase()
  if (ALLOWED_STATUS.has(t)) return t
  // PRICES / CLOSED intentionally rejected — do not map to FREE
  return null
}

/** Insert payload never includes user comment text (privacy). */
export function reportInsertRow(input: {
  parkingId: string
  statusType: string
  clientHash: string
}): {
  parking_id: string
  status_type: string
  comment: null
  client_hash: string
} {
  return {
    parking_id: input.parkingId,
    status_type: input.statusType,
    comment: null,
    client_hash: input.clientHash,
  }
}

function badRequest(res: ApiRes, message: string) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(400).json({ success: false, message })
}

function serviceUnavailable(res: ApiRes) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(503).json({
    success: false,
    message: 'Teenus pole hetkel saadaval',
  })
}

function pruneMem(now = Date.now()) {
  const cutoff = now - WINDOW_MS
  for (const [k, v] of memStore) {
    if (v.createdAt < cutoff) memStore.delete(k)
  }
}

async function countRecentByHash(
  sb: SupabaseClient | null,
  hash: string,
  windowMs: number,
  now: number,
): Promise<number> {
  const since = new Date(now - windowMs).toISOString()
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    pruneMem(now)
    let n = 0
    for (const row of memStore.values()) {
      if (row.clientHash === hash && row.createdAt >= now - windowMs) n += 1
    }
    return n
  }
  const { count, error } = await sb
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('client_hash', hash)
    .gt('created_at', since)
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    return countRecentByHash(null, hash, windowMs, now)
  }
  return count ?? 0
}

async function hasDuplicateReport(
  sb: SupabaseClient | null,
  hash: string,
  parkingId: string,
  statusType: string,
  now: number,
): Promise<boolean> {
  const since = new Date(now - DUP_WINDOW_MS).toISOString()
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    for (const row of memStore.values()) {
      if (
        row.clientHash === hash &&
        row.parkingId === parkingId &&
        row.statusType === statusType &&
        row.createdAt >= now - DUP_WINDOW_MS
      ) {
        return true
      }
    }
    return false
  }
  const { count, error } = await sb
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('client_hash', hash)
    .eq('parking_id', parkingId)
    .eq('status_type', statusType)
    .gt('created_at', since)
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    return hasDuplicateReport(null, hash, parkingId, statusType, now)
  }
  return (count ?? 0) > 0
}

async function insertReport(
  sb: SupabaseClient | null,
  row: {
    parkingId: string
    statusType: string
    clientHash: string
    createdAt: number
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    const id = `${row.clientHash}:${row.parkingId}:${row.createdAt}`
    memStore.set(id, {
      parkingId: row.parkingId,
      statusType: row.statusType,
      clientHash: row.clientHash,
      createdAt: row.createdAt,
    })
    pruneMem(row.createdAt)
    return { ok: true }
  }

  const payload = reportInsertRow({
    parkingId: row.parkingId,
    statusType: row.statusType,
    clientHash: row.clientHash,
  })
  const { error } = await sb.from(TABLE).insert(payload)
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    // Dev only — mem fallback
    return insertReport(null, row)
  }
  return { ok: true }
}

async function fetchRecentRows(
  sb: SupabaseClient | null,
  now: number,
): Promise<ReportRow[]> {
  const sinceIso = new Date(now - WINDOW_MS).toISOString()
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    pruneMem(now)
    const out: ReportRow[] = []
    for (const v of memStore.values()) {
      if (v.createdAt >= now - WINDOW_MS) {
        out.push({
          parking_id: v.parkingId,
          status_type: v.statusType,
          client_hash: v.clientHash,
          created_at: new Date(v.createdAt).toISOString(),
        })
      }
    }
    out.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )
    return out.slice(0, GET_LIMIT)
  }

  const { data, error } = await sb
    .from(TABLE)
    .select('parking_id,status_type,client_hash,created_at')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(GET_LIMIT)

  if (error || !Array.isArray(data)) {
    if (isProduction()) throw new DbUnavailableError()
    return fetchRecentRows(null, now)
  }
  return data as ReportRow[]
}

/**
 * Per parking_id keep only the LATEST report of each voter (client_hash),
 * then tally FULL vs FREE votes.
 */
export function groupReports(rows: ReportRow[], now: number): GroupedReport[] {
  /** parkingId → (clientHash → latest row) */
  const perLot = new Map<string, Map<string, ReportRow>>()

  for (const r of rows) {
    const parkingId = String(r.parking_id ?? '').trim()
    const hash = String(r.client_hash ?? '').trim()
    if (!parkingId || !hash) continue
    const createdMs = Date.parse(r.created_at)
    if (!Number.isFinite(createdMs)) continue

    let voters = perLot.get(parkingId)
    if (!voters) {
      voters = new Map()
      perLot.set(parkingId, voters)
    }
    const prev = voters.get(hash)
    if (!prev || createdMs > Date.parse(prev.created_at)) {
      voters.set(hash, r)
    }
  }

  const out: GroupedReport[] = []
  for (const [parkingId, voters] of perLot) {
    let fullVotes = 0
    let freeVotes = 0
    let latestMs = 0
    for (const vote of voters.values()) {
      const status = String(vote.status_type ?? '').toUpperCase()
      const ms = Date.parse(vote.created_at)
      if (Number.isFinite(ms) && ms > latestMs) latestMs = ms
      if (status === 'FULL') fullVotes += 1
      else if (status === 'FREE') freeVotes += 1
    }
    const isFull =
      fullVotes >= MIN_FULL_VOTES && fullVotes > freeVotes
    let lotStatus: ReportLotStatus = 'UNKNOWN'
    if (isFull) lotStatus = 'FULL'
    else if (freeVotes >= 1 && freeVotes >= fullVotes) lotStatus = 'FREE'
    out.push({
      parkingId,
      isFull,
      status: lotStatus,
      lastReportedMinutesAgo: Math.max(
        0,
        Math.round((now - latestMs) / 60_000),
      ),
    })
  }

  out.sort((a, b) => a.lastReportedMinutesAgo - b.lastReportedMinutesAgo)
  return out
}

function reportSaltOk(): boolean {
  const salt = String(process.env.REPORT_SALT ?? '').trim()
  return salt.length >= 16
}

export default async function handler(req: ApiReq, res: ApiRes): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase()

  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.setHeader('Cache-Control', 'no-store')
    res.status(405).json({ success: false, message: 'Method not allowed' })
    return
  }

  if (isProduction() && !reportSaltOk()) {
    serviceUnavailable(res)
    return
  }

  const sb = getServiceClient()
  const now = Date.now()

  if (method === 'GET') {
    try {
      if (isProduction() && !sb) {
        serviceUnavailable(res)
        return
      }
      const rows = await fetchRecentRows(sb, now)
      const reports = groupReports(rows, now)
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=10, stale-while-revalidate=20',
      )
      // Existing contract: bare JSON array — never include client_hash
      res.status(200).json(reports)
    } catch (err) {
      if (err instanceof DbUnavailableError || isProduction()) {
        serviceUnavailable(res)
        return
      }
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json([])
    }
    return
  }

  // ——— POST ———
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (isProduction() && !sb) {
      serviceUnavailable(res)
      return
    }

    const body = parseBody(req)
    if (!body) {
      badRequest(res, 'Vigane päring')
      return
    }

    const parkingId = String(body.parkingId ?? '').trim()
    if (!PARKING_ID_RE.test(parkingId)) {
      badRequest(res, 'Vigane parkla tunnus')
      return
    }

    const statusType = normalizeStatus(body.statusType)
    if (!statusType) {
      badRequest(res, 'Vigane staatus')
      return
    }

    const comment = sanitizeComment(body.comment)
    if (comment == null) {
      badRequest(res, 'Kommentaar on liiga pikk või vigane')
      return
    }

    const hash = clientHash(req)

    const recentCount = await countRecentByHash(sb, hash, RATE_WINDOW_MS, now)
    if (recentCount >= RATE_MAX) {
      res.status(429).json({
        success: false,
        message: 'Liiga palju teavitusi — proovi 2 minuti pärast uuesti',
      })
      return
    }

    if (await hasDuplicateReport(sb, hash, parkingId, statusType, now)) {
      res.status(429).json({
        success: false,
        message: 'Sama teavitus on juba saadetud — proovi hiljem uuesti',
      })
      return
    }

    const inserted = await insertReport(sb, {
      parkingId,
      statusType,
      clientHash: hash,
      createdAt: now,
    })
    if (!inserted.ok) {
      res.status(502).json({
        success: false,
        message: inserted.message,
      })
      return
    }

    const rows = await fetchRecentRows(sb, now)
    const reports = groupReports(rows, now)
    res.status(200).json({
      success: true,
      message: 'Aitäh! Sinu teavitus aitab teisi autojuhte.',
      reports,
    })
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      serviceUnavailable(res)
      return
    }
    res.status(500).json({
      success: false,
      message: 'Teenus pole hetkel saadaval',
    })
  }
}
