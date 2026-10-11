/**
 * Central feedback inbox — proposals, wrong-data, abuse reports.
 *
 * POST { type, parkingId?, lat?, lng?, note?, company_website? }
 * Types: NEW_PARKING | WRONG_DATA | ABUSE_REPORT
 *
 * Server-only: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ REPORT_SALT).
 * Rate limit: max 5 posts / 10 min per hashed IP (same salt as /api/reports).
 * Mem fallback is DEV ONLY — production returns 503 when DB is unavailable.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { clientHash, reportSaltOk } from './_lib/clientHash.js'

const TABLE = 'parking_feedback'
const NOTE_MAX = 200
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 5
const PARKING_ID_RE = /^[A-Za-z0-9_/-]{1,64}$/

/** Estonia bounds — same box as map maxBounds. */
const EE_LAT_MIN = 57.4
const EE_LAT_MAX = 59.8
const EE_LNG_MIN = 21.7
const EE_LNG_MAX = 28.2

const ALLOWED_TYPES = new Set([
  'NEW_PARKING',
  'WRONG_DATA',
  'ABUSE_REPORT',
])

type FeedbackType = 'NEW_PARKING' | 'WRONG_DATA' | 'ABUSE_REPORT'

type MemRow = {
  type: FeedbackType
  parkingId: string | null
  lat: number | null
  lng: number | null
  note: string
  clientHash: string
  createdAt: number
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
  ((globalThis as { __parkFeedbackMemV1?: Map<string, MemRow> })
    .__parkFeedbackMemV1 ??= new Map())

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

function normalizeType(raw: unknown): FeedbackType | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toUpperCase()
  if (ALLOWED_TYPES.has(t)) return t as FeedbackType
  return null
}

/** Strip control chars; enforce max length. */
export function sanitizeNote(raw: unknown): string | null {
  if (raw == null || raw === '') return ''
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .trim()
    // eslint-disable-next-line no-control-regex -- intentional control-char strip
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length > NOTE_MAX) return null
  return cleaned
}

/** Reject notes that look like they contain an email or phone number. */
export function noteContainsContactInfo(note: string): boolean {
  if (!note) return false
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(note)) return true
  // Digits with optional +, spaces, dashes — at least 7 digits total
  const digits = note.replace(/\D/g, '')
  if (digits.length >= 7 && /(?:\+?\d[\d\s().-]{5,}\d)/.test(note)) {
    return true
  }
  return false
}

function parseOptionalParkingId(raw: unknown): string | null | undefined {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return undefined
  const id = raw.trim()
  if (!PARKING_ID_RE.test(id)) return undefined
  return id
}

function parseOptionalCoord(
  raw: unknown,
  min: number,
  max: number,
): number | null | undefined {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return undefined
  return n
}

function pruneMem(now = Date.now()) {
  const cutoff = now - RATE_WINDOW_MS
  for (const [k, v] of memStore) {
    if (v.createdAt < cutoff) memStore.delete(k)
  }
}

async function countRecentByHash(
  sb: SupabaseClient | null,
  hash: string,
  now: number,
): Promise<number> {
  const since = new Date(now - RATE_WINDOW_MS).toISOString()
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    pruneMem(now)
    let n = 0
    for (const row of memStore.values()) {
      if (row.clientHash === hash && row.createdAt >= now - RATE_WINDOW_MS) {
        n += 1
      }
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
    return countRecentByHash(null, hash, now)
  }
  return count ?? 0
}

async function insertFeedback(
  sb: SupabaseClient | null,
  row: MemRow,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    const id = `${row.clientHash}:${row.type}:${row.createdAt}`
    memStore.set(id, row)
    pruneMem(row.createdAt)
    return { ok: true }
  }

  const { error } = await sb.from(TABLE).insert({
    type: row.type,
    parking_id: row.parkingId,
    lat: row.lat,
    lng: row.lng,
    note: row.note,
    client_hash: row.clientHash,
    status: 'NEW',
  })
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    return insertFeedback(null, row)
  }
  return { ok: true }
}

export default async function handler(req: ApiReq, res: ApiRes): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase()
  res.setHeader('Cache-Control', 'no-store')

  if (method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ success: false, message: 'Method not allowed' })
    return
  }

  if (isProduction() && !reportSaltOk()) {
    serviceUnavailable(res)
    return
  }

  const sb = getServiceClient()
  const now = Date.now()

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

    // Honeypot must be empty
    const honeypot = String(body.company_website ?? '').trim()
    if (honeypot) {
      // Soft success — do not reveal the trap
      res.status(200).json({
        success: true,
        message: 'Aitäh! Vaatame teate üle.',
      })
      return
    }

    const type = normalizeType(body.type)
    if (!type) {
      badRequest(res, 'Vigane teate tüüp')
      return
    }

    const parkingId = parseOptionalParkingId(
      body.parkingId ?? body.parking_id,
    )
    if (parkingId === undefined) {
      badRequest(res, 'Vigane parkla tunnus')
      return
    }
    if (
      (type === 'WRONG_DATA' || type === 'ABUSE_REPORT') &&
      !parkingId
    ) {
      badRequest(res, 'Parkla tunnus on kohustuslik')
      return
    }

    const lat = parseOptionalCoord(body.lat, EE_LAT_MIN, EE_LAT_MAX)
    if (lat === undefined) {
      badRequest(res, 'Laiuskraad peab olema Eesti piires')
      return
    }
    const lng = parseOptionalCoord(body.lng, EE_LNG_MIN, EE_LNG_MAX)
    if (lng === undefined) {
      badRequest(res, 'Pikkuskraad peab olema Eesti piires')
      return
    }

    const note = sanitizeNote(body.note)
    if (note == null) {
      badRequest(res, 'Tekst on liiga pikk või vigane (max 200 märki)')
      return
    }
    if (noteContainsContactInfo(note)) {
      badRequest(
        res,
        'Ära lisa e-posti ega telefoninumbrit — meil pole neid vaja',
      )
      return
    }

    const hash = clientHash(req)
    const recentCount = await countRecentByHash(sb, hash, now)
    if (recentCount >= RATE_MAX) {
      res.status(429).json({
        success: false,
        message: 'Liiga palju teateid — proovi 10 minuti pärast uuesti',
      })
      return
    }

    const inserted = await insertFeedback(sb, {
      type,
      parkingId,
      lat,
      lng,
      note,
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

    res.status(200).json({
      success: true,
      message: 'Aitäh! Vaatame teate üle.',
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
