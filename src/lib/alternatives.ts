import { distanceMeters } from './geo'
import type { ParkingSpot } from '../types'

export type AlternativeParking = {
  spot: ParkingSpot
  distanceM: number
  /** True when the spot was found only after ignoring the active filter. */
  outsideFilter: boolean
}

export const ALT_RADIUS_STEPS = [500, 800, 1200, 2000] as const
export const ALT_RADIUS_WIDE = 3000

function isParkingCandidate(s: ParkingSpot): boolean {
  const isRoadside =
    s.featureType === 'on-street-line' || Boolean(s.line) || s.kind === 'street'
  const isLot =
    s.featureType === 'off-street-lot' ||
    s.featureType === 'municipal-zone' ||
    Boolean(s.polygon) ||
    s.kind === 'lot'
  return isRoadside || isLot
}

/**
 * Find nearest available parking alternatives around an origin.
 * Respects the active filter first; if empty, falls back to all candidates
 * (outsideFilter = true). Never mutates queryNearbyParking behavior.
 */
export function findAlternatives(args: {
  origin: { lat: number; lng: number }
  candidates: ParkingSpot[]
  excludeIds?: Iterable<string>
  fullIds?: Iterable<string>
  /** Return true when the spot matches the active map filter. */
  matchesFilter?: (spot: ParkingSpot) => boolean
  radiusSteps?: readonly number[]
  /** Hard cap — search stops at this radius (inclusive). */
  maxRadius?: number
  limit?: number
}): {
  results: AlternativeParking[]
  radiusUsed: number
  usedFilterFallback: boolean
} {
  const {
    origin,
    candidates,
    matchesFilter,
    radiusSteps = ALT_RADIUS_STEPS,
    maxRadius,
    limit = 6,
  } = args
  const exclude = new Set(args.excludeIds ?? [])
  const full = new Set(args.fullIds ?? [])

  const pool = candidates.filter(
    (s) =>
      isParkingCandidate(s) &&
      !exclude.has(s.id) &&
      !full.has(s.id),
  )

  const steps = maxRadius
    ? [...radiusSteps.filter((r) => r <= maxRadius), maxRadius].filter(
        (r, i, a) => a.indexOf(r) === i,
      )
    : [...radiusSteps]

  const scored = (list: ParkingSpot[], outsideFilter: boolean) =>
    list
      .map((spot) => ({
        spot,
        distanceM: distanceMeters(origin.lat, origin.lng, spot.lat, spot.lng),
        outsideFilter,
      }))
      .sort((a, b) => a.distanceM - b.distanceM)

  for (const radius of steps) {
    const inRadius = pool.filter(
      (s) =>
        distanceMeters(origin.lat, origin.lng, s.lat, s.lng) <= radius,
    )
    const filtered = matchesFilter
      ? inRadius.filter((s) => matchesFilter(s))
      : inRadius
    if (filtered.length > 0) {
      return {
        results: scored(filtered, false).slice(0, limit),
        radiusUsed: radius,
        usedFilterFallback: false,
      }
    }
  }

  // Fallback: ignore filter across the same radii
  for (const radius of steps) {
    const inRadius = pool.filter(
      (s) =>
        distanceMeters(origin.lat, origin.lng, s.lat, s.lng) <= radius,
    )
    if (inRadius.length > 0) {
      return {
        results: scored(inRadius, true).slice(0, limit),
        radiusUsed: radius,
        usedFilterFallback: true,
      }
    }
  }

  return { results: [], radiusUsed: steps[steps.length - 1] ?? 2000, usedFilterFallback: false }
}
