/**
 * Crowdsourced parking type votes — GET/POST /api/type-votes.
 * When ≥2 independent votes match, the lot is treated as verified.
 */

import { apiUrl } from './apiBase'
import { installIdHeaders } from './installId'
import {
  categoryPaintColor,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
} from './parkingClassification'
import type { ParkingSpot } from '../types'

export type ProposedParkingType = 'FREE' | 'TIMED' | 'PAID'

export type TypeVoteVerification = {
  parkingId: string
  verifiedType: ProposedParkingType
  voteCount: number
  lastVotedMinutesAgo: number
}

export const TYPE_VOTES_POLL_MS = 30_000

export function parseTypeVoteResults(data: unknown): TypeVoteVerification[] {
  const raw = Array.isArray(data)
    ? data
    : data &&
        typeof data === 'object' &&
        Array.isArray((data as { results?: unknown }).results)
      ? (data as { results: unknown[] }).results
      : null
  if (!raw) return []

  const out: TypeVoteVerification[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const parkingId = String(row.parkingId ?? row.id ?? '').trim()
    const verifiedType = String(row.verifiedType ?? '')
      .trim()
      .toUpperCase()
    if (!parkingId) continue
    if (
      verifiedType !== 'FREE' &&
      verifiedType !== 'TIMED' &&
      verifiedType !== 'PAID'
    ) {
      continue
    }
    const voteCount =
      typeof row.voteCount === 'number' && Number.isFinite(row.voteCount)
        ? Math.max(0, Math.round(row.voteCount))
        : 2
    const minsRaw = row.lastVotedMinutesAgo
    const lastVotedMinutesAgo =
      typeof minsRaw === 'number' && Number.isFinite(minsRaw)
        ? Math.max(0, Math.round(minsRaw))
        : 0
    out.push({
      parkingId,
      verifiedType,
      voteCount,
      lastVotedMinutesAgo,
    })
  }
  return out
}

export async function fetchTypeVoteResults(
  signal?: AbortSignal,
): Promise<TypeVoteVerification[]> {
  const res = await fetch(apiUrl('/api/type-votes'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`type-votes HTTP ${res.status}`)
  const data: unknown = await res.json()
  return parseTypeVoteResults(data)
}

export async function postTypeVote(input: {
  parkingId: string
  proposedType: ProposedParkingType
}): Promise<{
  ok: boolean
  message: string
  verified: boolean
  verifiedType: ProposedParkingType | null
  results: TypeVoteVerification[]
}> {
  try {
    const res = await fetch(apiUrl('/api/type-votes'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...installIdHeaders(),
      },
      body: JSON.stringify({
        parkingId: input.parkingId,
        proposedType: input.proposedType,
      }),
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      message?: string
      verified?: boolean
      verifiedType?: string | null
      results?: unknown
    } | null
    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        message: data?.message || 'Hääle saatmine ebaõnnestus',
        verified: false,
        verifiedType: null,
        results: [],
      }
    }
    const verifiedTypeRaw = String(data?.verifiedType ?? '')
      .trim()
      .toUpperCase()
    const verifiedType =
      verifiedTypeRaw === 'FREE' ||
      verifiedTypeRaw === 'TIMED' ||
      verifiedTypeRaw === 'PAID'
        ? verifiedTypeRaw
        : null
    return {
      ok: true,
      message: data?.message || 'Aitäh!',
      verified: Boolean(data?.verified),
      verifiedType,
      results: parseTypeVoteResults(data?.results ?? []),
    }
  } catch {
    return {
      ok: false,
      message: 'Võrguühendus puudub',
      verified: false,
      verifiedType: null,
      results: [],
    }
  }
}

export function typeVotesById(
  list: TypeVoteVerification[],
): Map<string, TypeVoteVerification> {
  const map = new Map<string, TypeVoteVerification>()
  for (const r of list) map.set(r.parkingId, r)
  return map
}

/** Patch a ParkingSpot with a community-verified type (client overlay). */
export function applyVerifiedTypeToSpot(
  spot: ParkingSpot,
  verifiedType: ProposedParkingType,
): ParkingSpot {
  if (verifiedType === 'FREE') {
    return {
      ...spot,
      layer: 'free_street',
      type: 'free',
      price_per_hour: 0,
      free_minutes: 0,
      badge: 'Tasuta',
      timeLimit: 'Tasuta · piiramatu',
      verifyOnSite: false,
    }
  }
  if (verifiedType === 'TIMED') {
    const mins = spot.free_minutes > 0 ? spot.free_minutes : 15
    return {
      ...spot,
      layer: 'timed',
      type: 'timed',
      price_per_hour: 0,
      free_minutes: mins,
      badge: 'Kellaga',
      timeLimit: `Parkimiskellaga / Ajapiiranguga · ${mins} min`,
      verifyOnSite: false,
    }
  }
  // PAID
  const rate = spot.price_per_hour > 0 ? spot.price_per_hour : 2
  const layer =
    spot.layer === 'free_street' || spot.layer === 'timed'
      ? 'municipal'
      : spot.layer
  return {
    ...spot,
    layer,
    type: 'paid',
    price_per_hour: rate,
    badge: 'Tasuline',
    timeLimit: `Tasuline · ${spot.zone_code || 'PAID'}`,
    verifyOnSite: false,
  }
}

export function colorForVerifiedType(type: ProposedParkingType): string {
  if (type === 'FREE') return PARKING_COLOR_FREE
  if (type === 'TIMED') return PARKING_COLOR_TIMED
  return PARKING_COLOR_PAID
}

/** Patch GeoJSON-like parking properties for map paint. */
export function applyVerifiedTypeToProps<
  T extends {
    id?: string
    layer?: string
    price_per_hour?: number
    free_minutes?: number
    verified_free?: boolean
    badge?: string
    color?: string
    pricing_unknown?: boolean
    zone_code?: string
    rules?: string
  },
>(props: T, verifiedType: ProposedParkingType): T {
  const next = { ...props }
  if (verifiedType === 'FREE') {
    next.layer = 'free_street'
    next.price_per_hour = 0
    next.free_minutes = 0
    next.verified_free = true
    next.badge = 'Tasuta'
    next.pricing_unknown = false
    if ('rules' in next) next.rules = 'free'
  } else if (verifiedType === 'TIMED') {
    next.layer = 'timed'
    next.price_per_hour = 0
    next.free_minutes =
      typeof next.free_minutes === 'number' && next.free_minutes > 0
        ? next.free_minutes
        : 15
    next.verified_free = false
    next.badge = 'Kellaga'
    next.pricing_unknown = false
    if ('rules' in next) next.rules = 'clock'
  } else {
    next.layer =
      next.layer === 'free_street' || next.layer === 'timed'
        ? 'municipal'
        : next.layer
    next.price_per_hour =
      typeof next.price_per_hour === 'number' && next.price_per_hour > 0
        ? next.price_per_hour
        : 2
    next.verified_free = false
    next.badge = 'Tasuline'
    next.pricing_unknown = false
    if ('rules' in next) next.rules = 'paid'
  }
  next.color = categoryPaintColor({
    layer: next.layer,
    free_minutes: next.free_minutes,
    price_per_hour: next.price_per_hour,
    verified_free: next.verified_free,
    zone_code: next.zone_code,
    badge: next.badge,
  })
  if (verifiedType === 'FREE') next.color = PARKING_COLOR_FREE
  if (verifiedType === 'TIMED') next.color = PARKING_COLOR_TIMED
  if (verifiedType === 'PAID') next.color = PARKING_COLOR_PAID
  return next
}
