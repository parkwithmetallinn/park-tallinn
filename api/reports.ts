/**
 * Hardened community parking reports (spot is full / free).
 *
 * POST { parkingId, statusType, comment? }
 * GET  → [{ parkingId, isFull, lastReportedMinutesAgo }]
 *
 * Server-only: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ REPORT_SALT).
 * Browser talks only to /api/reports — never the anon key.
 */

import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const MIN_FULL_VOTES = 2
const WINDOW_MS = 45 * 60 * 1000
const RATE_WINDOW_MS = 2 * 60 * 1000
const RATE_MAX = 3
const DUP_WINDOW_MS = 10 * 60 * 1000
const COMMENT_MAX = 200
const GET_LIMIT = 2000
const TABLE = 'parking_reports'
// Slash allowed so OSM-style ids (w/123, way/…) match map spot.id without map changes.
const PARKING_ID_RE = /^[A-Za-z0-9_/-]{1,64}$/

/** Statuses the app uses for full/free voting. */
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
  comment: string
  clientHash: string
  createdAt: number
}

type GroupedReport = {
  parkingId: string
  isFull: boolean
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

const memStore: Map<string, MemRow> =
  ((globalThis as { __parkReportsMemV2?: Map<string, MemRow> }).__parkReportsMemV2 ??=
    new Map())

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

function normalizeStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toUpperCase()
  if (ALLOWED_STATUS.has(t)) return t
  // Legacy UI aliases → FREE vote (CrowdReportModal maps these client-side too)
  if (t === 'PRICES' || t === 'CLOSED') return 'FREE'
  return null
}

function badRequest(res: ApiRes, message: string) {
  res.status(400).json({ success: false, message })
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
  if (error) return countRecentByHash(null, hash, windowMs, now)
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
  if (error) return hasDuplicateReport(null, hash, parkingId, statusType, now)
  return (count ?? 0) > 0
}

async function insertReport(
  sb: SupabaseClient | null,
  row: {
    parkingId: string
    statusType: string
    comment: string
    clientHash: string
    createdAt: number
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!sb) {
    const id = `${row.clientHash}:${row.parkingId}:${row.createdAt}`
    memStore.set(id, {
      parkingId: row.parkingId,
      statusType: row.statusType,
      comment: row.comment,
      clientHash: row.clientHash,
      createdAt: row.createdAt,
    })
    pruneMem(row.createdAt)
    return { ok: true }
  }

  const { error } = await sb.from(TABLE).insert({
    parking_id: row.parkingId,
    status_type: row.statusType,
    comment: row.comment || null,
    client_hash: row.clientHash,
  })
  if (error) {
    // Unreachable / misconfigured project → mem fallback (local/dev)
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
    // Network / RLS / missing table → mem fallback
    return fetchRecentRows(null, now)
  }
  return data as ReportRow[]
}

/**
 * Per parking_id keep only the LATEST report of each voter (client_hash),
 * then tally FULL vs FREE votes.
 */
function groupReports(rows: ReportRow[], now: number): GroupedReport[] {
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
    out.push({
      parkingId,
      isFull,
      lastReportedMinutesAgo: Math.max(
        0,
        Math.round((now - latestMs) / 60_000),
      ),
    })
  }

  out.sort((a, b) => a.lastReportedMinutesAgo - b.lastReportedMinutesAgo)
  return out
}

export default async function handler(req: ApiReq, res: ApiRes): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase()

  if (method !== 'GET' && method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' })
    return
  }

  const sb = getServiceClient()
  const now = Date.now()

  if (method === 'GET') {
    try {
      const rows = await fetchRecentRows(sb, now)
      const reports = groupReports(rows, now)
      // Existing contract: bare JSON array — never include client_hash
      res.status(200).json(reports)
    } catch {
      res.status(500).json([])
    }
    return
  }

  // ——— POST ———
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
    comment,
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
}
