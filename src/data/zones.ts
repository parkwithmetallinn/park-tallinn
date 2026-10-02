/**
 * Tallinn paid street zones — single source of truth for hourly rates.
 * Rates: verify on tallinn.ee
 */

export type PaidZoneCode = 'VANALINN' | 'SÜDALINN' | 'KESKLINN' | 'PIRITA'

export type ZoneRate = {
  code: PaidZoneCode
  /** Display name (Estonian) */
  name: string
  /** EUR per hour */
  pricePerHour: number
  /** Free minutes with clock on the dash (0 = none) */
  freeMinutes: number
}

/** Official municipal paid zones used by PAID_ZONES + rules UI. */
export const ZONE_RATES: Record<PaidZoneCode, ZoneRate> = {
  VANALINN: {
    code: 'VANALINN',
    name: 'Vanalinn',
    pricePerHour: 6.0,
    freeMinutes: 15,
  },
  SÜDALINN: {
    code: 'SÜDALINN',
    name: 'Südalinn',
    pricePerHour: 4.8,
    freeMinutes: 15,
  },
  KESKLINN: {
    code: 'KESKLINN',
    name: 'Kesklinn',
    pricePerHour: 1.5,
    freeMinutes: 15,
  },
  PIRITA: {
    code: 'PIRITA',
    name: 'Pirita',
    pricePerHour: 0.6,
    freeMinutes: 0,
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
