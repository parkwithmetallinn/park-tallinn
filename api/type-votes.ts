/**
 * Crowdsourced parking type votes for unknown-price lots.
 *
 * POST { parkingId, proposedType: 'FREE' | 'TIMED' | 'PAID' }
 * GET  → [{ parkingId, verifiedType, voteCount, lastVotedMinutesAgo }]
 *
 * Trust: when ≥2 independent votes match the same type (both install hash
 * and IP hash must differ), upsert parking_type_verified for map color.
 *
 * Identity: client_hash = sha256(X-Install-Id + REPORT_SALT),
 *           ip_hash     = sha256(ip + REPORT_SALT).
 *
 * Server-only: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ REPORT_SALT).
 * Mem fallback is DEV ONLY — production returns 503 when DB is unavailable.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  installClientHash,
  ipHash,
  reportSaltOk,
} from './_lib/clientHash.js'
import {
  effectiveIpHash,
  filterIndependentVotes,
} from './_lib/voteIndependence.js'

const MIN_MATCHING_VOTES = 2
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days for type votes
const RATE_WINDOW_MS = 2 * 60 * 1000
const RATE_MAX = 5
const DUP_WINDOW_MS = 24 * 60 * 60 * 1000
const GET_LIMIT = 5000
const VOTES_TABLE = 'parking_type_votes'
const VERIFIED_TABLE = 'parking_type_verified'
const BLOCKED_TABLE = 'blocked_hashes'
const PARKING_ID_RE = /^[A-Za-z0-9_/-]{1,64}$/

export const ALLOWED_TYPES = new Set(['FREE', 'TIMED', 'PAID'] as const)
export type ProposedParkingType = 'FREE' | 'TIMED' | 'PAID'

type VoteRow = {
  parking_id: string
  proposed_type: string
  client_hash: string
  ip_hash?: string | null
  created_at: string
}

type VerifiedRow = {
  parking_id: string
  verified_type: string
  vote_count: number
  verified_at: string
}

type MemVote = {
  parkingId: string
  proposedType: ProposedParkingType
  clientHash: string
  ipHash: string
  createdAt: number
}

type MemVerified = {
  parkingId: string
  verifiedType: ProposedParkingType
  voteCount: number
  verifiedAt: number
}

export type TypeVoteResult = {
  parkingId: string
  verifiedType: ProposedParkingType
  voteCount: number
  lastVotedMinutesAgo: number
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

const memVotes: Map<string, MemVote> =
  ((globalThis as { __parkTypeVotesMem?: Map<string, MemVote> })
    .__parkTypeVotesMem ??= new Map())

const memVerified: Map<string, MemVerified> =
  ((globalThis as { __parkTypeVerifiedMem?: Map<string, MemVerified> })
    .__parkTypeVerifiedMem ??= new Map())

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

function normalizeType(raw: unknown): ProposedParkingType | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (s === 'FREE' || s === 'TASUTA') return 'FREE'
  if (s === 'TIMED' || s === 'KELLAGA' || s === 'CLOCK') return 'TIMED'
  if (s === 'PAID' || s === 'TASULINE') return 'PAID'
  return null
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

/** Neutral rejection for blocked install hashes — do not reveal the blocklist. */
function blockedNeutral(res: ApiRes) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(403).json({
    success: false,
    message: 'Häält ei õnnestunud salvestada',
  })
}

async function isBlockedHash(
  sb: SupabaseClient | null,
  hash: string,
): Promise<boolean> {
  if (!sb) return false
  const { count, error } = await sb
    .from(BLOCKED_TABLE)
    .select('client_hash', { count: 'exact', head: true })
    .eq('client_hash', hash)
  if (error) return false
  return (count ?? 0) > 0
}

function pruneMem(now = Date.now()) {
  const cutoff = now - WINDOW_MS
  for (const [k, v] of memVotes) {
    if (v.createdAt < cutoff) memVotes.delete(k)
  }
}

/**
 * Per parking_id keep latest vote per client_hash, then verify when
 * ≥ MIN_MATCHING_VOTES independent votes agree on the same type
 * (independence requires both install hash and IP hash to differ).
 */
export function groupTypeVotes(
  rows: VoteRow[],
  now: number,
): TypeVoteResult[] {
  const perLot = new Map<string, Map<string, VoteRow>>()

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

  const out: TypeVoteResult[] = []
  for (const [parkingId, voters] of perLot) {
    const normalized = [...voters.values()].map((vote) => ({
      client_hash: String(vote.client_hash).trim(),
      ip_hash: effectiveIpHash(vote),
      proposed_type: String(vote.proposed_type ?? ''),
      created_at: vote.created_at,
    }))

    let latestMs = 0
    for (const vote of normalized) {
      const ms = Date.parse(vote.created_at)
      if (Number.isFinite(ms) && ms > latestMs) latestMs = ms
    }

    const tallies: Record<ProposedParkingType, number> = {
      FREE: 0,
      TIMED: 0,
      PAID: 0,
    }
    for (const t of ['FREE', 'TIMED', 'PAID'] as const) {
      const matching = normalized.filter(
        (v) => normalizeType(v.proposed_type) === t,
      )
      tallies[t] = filterIndependentVotes(matching).length
    }

    let best: ProposedParkingType | null = null
    let bestCount = 0
    for (const t of ['FREE', 'TIMED', 'PAID'] as const) {
      if (tallies[t] > bestCount) {
        best = t
        bestCount = tallies[t]
      }
    }
    if (!best || bestCount < MIN_MATCHING_VOTES) continue

    out.push({
      parkingId,
      verifiedType: best,
      voteCount: bestCount,
      lastVotedMinutesAgo: Math.max(
        0,
        Math.round((now - latestMs) / 60_000),
      ),
    })
  }

  out.sort((a, b) => a.lastVotedMinutesAgo - b.lastVotedMinutesAgo)
  return out
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
    for (const row of memVotes.values()) {
      if (row.clientHash === hash && row.createdAt >= now - windowMs) n += 1
    }
    return n
  }
  const { count, error } = await sb
    .from(VOTES_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('client_hash', hash)
    .gt('created_at', since)
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    return countRecentByHash(null, hash, windowMs, now)
  }
  return count ?? 0
}

async function hasDuplicateVote(
  sb: SupabaseClient | null,
  hash: string,
  parkingId: string,
  proposedType: string,
  now: number,
): Promise<boolean> {
  const since = new Date(now - DUP_WINDOW_MS).toISOString()
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    for (const row of memVotes.values()) {
      if (
        row.clientHash === hash &&
        row.parkingId === parkingId &&
        row.proposedType === proposedType &&
        row.createdAt >= now - DUP_WINDOW_MS
      ) {
        return true
      }
    }
    return false
  }
  const { count, error } = await sb
    .from(VOTES_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('client_hash', hash)
    .eq('parking_id', parkingId)
    .eq('proposed_type', proposedType)
    .gt('created_at', since)
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    return hasDuplicateVote(null, hash, parkingId, proposedType, now)
  }
  return (count ?? 0) > 0
}

async function insertVote(
  sb: SupabaseClient | null,
  row: {
    parkingId: string
    proposedType: ProposedParkingType
    clientHash: string
    ipHash: string
    createdAt: number
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    const id = `${row.clientHash}:${row.parkingId}:${row.createdAt}`
    memVotes.set(id, {
      parkingId: row.parkingId,
      proposedType: row.proposedType,
      clientHash: row.clientHash,
      ipHash: row.ipHash,
      createdAt: row.createdAt,
    })
    pruneMem(row.createdAt)
    return { ok: true }
  }

  const { error } = await sb.from(VOTES_TABLE).insert({
    parking_id: row.parkingId,
    proposed_type: row.proposedType,
    client_hash: row.clientHash,
    ip_hash: row.ipHash,
  })
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    return insertVote(null, row)
  }
  return { ok: true }
}

async function fetchRecentVotes(
  sb: SupabaseClient | null,
  now: number,
): Promise<VoteRow[]> {
  const sinceIso = new Date(now - WINDOW_MS).toISOString()
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    pruneMem(now)
    const out: VoteRow[] = []
    for (const v of memVotes.values()) {
      if (v.createdAt >= now - WINDOW_MS) {
        out.push({
          parking_id: v.parkingId,
          proposed_type: v.proposedType,
          client_hash: v.clientHash,
          ip_hash: v.ipHash,
          created_at: new Date(v.createdAt).toISOString(),
        })
      }
    }
    out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return out.slice(0, GET_LIMIT)
  }

  const { data, error } = await sb
    .from(VOTES_TABLE)
    .select('parking_id,proposed_type,client_hash,ip_hash,created_at')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(GET_LIMIT)

  if (error || !Array.isArray(data)) {
    if (isProduction()) throw new DbUnavailableError()
    return fetchRecentVotes(null, now)
  }
  return data as VoteRow[]
}

async function upsertVerified(
  sb: SupabaseClient | null,
  result: TypeVoteResult,
  now: number,
): Promise<void> {
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    memVerified.set(result.parkingId, {
      parkingId: result.parkingId,
      verifiedType: result.verifiedType,
      voteCount: result.voteCount,
      verifiedAt: now,
    })
    return
  }

  const { error } = await sb.from(VERIFIED_TABLE).upsert(
    {
      parking_id: result.parkingId,
      verified_type: result.verifiedType,
      vote_count: result.voteCount,
      verified_at: new Date(now).toISOString(),
    },
    { onConflict: 'parking_id' },
  )
  if (error) {
    if (isProduction()) throw new DbUnavailableError()
    await upsertVerified(null, result, now)
  }
}

async function fetchVerified(
  sb: SupabaseClient | null,
): Promise<TypeVoteResult[]> {
  if (!sb) {
    if (isProduction()) throw new DbUnavailableError()
    const now = Date.now()
    return [...memVerified.values()].map((v) => ({
      parkingId: v.parkingId,
      verifiedType: v.verifiedType,
      voteCount: v.voteCount,
      lastVotedMinutesAgo: Math.max(
        0,
        Math.round((now - v.verifiedAt) / 60_000),
      ),
    }))
  }

  const { data, error } = await sb
    .from(VERIFIED_TABLE)
    .select('parking_id,verified_type,vote_count,verified_at')
    .limit(GET_LIMIT)

  if (error || !Array.isArray(data)) {
    if (isProduction()) throw new DbUnavailableError()
    return fetchVerified(null)
  }

  const now = Date.now()
  const out: TypeVoteResult[] = []
  for (const row of data as VerifiedRow[]) {
    const t = normalizeType(row.verified_type)
    if (!t) continue
    const ms = Date.parse(row.verified_at)
    out.push({
      parkingId: String(row.parking_id),
      verifiedType: t,
      voteCount: Number(row.vote_count) || MIN_MATCHING_VOTES,
      lastVotedMinutesAgo: Number.isFinite(ms)
        ? Math.max(0, Math.round((now - ms) / 60_000))
        : 0,
    })
  }
  return out
}

/** Merge vote-derived + persisted verified rows (verified table wins). */
export function mergeVerifiedResults(
  fromVotes: TypeVoteResult[],
  fromTable: TypeVoteResult[],
): TypeVoteResult[] {
  const map = new Map<string, TypeVoteResult>()
  for (const r of fromVotes) map.set(r.parkingId, r)
  for (const r of fromTable) map.set(r.parkingId, r)
  return [...map.values()].sort(
    (a, b) => a.lastVotedMinutesAgo - b.lastVotedMinutesAgo,
  )
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
      const rows = await fetchRecentVotes(sb, now)
      const fromVotes = groupTypeVotes(rows, now)
      const fromTable = await fetchVerified(sb)
      const results = mergeVerifiedResults(fromVotes, fromTable)
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=15, stale-while-revalidate=30',
      )
      res.status(200).json(results)
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

    const proposedType = normalizeType(body.proposedType ?? body.statusType)
    if (!proposedType) {
      badRequest(res, 'Vigane parkla tüüp')
      return
    }

    const hash = installClientHash(req)
    if (!hash) {
      badRequest(res, 'Vigane päring')
      return
    }
    const ip = ipHash(req)

    if (await isBlockedHash(sb, hash)) {
      blockedNeutral(res)
      return
    }

    const recentCount = await countRecentByHash(sb, hash, RATE_WINDOW_MS, now)
    if (recentCount >= RATE_MAX) {
      res.status(429).json({
        success: false,
        message: 'Liiga palju hääli — proovi 2 minuti pärast uuesti',
      })
      return
    }

    if (await hasDuplicateVote(sb, hash, parkingId, proposedType, now)) {
      res.status(429).json({
        success: false,
        message: 'Sama hääl on juba saadetud — aitäh!',
      })
      return
    }

    const inserted = await insertVote(sb, {
      parkingId,
      proposedType,
      clientHash: hash,
      ipHash: ip,
      createdAt: now,
    })
    if (inserted.ok === false) {
      res.status(502).json({
        success: false,
        message: inserted.message,
      })
      return
    }

    const rows = await fetchRecentVotes(sb, now)
    const fromVotes = groupTypeVotes(rows, now)
    const justVerified = fromVotes.find((r) => r.parkingId === parkingId)
    if (justVerified) {
      await upsertVerified(sb, justVerified, now)
    }
    const fromTable = await fetchVerified(sb)
    const results = mergeVerifiedResults(fromVotes, fromTable)

    res.status(200).json({
      success: true,
      message: justVerified
        ? 'Aitäh! Parkla tüüp on kogukonna poolt kinnitatud.'
        : 'Aitäh! Sinu hääl on salvestatud — vaja on veel ühte kinnitust.',
      verified: Boolean(justVerified),
      verifiedType: justVerified?.verifiedType ?? null,
      results,
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
