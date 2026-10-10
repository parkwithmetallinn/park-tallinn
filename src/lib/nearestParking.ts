/**
 * Nearest-parking list helpers: unique keys, street clustering, category diversity.
 */

import { distanceMeters } from './geo'
import {
  hasExplicitPaidZoneCode,
  isClockLimitedParking,
  isTallinnClockZone,
  isUnclassifiedParking,
  isUnlimitedFreeParking,
} from './parkingClassification'
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

export function isStreetParkingSpot(spot: ParkingSpot): boolean {
  return (
    spot.featureType === 'on-street-line' ||
    Boolean(spot.line) ||
    spot.kind === 'street'
  )
}

export function isLotParkingSpot(spot: ParkingSpot): boolean {
  return (
    spot.featureType === 'off-street-lot' ||
    spot.featureType === 'municipal-zone' ||
    Boolean(spot.polygon) ||
    spot.kind === 'lot'
  )
}

/** Identity for “same rules” clustering (FREE / 120 MIN / €/h). */
export function parkingRulesKey(spot: ParkingSpot): string {
  if (isUnlimitedFreeParking(spot)) return 'free'
  if (isClockLimitedParking(spot)) {
    return `clock:${Math.max(1, Math.round(spot.free_minutes || 15))}`
  }
  const price = Number(spot.price_per_hour || 0)
  const zone = String(spot.zone_code || spot.badge || '').toUpperCase()
  return `paid:${price.toFixed(2)}:${zone}`
}

/**
 * Tasuline — spots with a real paid signal.
 * Tallinn zones (Kesklinn, Vanalinn, Südalinn, Pirita) stay included even
 * when they also offer a free clock window (those also appear under Kellaga).
 *
 * Bare `municipal` / AVALIK lots with no €/h and no paid zone code are NOT
 * paid — they are unclassified and must not crowd out Kellaga / Odavaim.
 */
export function isPaidParkingSpot(spot: ParkingSpot): boolean {
  if (isUnlimitedFreeParking(spot)) return false
  if (isUnclassifiedParking(spot)) return false

  // Explicit payment / Tallinn municipal paid+clock zones
  if (
    Number(spot.price_per_hour) > 0 ||
    spot.badge === 'PAID' ||
    isTallinnClockZone(spot.zone_code) ||
    isTallinnClockZone(spot.badge) ||
    isTallinnClockZone(spot.name) ||
    hasExplicitPaidZoneCode(spot.zone_code)
  ) {
    return true
  }

  // Pure clock-only (no price, not a Tallinn paid zone) → Kellaga only
  if (isClockLimitedParking(spot) && Number(spot.price_per_hour) <= 0) {
    return false
  }

  // Commercial / brand operators are paid even when OSM omits charge
  return [
    'europark',
    'snabb',
    'citypark',
    'uhisteenused',
    'parkit',
    'park_ride',
    'loading',
  ].includes(spot.layer)
}

/** Kellaga — any free-clock window (incl. Tallinn 15 min + paid after). */
export function isKellagaParkingSpot(spot: ParkingSpot): boolean {
  return isClockLimitedParking(spot)
}

/** Street label for aggregated cards, e.g. "Odra tn". */
export function extractStreetLabel(spot: ParkingSpot): string {
  const fromAddr = (spot.address || '').split(',')[0]?.trim() || ''
  const raw = fromAddr || (spot.name || '').trim()
  if (!raw) return 'Tänav'
  // "Odra tn 12" / "Odra 5a" → "Odra tn" / "Odra"
  let street = raw.replace(/\s+\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?$/u, '').trim()
  if (!street) street = raw
  if (/^(surface|zone|parking|parkla|tänav|street|lot|unknown)$/i.test(street)) {
    return 'Tänav'
  }
  return street
}

function clusterCategoryLabel(spot: ParkingSpot): string {
  if (isUnlimitedFreeParking(spot)) return 'Tasuta parkimine'
  if (isClockLimitedParking(spot)) return 'Kellaga parkimine'
  return 'Tasuline parkimine'
}

function withUniqueKey(
  spot: ParkingSpot,
  distanceM: number,
  usedKeys: Set<string>,
  index: number,
): NearestParkingOption {
  let optionKey = spot.id
  if (!optionKey || usedKeys.has(optionKey)) {
    optionKey = uniqueParkingFeatureId(spot.id, spot.lat, spot.lng, index)
    if (usedKeys.has(optionKey)) {
      optionKey = `${optionKey}#${index}`
    }
  }
  usedKeys.add(optionKey)
  return { spot, distanceM, optionKey }
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
    kept.push(withUniqueKey(item.spot, item.distanceM, usedKeys, kept.length))
  }
  return kept
}

/**
 * Group adjacent street nodes on the same road segment (≤100 m) that share
 * identical rules (e.g. all "120 MIN") into one aggregated recommendation.
 */
export function clusterAdjacentStreetParking(
  options: NearestParkingOption[],
  maxDistM = 100,
): NearestParkingOption[] {
  const streets = options.filter((o) => isStreetParkingSpot(o.spot))
  const lots = options.filter((o) => !isStreetParkingSpot(o.spot))
  if (streets.length <= 1) return options

  const byRules = new Map<string, NearestParkingOption[]>()
  for (const o of streets) {
    const key = parkingRulesKey(o.spot)
    const list = byRules.get(key) ?? []
    list.push(o)
    byRules.set(key, list)
  }

  const clustered: NearestParkingOption[] = []
  const usedKeys = new Set<string>()

  for (const group of byRules.values()) {
    const remaining = [...group].sort((a, b) => a.distanceM - b.distanceM)
    while (remaining.length) {
      const seed = remaining.shift()!
      const members = [seed]
      for (let i = remaining.length - 1; i >= 0; i--) {
        const cand = remaining[i]!
        const near = members.some(
          (m) =>
            distanceMeters(
              m.spot.lat,
              m.spot.lng,
              cand.spot.lat,
              cand.spot.lng,
            ) <= maxDistM,
        )
        if (!near) continue
        members.push(cand)
        remaining.splice(i, 1)
      }

      // Prefer a shared street label across the cluster
      const streetVotes = new Map<string, number>()
      for (const m of members) {
        const label = extractStreetLabel(m.spot)
        streetVotes.set(label, (streetVotes.get(label) ?? 0) + 1)
      }
      const street =
        [...streetVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        extractStreetLabel(seed.spot)

      const representative = seed.spot
      const aggregatedName =
        members.length > 1
          ? `${street} - ${clusterCategoryLabel(representative)}`
          : representative.name

      const spot: ParkingSpot =
        members.length > 1
          ? {
              ...representative,
              name: aggregatedName,
              address: street,
              desc:
                representative.desc ||
                `${street} · ${members.length} lõiku · ${parkingRulesKey(representative)}`,
            }
          : representative

      clustered.push(
        withUniqueKey(spot, seed.distanceM, usedKeys, clustered.length),
      )
    }
  }

  // Lots unchanged (re-key against street keys)
  for (const lot of lots) {
    clustered.push(
      withUniqueKey(lot.spot, lot.distanceM, usedKeys, clustered.length),
    )
  }

  return clustered.sort((a, b) => a.distanceM - b.distanceM)
}

/**
 * Default top-N list with categorical diversity:
 * 1) nearest 100% FREE lot/spot
 * 2) nearest KELLAGA
 * 3) nearest TASULINE
 * then remaining closest by distance.
 */
export function diversifyNearestParking(
  options: NearestParkingOption[],
  limit = 5,
): NearestParkingOption[] {
  if (options.length <= 1) return options.slice(0, limit)
  const byDist = [...options].sort((a, b) => a.distanceM - b.distanceM)
  const picked: NearestParkingOption[] = []
  const used = new Set<string>()

  const takeFirst = (pred: (spot: ParkingSpot) => boolean) => {
    const hit = byDist.find((o) => !used.has(o.optionKey) && pred(o.spot))
    if (!hit) return
    used.add(hit.optionKey)
    picked.push(hit)
  }

  // Slot 1: nearest 100% FREE lot when available, else any FREE spot
  takeFirst((s) => isUnlimitedFreeParking(s) && isLotParkingSpot(s))
  if (picked.length === 0) {
    takeFirst((s) => isUnlimitedFreeParking(s))
  }

  // Slot 2: nearest KELLAGA
  takeFirst((s) => isClockLimitedParking(s))
  // Slot 3: nearest TASULINE
  takeFirst((s) => isPaidParkingSpot(s))

  for (const o of byDist) {
    if (picked.length >= limit) break
    if (used.has(o.optionKey)) continue
    used.add(o.optionKey)
    picked.push(o)
  }
  return picked.slice(0, limit)
}

/**
 * Build a proximity-sorted pool that still keeps category diversity so
 * Odavaim / Kellaga / Tasuline tabs are not starved by one dense cluster
 * (e.g. unlabeled municipal lots crowding out clock zones).
 */
function diversifyNearestPool(
  clustered: NearestParkingOption[],
  limit: number,
): NearestParkingOption[] {
  const byDist = sortByProximity(clustered)
  const out: NearestParkingOption[] = []
  const used = new Set<string>()

  const take = (pred: (o: NearestParkingOption) => boolean, n: number) => {
    let got = 0
    for (const o of byDist) {
      if (got >= n) break
      if (used.has(o.optionKey)) continue
      if (!pred(o)) continue
      used.add(o.optionKey)
      out.push(o)
      got++
    }
  }

  // Reserve slots for each filter category (closest first within category)
  take((o) => isUnlimitedFreeParking(o.spot), 3)
  take((o) => isKellagaParkingSpot(o.spot), 4)
  take((o) => isPaidParkingSpot(o.spot), 4)
  // Fill remaining with closest overall (any category)
  take(() => true, Math.max(limit, 12) - out.length)

  return sortByProximity(out).slice(0, Math.max(limit, 12))
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
  const maxRadius = 4000

  const scored: Array<{ spot: ParkingSpot; distanceM: number }> = []
  for (const s of spots) {
    if (exclude.has(s.id)) continue
    if (!isStreetParkingSpot(s) && !isLotParkingSpot(s)) continue
    const d = distanceMeters(lat, lng, s.lat, s.lng)
    if (d <= maxRadius) scored.push({ spot: s, distanceM: d })
  }
  scored.sort((a, b) => a.distanceM - b.distanceM)

  // Closest cluster candidates + category seeds so filters are never starved
  // by a dense pack of unlabeled lots. Cap size for cluster performance.
  const byId = new Map<string, { spot: ParkingSpot; distanceM: number }>()
  const seed = (
    pred: (s: ParkingSpot) => boolean,
    n: number,
  ) => {
    let got = 0
    for (const row of scored) {
      if (got >= n) break
      if (!pred(row.spot)) continue
      if (byId.has(row.spot.id)) continue
      byId.set(row.spot.id, row)
      got++
    }
  }
  // Spatial neighborhood first
  for (const row of scored.slice(0, 60)) {
    byId.set(row.spot.id, row)
  }
  seed((s) => isUnlimitedFreeParking(s), 6)
  seed((s) => isKellagaParkingSpot(s), 8)
  seed((s) => isPaidParkingSpot(s), 8)

  const raw = [...byId.values()]
  const deduped = dedupeNearestParking(raw, lat, lng, 20)
  const clustered = clusterAdjacentStreetParking(deduped, 100)
  return diversifyNearestPool(clustered, limit)
}

/**
 * Effective €/h for “Odavaim / Tasuta” ranking.
 * Unlimited free = 0. Clock-limited free window = near-zero (ignore the
 * post-window zone rate — short stays are free with a disc). Paid = €/h.
 */
export function effectiveHourlyRate(spot: ParkingSpot): number {
  if (isUnlimitedFreeParking(spot)) return 0
  if (isUnclassifiedParking(spot)) return Number.POSITIVE_INFINITY
  if (isClockLimitedParking(spot)) {
    // Free window beats any paid €/h for “odavaim” comparisons
    return 0.01
  }
  if (spot.price_per_hour > 0) return spot.price_per_hour
  if (isPaidParkingSpot(spot)) return 99
  return Number.POSITIVE_INFINITY
}

/** Closest-first by walk distance to the destination. */
export function sortByProximity(
  options: NearestParkingOption[],
): NearestParkingOption[] {
  return [...options].sort((a, b) => a.distanceM - b.distanceM)
}

/**
 * Odavaim / Tasuta:
 * - Completely free (unlimited) spots when any exist
 * - Else spots at the absolute lowest effective rate
 * Always sorted by walk proximity (closest first).
 */
export function filterOdavaimTasuta(
  options: NearestParkingOption[],
): NearestParkingOption[] {
  const free = options.filter((o) => isUnlimitedFreeParking(o.spot))
  if (free.length > 0) return sortByProximity(free)

  const priced = options.filter((o) => {
    if (isUnclassifiedParking(o.spot)) return false
    const r = effectiveHourlyRate(o.spot)
    return Number.isFinite(r)
  })
  if (priced.length === 0) {
    // Last resort: any clock window still beats empty list
    const clock = options.filter((o) => isKellagaParkingSpot(o.spot))
    return sortByProximity(clock)
  }

  let minRate = Number.POSITIVE_INFINITY
  for (const o of priced) {
    const r = effectiveHourlyRate(o.spot)
    if (r < minRate) minRate = r
  }
  if (!Number.isFinite(minRate)) return sortByProximity(priced)

  return sortByProximity(
    priced.filter((o) => effectiveHourlyRate(o.spot) === minRate),
  )
}

/**
 * @deprecated Prefer filterOdavaimTasuta + sortByProximity.
 * Kept for callers that still import the old name.
 */
export function sortOdavaimTasuta(
  options: NearestParkingOption[],
): NearestParkingOption[] {
  return filterOdavaimTasuta(options)
}
