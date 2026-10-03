/**
 * Nearest-parking list helpers: unique keys, street clustering, category diversity.
 */

import { distanceMeters } from './geo'
import {
  isClockLimitedParking,
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

export function isPaidParkingSpot(spot: ParkingSpot): boolean {
  if (isUnlimitedFreeParking(spot) || isClockLimitedParking(spot)) return false
  if (spot.price_per_hour > 0 || spot.badge === 'PAID') return true
  return [
    'europark',
    'snabb',
    'citypark',
    'uhisteenused',
    'parkit',
    'municipal',
    'park_ride',
  ].includes(spot.layer)
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

  let bestPool: NearestParkingOption[] = []

  for (const r of radii) {
    const raw: Array<{ spot: ParkingSpot; distanceM: number }> = []
    for (const s of spots) {
      if (exclude.has(s.id)) continue
      if (!isStreetParkingSpot(s) && !isLotParkingSpot(s)) continue
      const d = distanceMeters(lat, lng, s.lat, s.lng)
      if (d <= r) raw.push({ spot: s, distanceM: d })
    }
    const deduped = dedupeNearestParking(raw, lat, lng, 20)
    const clustered = clusterAdjacentStreetParking(deduped, 100)
    bestPool = clustered

    const hasFree = clustered.some((o) => isUnlimitedFreeParking(o.spot))
    const hasClock = clustered.some((o) => isClockLimitedParking(o.spot))
    const hasPaid = clustered.some((o) => isPaidParkingSpot(o.spot))
    const diverseEnough =
      clustered.length >= limit && (hasFree || hasClock) && (hasPaid || hasClock)
    if (
      (hasFree && hasClock && hasPaid) ||
      diverseEnough ||
      r === radii[radii.length - 1]
    ) {
      return diversifyNearestParking(clustered, limit)
    }
  }
  return diversifyNearestParking(bestPool, limit)
}

/**
 * Odavaim / Tasuta sort: 100% FREE always above KELLAGA, then by distance.
 * Clock spots never outrank a free lot even if closer.
 */
export function sortOdavaimTasuta(
  options: NearestParkingOption[],
): NearestParkingOption[] {
  return [...options].sort((a, b) => {
    const rank = (s: ParkingSpot) => {
      if (isUnlimitedFreeParking(s)) return 0
      if (isClockLimitedParking(s)) return 1
      if (s.price_per_hour <= 0) return 2
      return 3 + (s.price_per_hour || 99)
    }
    const d = rank(a.spot) - rank(b.spot)
    return d !== 0 ? d : a.distanceM - b.distanceM
  })
}
