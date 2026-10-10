/**
 * Tallinn paid street zones — single source of truth for rates shown in
 * PAID_ZONES + rules UI. Tariffs checked 2026-10-09 against tallinn.ee.
 *
 * Detailed per-minute billing lives in api/_lib/pricing.ts (same numbers).
 */

export type PaidZoneCode = 'VANALINN' | 'SÜDALINN' | 'KESKLINN' | 'PIRITA'

export type ZoneRate = {
  code: PaidZoneCode
  /** Display name (Estonian) */
  name: string
  /** EUR per started minute */
  pricePerMinute: number
  /** EUR per hour (pricePerMinute × 60) */
  pricePerHour: number
  /** Free minutes when session start is marked (parking clock / note) */
  freeMinutes: number
  /** Short paid-hours summary for the rules panel */
  hoursNote: string
}

/** Official municipal paid zones used by PAID_ZONES + rules UI. */
export const ZONE_RATES: Record<PaidZoneCode, ZoneRate> = {
  VANALINN: {
    code: 'VANALINN',
    name: 'Vanalinn',
    pricePerMinute: 0.1,
    pricePerHour: 6.0,
    freeMinutes: 15,
    hoursNote: '24/7',
  },
  SÜDALINN: {
    code: 'SÜDALINN',
    name: 'Südalinn',
    pricePerMinute: 0.08,
    pricePerHour: 4.8,
    freeMinutes: 15,
    hoursNote: '24/7',
  },
  KESKLINN: {
    code: 'KESKLINN',
    name: 'Kesklinn',
    pricePerMinute: 0.025,
    pricePerHour: 1.5,
    freeMinutes: 15,
    hoursNote: 'E–R 07–19, L 08–15, P tasuta',
  },
  PIRITA: {
    code: 'PIRITA',
    name: 'Pirita',
    pricePerMinute: 0.01,
    pricePerHour: 0.6,
    freeMinutes: 15,
    hoursNote: '10–22, 15.05–15.09',
  },
}

export const ZONE_RATE_LIST: ZoneRate[] = [
  ZONE_RATES.VANALINN,
  ZONE_RATES.SÜDALINN,
  ZONE_RATES.KESKLINN,
  ZONE_RATES.PIRITA,
]

export function zonePricePerHour(code: string | undefined): number | undefined {
  if (!code) return undefined
  const key = code.trim().toUpperCase() as PaidZoneCode
  return ZONE_RATES[key]?.pricePerHour
}

/** Spots that must not start an n8n parking session (no paid zone ticket). */
export function canStartParkingSession(spot: {
  type?: string
  layer?: string
  featureType?: string
  zone_code?: string
}): boolean {
  if (spot.type === 'free' || spot.type === 'timed' || spot.type === 'pr') {
    return false
  }
  if (
    spot.layer === 'free_street' ||
    spot.layer === 'timed' ||
    spot.layer === 'park_ride'
  ) {
    return false
  }
  if (spot.featureType === 'park-ride') return false
  if (spot.zone_code === 'FREE' || spot.zone_code === 'KELL') return false
  return true
}

/** Short Estonian hint when Start is disabled for free / clock / P&R. */
export function sessionStartDisabledHint(spot: {
  type?: string
  layer?: string
  featureType?: string
  zone_code?: string
}): string | null {
  if (canStartParkingSession(spot)) return null
  if (
    spot.type === 'pr' ||
    spot.layer === 'park_ride' ||
    spot.featureType === 'park-ride'
  ) {
    return 'Pargi & reisi — sessiooni ei alustata'
  }
  if (
    spot.type === 'timed' ||
    spot.layer === 'timed' ||
    spot.zone_code === 'KELL'
  ) {
    return 'Kellaga koht — pane kell esiklaasile'
  }
  return 'Tasuta koht — sessiooni ei alustata'
}
