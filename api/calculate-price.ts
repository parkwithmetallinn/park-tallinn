/**
 * Parking price quote API.
 *
 * POST JSON / GET query:
 *   zoneId, startTime (ISO 8601), endTime (ISO 8601)
 *
 * Fetches `public.parking_zones` via service role when configured;
 * falls back to defaults (2 €/h, 15 free min, 15 € daily cap).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  calculateParkingPrice,
  DEFAULT_ZONE_PRICING,
  type ZonePricing,
} from './lib/priceCalc.js'

type ApiReq = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[] | undefined>
  url?: string
}

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void
    end: (body?: unknown) => void
  }
  setHeader?: (name: string, value: string) => void
}

const ZONE_ID_RE = /^[A-Za-z0-9ÄÖÜÕäöüõ+\-_./ ]{1,48}$/
const TABLE = 'parking_zones'

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

function queryParams(req: ApiReq): Record<string, string> {
  const out: Record<string, string> = {}
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string') out[k] = v
      else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0]
    }
  }
  if (req.url) {
    try {
      const u = new URL(req.url, 'http://local')
      for (const [k, v] of u.searchParams) {
        if (!(k in out)) out[k] = v
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length ? s : null
}

function parseIsoMs(raw: string): number | null {
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function numOr(
  raw: unknown,
  fallback: number,
): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function badRequest(res: ApiRes, message: string) {
  res.status(400).json({ success: false, message })
}

async function fetchZonePricing(
  sb: SupabaseClient | null,
  zoneId: string,
): Promise<ZonePricing> {
  const defaults: ZonePricing = {
    zoneId,
    zoneName: zoneId,
    ...DEFAULT_ZONE_PRICING,
  }
  if (!sb) return defaults

  const normalized = zoneId.trim()
  const upper = normalized.toUpperCase()

  try {
    // Prefer zone_id / code match (case-insensitive via or filter)
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .or(
        [
          `zone_id.eq.${normalized}`,
          `zone_id.eq.${upper}`,
          `code.eq.${normalized}`,
          `code.eq.${upper}`,
          `id.eq.${normalized}`,
          `id.eq.${upper}`,
        ].join(','),
      )
      .limit(1)
      .maybeSingle()

    if (error || !data || typeof data !== 'object') return defaults

    const row = data as Record<string, unknown>
    const id = asString(row.zone_id) ?? asString(row.code) ?? asString(row.id) ?? zoneId
    const name =
      asString(row.name) ??
      asString(row.zone_name) ??
      asString(row.display_name) ??
      id

    const hourlyRate = numOr(
      row.hourly_rate ?? row.price_per_hour ?? row.hourlyRate,
      DEFAULT_ZONE_PRICING.hourlyRate,
    )
    const freeMinutes = Math.max(
      0,
      Math.floor(
        numOr(
          row.free_minutes ?? row.freeMinutes,
          DEFAULT_ZONE_PRICING.freeMinutes,
        ),
      ),
    )
    const capRaw = row.daily_cap ?? row.dailyCap ?? row.price_per_24h
    let dailyCap: number | null = DEFAULT_ZONE_PRICING.dailyCap
    if (capRaw === null || capRaw === '') {
      dailyCap = null
    } else if (capRaw !== undefined) {
      const n = Number(capRaw)
      dailyCap = Number.isFinite(n) && n > 0 ? n : null
    }

    return {
      zoneId: id,
      zoneName: name,
      hourlyRate: Math.max(0, hourlyRate),
      freeMinutes,
      dailyCap,
    }
  } catch {
    return defaults
  }
}

export default async function handler(req: ApiReq, res: ApiRes): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (method !== 'GET' && method !== 'POST') {
    res.status(405).json({ success: false, message: 'Meetod pole lubatud' })
    return
  }

  const body = method === 'POST' ? parseBody(req) : null
  const q = queryParams(req)

  const zoneIdRaw =
    asString(body?.zoneId) ??
    asString(body?.zone_id) ??
    asString(q.zoneId) ??
    asString(q.zone_id)
  const startRaw =
    asString(body?.startTime) ??
    asString(body?.start_time) ??
    asString(q.startTime) ??
    asString(q.start_time)
  const endRaw =
    asString(body?.endTime) ??
    asString(body?.end_time) ??
    asString(q.endTime) ??
    asString(q.end_time)

  if (!zoneIdRaw) {
    badRequest(res, 'Puudub tsooni tunnus (zoneId)')
    return
  }
  if (!ZONE_ID_RE.test(zoneIdRaw)) {
    badRequest(res, 'Vigane tsooni tunnus (zoneId)')
    return
  }
  if (!startRaw) {
    badRequest(res, 'Puudub algusaeg (startTime)')
    return
  }
  if (!endRaw) {
    badRequest(res, 'Puudub lõppaeg (endTime)')
    return
  }

  const startMs = parseIsoMs(startRaw)
  const endMs = parseIsoMs(endRaw)
  if (startMs == null) {
    badRequest(res, 'Vigane algusaeg — kasuta ISO 8601 vormingut')
    return
  }
  if (endMs == null) {
    badRequest(res, 'Vigane lõppaeg — kasuta ISO 8601 vormingut')
    return
  }
  if (endMs < startMs) {
    badRequest(res, 'Lõppaeg peab olema pärast algusaega')
    return
  }

  const zone = await fetchZonePricing(getServiceClient(), zoneIdRaw)
  const result = calculateParkingPrice(zone, startMs, endMs)
  res.status(200).json(result)
}
