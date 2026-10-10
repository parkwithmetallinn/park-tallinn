/**
 * Tallinn municipal paid-zone lookup + OSM tag overrides.
 *
 * OSM often tags curb / lot parking inside Kesklinn as fee=no, which must
 * NEVER paint as unlimited Tasuta (green). Zone rates + 15 min clock apply.
 */

import { PAID_ZONES } from '../data/parking'
import { pointInPolygon } from './geojsonPolygons'

export type TallinnPaidZoneHit = {
  zone_code: string
  name: string
  price_per_hour: number
  free_minutes: number
  operator: string
}

/**
 * Kesklinn ring extended south/west so A. Le Coq Arena / Jalgpalli tn
 * falls inside the municipal paid zone (OSM fee=no tags are unreliable there).
 */
const KESKLINN_RING_FIXED: [number, number][] = [
  [59.44921, 24.75986],
  [59.44779, 24.75421],
  [59.446, 24.75525],
  [59.44353, 24.75316],
  [59.43926, 24.73617],
  [59.43612, 24.73234],
  [59.43248, 24.72329],
  [59.42444, 24.72868],
  // South-west spur — Asula / Jalgpalli / A. Le Coq Arena + curb lots
  [59.4225, 24.7265],
  [59.4205, 24.7258],
  [59.4180, 24.7265],
  [59.4172, 24.7310],
  [59.4170, 24.7380],
  [59.4175, 24.7480],
  [59.4188, 24.7600],
  [59.42096, 24.7907],
  [59.42626, 24.7809],
  [59.43342, 24.79029],
  [59.44041, 24.80693],
  [59.44354, 24.81248],
  [59.44616, 24.81245],
  [59.45117, 24.80606],
  [59.44346, 24.7897],
  [59.44606, 24.77739],
  [59.44358, 24.77133],
  [59.44424, 24.76786],
  [59.44198, 24.76077],
  [59.44534, 24.76733],
  [59.44548, 24.76236],
  [59.44974, 24.77472],
  [59.45163, 24.76574],
  [59.44804, 24.76355],
  [59.44921, 24.75986],
]

function zoneRing(zoneName: string, fallback: [number, number][]): [number, number][] {
  if (zoneName === 'Kesklinn') return KESKLINN_RING_FIXED
  return fallback
}

/** Point-in-polygon against Tallinn PAID_ZONES (Kesklinn ring corrected). */
export function lookupTallinnPaidZone(
  lat: number,
  lng: number,
): TallinnPaidZoneHit | null {
  for (const z of PAID_ZONES) {
    const ring = zoneRing(z.name, z.coords)
    if (!pointInPolygon(lat, lng, ring)) continue
    return {
      zone_code: z.zone_code || z.name.toUpperCase(),
      name: z.name,
      price_per_hour: z.price_per_hour ?? 0,
      free_minutes: z.free_minutes ?? 0,
      operator: z.operator || 'Tallinna Linn',
    }
  }
  return null
}

/** A. Le Coq Arena / Lilleküla stadium operator lots (P1–P6). */
export function isArenaStadiumParking(p: {
  operator?: unknown
  zone?: unknown
  zone_code?: unknown
  name?: unknown
  ref?: unknown
}): boolean {
  const op = String(p.operator ?? '')
    .trim()
    .toLowerCase()
  const name = String(p.name ?? '')
    .trim()
    .toLowerCase()
  const zone = String(p.zone ?? p.zone_code ?? p.ref ?? '')
    .trim()
    .toUpperCase()
  if (/le\s*coq|a\.?\s*le\s*coq\s*arena|lillek[uü]la\s*staadion/.test(op + ' ' + name)) {
    return true
  }
  if (/^P[1-6]$/.test(zone) && (op.includes('arena') || name.includes('arena'))) {
    return true
  }
  // Bare P1–P6 near stadium often only carry zone=Pn
  if (/^P[1-6]$/.test(zone) && (op.includes('le coq') || op.includes('arena'))) {
    return true
  }
  if (/^P[1-6]$/.test(zone)) return true
  return false
}

/**
 * Merge municipal-zone / stadium overrides into raw OSM-like properties
 * BEFORE classification. Mutates and returns the same object.
 */
export function applyTallinnZoneOverrides(
  props: Record<string, unknown>,
  lat: number,
  lng: number,
): Record<string, unknown> {
  const arena = isArenaStadiumParking(props)
  if (arena) {
    // Event / stadium lots — paid (or verify on site). Never unlimited free.
    props.fee = 'yes'
    props.charge = props.charge || 'event / paid'
    props.price_per_hour =
      typeof props.price_per_hour === 'number' && props.price_per_hour > 0
        ? props.price_per_hour
        : 2.5
    props.free_minutes = 0
    props.operator = props.operator || 'A. Le Coq Arena'
    props.verified_free_hint = false
    props.enriched_as = 'arena_stadium_paid'
    props.rules = 'paid'
    return props
  }

  const zone = lookupTallinnPaidZone(lat, lng)
  if (!zone) {
    // Stale build-time "free_outside_zones" must not force green when we
    // later expand the ring — leave raw tags for normal classification.
    return props
  }

  const access = String(props.access ?? '')
    .trim()
    .toLowerCase()
  // Keep truly private / customer lots out of municipal paint
  if (
    access === 'private' ||
    access === 'customers' ||
    access === 'residents' ||
    access === 'employees'
  ) {
    return props
  }

  // Inside municipal paid zone: OSM fee=no / build-time free_outside_zones
  // are unreliable for public curb / surface lots — apply official rates.
  props.zone = props.zone || zone.zone_code
  props.zone_code = props.zone_code || zone.zone_code
  props.operator = props.operator || zone.operator
  props.price_per_hour =
    typeof props.price_per_hour === 'number' && Number(props.price_per_hour) > 0
      ? props.price_per_hour
      : zone.price_per_hour
  props.free_minutes =
    typeof props.free_minutes === 'number' && Number(props.free_minutes) > 0
      ? props.free_minutes
      : zone.free_minutes
  if (zone.free_minutes > 0 && !props.maxstay) {
    props.maxstay = `${zone.free_minutes} min`
  }
  props.fee = 'yes'
  props.verified_free_hint = false
  props.enriched_from_zone = zone.zone_code
  props.enriched_as = 'tallinn_paid_zone'
  // Keep free-clock window discoverable by Kellaga filter (not pure paid)
  props.rules = zone.free_minutes > 0 ? 'clock' : 'paid'
  props.desc =
    props.desc ||
    `${zone.name} tasuline tsoon · ${zone.free_minutes > 0 ? `${zone.free_minutes} min kellaga` : 'tasuline'}`
  return props
}
