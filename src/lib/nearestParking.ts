/**
 * Nearest-parking list helpers: unique keys, name/coord dedupe, search-origin distances.
 */

import { distanceMeters } from './geo'
import { spotDisplayName } from './parkingDisplayName'
import type { ParkingSpot } from '../types'

export type NearestParkingOption = {
  spot: ParkingSpot
  distanceM: number
  /** Guaranteed unique per list row (never share with another card). */
  optionKey: string
}

/** Stable unique id when GeoJSON lacks one or collisions exist. */
export function uniqueParkingFeatureId(
  rawId: string | number | null | undefined,
  lat: number,
  lng: number,
  index: number,
): string {
  const raw = rawId == null ? '' : String(rawId).trim()
  if (raw && raw !== 'undefined' && raw !== 'null') {
    return raw
  }
  const la = Number.isFinite(lat) ? lat.toFixed(6) : '0'
  const ln = Number.isFinite(lng) ? lng.toFixed(6) : '0'
  return `${la}_${ln}_${index}`
}

function namesMatch(a: ParkingSpot, b: ParkingSpot): boolean {
  const na = spotDisplayName(a).trim().toLowerCase()
  const nb = spotDisplayName(b).trim().toLowerCase()
  if (!na || !nb) return false
  return na === nb
}

/**
 * Merge parkings with the same display name within `maxDistM` (default 20 m).
 * Keeps the closer-to-origin entry. Recomputes distance from the search center.
 */
export function dedupeNearestParking(
  items: Array<{ spot: ParkingSpot; distanceM?: number }>,
  originLat: number,
  originLng: number,
  maxDistM = 20,
): NearestParkingOption[] {
  const ranked = items
    .map(({ spot }) => ({
      spot,
      distanceM: distanceMeters(originLat, originLng, spot.lat, spot.lng),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)

  const kept: NearestParkingOption[] = []
  const usedKeys = new Set<string>()

  for (const item of ranked) {
    const dup = kept.find(
      (k) =>
        namesMatch(k.spot, item.spot) &&
        distanceMeters(k.spot.lat, k.spot.lng, item.spot.lat, item.spot.lng) <
          maxDistM,
    )
    if (dup) continue

    let optionKey = item.spot.id
    if (!optionKey || usedKeys.has(optionKey)) {
      optionKey = uniqueParkingFeatureId(
        item.spot.id,
        item.spot.lat,
        item.spot.lng,
        kept.length,
      )
      // Still colliding — force index suffix
      if (usedKeys.has(optionKey)) {
        optionKey = `${optionKey}#${kept.length}`
      }
    }
    usedKeys.add(optionKey)
    kept.push({
      spot: item.spot,
      distanceM: item.distanceM,
      optionKey,
    })
  }
  return kept
}

/** Collect nearest roadside/lot options around a search destination. */
export function collectNearestAround(
  spots: ParkingSpot[],
  lat: number,
  lng: number,
  opts?: { excludeIds?: Iterable<string>; limit?: number },
): NearestParkingOption[] {
  const exclude = new Set(opts?.excludeIds ?? [])
  const limit = opts?.limit ?? 5
  const radii = [400, 700, 1100, 1800, 2500, 4000]

  for (const r of radii) {
    const raw: Array<{ spot: ParkingSpot; distanceM: number }> = []
    for (const s of spots) {
      if (exclude.has(s.id)) continue
      const isRoadside =
        s.featureType === 'on-street-line' ||
        Boolean(s.line) ||
        s.kind === 'street'
      const isLot =
        s.featureType === 'off-street-lot' ||
        s.featureType === 'municipal-zone' ||
        Boolean(s.polygon) ||
        s.kind === 'lot'
      if (!isRoadside && !isLot) continue
      const d = distanceMeters(lat, lng, s.lat, s.lng)
      if (d <= r) raw.push({ spot: s, distanceM: d })
    }
    const deduped = dedupeNearestParking(raw, lat, lng, 20)
    if (deduped.length >= 3 || r === radii[radii.length - 1]) {
      return deduped.slice(0, limit)
    }
  }
  return []
}
