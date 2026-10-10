/**
 * Tallinn paid-zone detection with explicit priority when polygons overlap:
 * VANALINN > SÜDALINN > KESKLINN > PIRITA.
 *
 * PAID_ZONES coords are [lat, lng]; Turf expects [lng, lat].
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point, polygon as turfPolygon } from '@turf/helpers'
import { PAID_ZONES } from '../data/parking'
import type { PaidZoneCode } from '../data/zones'

const ZONE_PRIORITY: readonly PaidZoneCode[] = [
  'VANALINN',
  'SÜDALINN',
  'KESKLINN',
  'PIRITA',
] as const

function zoneCodeOf(z: (typeof PAID_ZONES)[number]): PaidZoneCode | null {
  const raw = String(z.zone_code || z.name || '')
    .trim()
    .toUpperCase()
    .replace(/^SUU?DALINN$/, 'SÜDALINN')
  if (
    raw === 'VANALINN' ||
    raw === 'SÜDALINN' ||
    raw === 'KESKLINN' ||
    raw === 'PIRITA'
  ) {
    return raw
  }
  return null
}

/** Convert PAID_ZONES [lat,lng] ring → closed Turf [lng,lat] ring. */
function toLngLatRing(coords: [number, number][]): [number, number][] {
  const ring: [number, number][] = coords.map(([lat, lng]) => [lng, lat])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (
    first &&
    last &&
    (first[0] !== last[0] || first[1] !== last[1])
  ) {
    ring.push([first[0], first[1]])
  }
  return ring
}

/**
 * Detect municipal paid zone for a WGS84 point.
 * @param lng longitude
 * @param lat latitude
 */
export function detectZone(
  lng: number,
  lat: number,
): PaidZoneCode | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const pt = point([lng, lat])
  const hits = new Set<PaidZoneCode>()

  for (const z of PAID_ZONES) {
    const code = zoneCodeOf(z)
    if (!code || z.coords.length < 3) continue
    try {
      const poly = turfPolygon([toLngLatRing(z.coords as [number, number][])])
      if (booleanPointInPolygon(pt, poly)) hits.add(code)
    } catch {
      /* skip invalid ring */
    }
  }

  for (const code of ZONE_PRIORITY) {
    if (hits.has(code)) return code
  }
  return null
}

export { ZONE_PRIORITY }
