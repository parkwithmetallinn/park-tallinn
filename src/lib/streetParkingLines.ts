import { normalizeSpot } from './geojson'
import { mapLabelForLayer } from './mapLabels'
import {
  emptyPurgeStats,
  getParkingExclusionReason,
  isPaidFeeTag,
  isUnclassifiedParking,
  isVerifiedFreeParking,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
  PARKING_COLOR_UNKNOWN,
  type ParkingPrepPurgeStats,
} from './parkingClassification'

/** Last prepareStreetParking purge counts (for health checks). */
let lastStreetPurgeStats: ParkingPrepPurgeStats = emptyPurgeStats()

export function getLastStreetPurgeStats(): ParkingPrepPurgeStats {
  return lastStreetPurgeStats
}
import type { ParkingLayerKey, ParkingOperator, ParkingSpot } from '../types'

/** @deprecated Use estonia_parking_master via parkingDataCache / loadEstoniaParkingMaster */
export const STREET_PARKING_URL = '/data/estonia_parking_master.geojson'

export const STREET_PARKING_SOURCE = 'street-parking'
export const STREET_PARKING_LINE_LAYER = 'street-parking-line'
export const STREET_PARKING_CASING_LAYER = 'street-parking-casing'
export const STREET_PARKING_HIT_LAYER = 'street-parking-hit'

/** Product colors for roadside curb lines — green only for verified free. */
export const STREET_COLOR = {
  free: PARKING_COLOR_FREE,
  paid: PARKING_COLOR_PAID,
  timed: PARKING_COLOR_TIMED,
  unknown: PARKING_COLOR_UNKNOWN,
} as const

export type StreetRules = 'free' | 'paid' | 'clock' | 'unknown'

export type StreetParkingProps = {
  id: string
  name: string
  street: string
  zone_code: string
  zone: string
  rules: StreetRules
  operator: string
  layer: ParkingLayerKey
  free_minutes: number
  price_per_hour: number
  badge: string
  address: string
  desc?: string
  color: string
  /** True only for verified free curb (matches Tasuta filter + green). */
  verified_free: boolean
}

type LineGeom = {
  type: 'LineString'
  coordinates: number[][]
}

export type StreetParkingFeature = {
  type: 'Feature'
  id: string
  properties: StreetParkingProps
  geometry: LineGeom
}

export type StreetParkingCollection = {
  type: 'FeatureCollection'
  features: StreetParkingFeature[]
}

type RawFeature = {
  type: string
  id?: string | number
  properties?: Record<string, unknown> | null
  geometry?: {
    type: string
    coordinates?: number[][] | number[][][] | number[][][][]
  } | null
}

type RawCollection = {
  type: string
  features?: RawFeature[]
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function meterDist(a: number[], b: number[]): number {
  const [aLng, aLat] = a
  const [bLng, bLat] = b
  return Math.hypot(
    (aLat - bLat) * 111_320,
    (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
  )
}

function dropClosing(ring: number[][]): number[][] {
  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    return ring.slice(0, -1)
  }
  return ring.slice()
}

/** Convert a street_side / lane polygon ring into a curb LineString (longest edge chain). */
function polygonRingToCurbLine(ring: number[][]): number[][] | null {
  const pts = dropClosing(ring)
  if (pts.length < 2) return null
  if (pts.length === 2) return pts

  // Find shortest edge — open the ring there so the longer chain is the curb path
  let shortI = 0
  let shortLen = Infinity
  for (let i = 0; i < pts.length; i++) {
    const len = meterDist(pts[i], pts[(i + 1) % pts.length])
    if (len < shortLen) {
      shortLen = len
      shortI = i
    }
  }

  const start = (shortI + 1) % pts.length
  const line: number[][] = []
  for (let k = 0; k < pts.length; k++) {
    line.push(pts[(start + k) % pts.length])
  }
  // Drop the last point if it would re-close across the short edge
  if (line.length > 2) line.pop()
  return line.length >= 2 ? line : null
}

function extractLineCoords(geom: NonNullable<RawFeature['geometry']>): number[][] | null {
  if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
    const coords = geom.coordinates as number[][]
    return coords.length >= 2 ? coords : null
  }
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    const ring = (geom.coordinates as number[][][])[0]
    if (!ring) return null
    return polygonRingToCurbLine(ring)
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const ring = (geom.coordinates as number[][][][])[0]?.[0]
    if (!ring) return null
    return polygonRingToCurbLine(ring)
  }
  return null
}

/** Skip highway ways tagged parking:lane:*=no with no amenity=parking. */
function isParkingFeature(p: Record<string, unknown>): boolean {
  if (str(p.amenity) === 'parking') return true
  const parking = str(p.parking).toLowerCase()
  if (parking === 'street_side' || parking === 'lane' || parking === 'on_kerb') return true

  let anyLane = false
  let anyAllowed = false
  for (const [k, v] of Object.entries(p)) {
    if (!k.startsWith('parking:lane') && !k.startsWith('parking:both') && !k.startsWith('parking:left') && !k.startsWith('parking:right')) {
      continue
    }
    anyLane = true
    const val = str(v).toLowerCase()
    if (val && val !== 'no') anyAllowed = true
  }
  return anyLane && anyAllowed
}

function parseMaxstayMinutes(maxstay: string): number {
  if (!maxstay) return 0
  const s = maxstay.toLowerCase().trim()
  if (s === 'unlimited' || s === 'no') return 0
  const hours = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/)
  if (hours) return Math.round(parseFloat(hours[1]) * 60)
  const mins = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/)
  if (mins) return parseInt(mins[1], 10)
  const combo = s.match(/(\d+(?:\.\d+)?)\s*hours?/)
  if (combo) return Math.round(parseFloat(combo[1]) * 60)
  const comboM = s.match(/(\d+)\s*minutes?/)
  if (comboM) return parseInt(comboM[1], 10)
  return 0
}

function classifyRules(p: Record<string, unknown>): {
  rules: StreetRules
  layer: ParkingLayerKey
  free_minutes: number
  price_per_hour: number
  color: string
  verified_free: boolean
} {
  const fee = str(p.fee)
  const maxstay = str(p.maxstay)
  const maxMins = parseMaxstayMinutes(maxstay)
  const feeIsPaid = isPaidFeeTag(fee, p.charge)
  const verified_free = isVerifiedFreeParking({
    fee,
    access: p.access,
    zone: p.zone ?? p.zone_code ?? p.ref,
    charge: p.charge,
    rules: p.rules,
  })

  // Curated schema fallback — only trust rules=free when verified
  const curatedRules = str(p.rules).toLowerCase()
  if (curatedRules === 'free' || curatedRules === 'clock' || curatedRules === 'paid') {
    if (curatedRules === 'free' && verified_free) {
      return {
        rules: 'free',
        layer: 'free_street',
        free_minutes: Number(p.free_minutes ?? 0),
        price_per_hour: 0,
        color: STREET_COLOR.free,
        verified_free: true,
      }
    }
    if (curatedRules === 'clock') {
      return {
        rules: 'clock',
        layer: 'timed',
        free_minutes: Number(p.free_minutes ?? (maxMins || 15)),
        price_per_hour: Number(p.price_per_hour ?? 0),
        color: STREET_COLOR.timed,
        verified_free: false,
      }
    }
    if (curatedRules === 'paid' || feeIsPaid) {
      return {
        rules: 'paid',
        layer: 'municipal',
        free_minutes: 0,
        price_per_hour: Number(p.price_per_hour ?? 2.5),
        color: STREET_COLOR.paid,
        verified_free: false,
      }
    }
  }

  if (feeIsPaid) {
    return {
      rules: 'paid',
      layer: 'municipal',
      free_minutes: 0,
      price_per_hour: Number(p.price_per_hour ?? 2.5),
      color: STREET_COLOR.paid,
      verified_free: false,
    }
  }

  // Verified free + maxstay → clock filter (blue), not unlimited Tasuta green
  if (verified_free && (maxMins > 0 || maxstay)) {
    return {
      rules: 'clock',
      layer: 'timed',
      free_minutes: maxMins || Number(p.free_minutes ?? 15),
      price_per_hour: 0,
      color: STREET_COLOR.timed,
      verified_free: false,
    }
  }

  if (verified_free) {
    return {
      rules: 'free',
      layer: 'free_street',
      free_minutes: 0,
      price_per_hour: 0,
      color: STREET_COLOR.free,
      verified_free: true,
    }
  }

  if (maxMins > 0) {
    return {
      rules: 'clock',
      layer: 'timed',
      free_minutes: maxMins || Number(p.free_minutes ?? 15),
      price_per_hour: 0,
      color: STREET_COLOR.timed,
      verified_free: false,
    }
  }

  // Untagged / private / unclassified curb — muted gray, NOT free green
  return {
    rules: 'unknown',
    layer: 'municipal',
    free_minutes: 0,
    price_per_hour: 0,
    color: STREET_COLOR.unknown,
    verified_free: false,
  }
}

function lineMidpoint(coords: number[][]): { lat: number; lng: number } {
  const mid = coords[Math.floor(coords.length / 2)]
  return { lng: mid[0], lat: mid[1] }
}

function lineToLatLng(coords: number[][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng] as [number, number])
}

/**
 * Enrich Overpass / curated street parking GeoJSON as curb LineStrings.
 * Polygons (street_side / lane) are converted to longest-chain curb lines.
 * Purges private / residential and non-public underground features.
 */
export function prepareStreetParking(raw: RawCollection): StreetParkingCollection {
  const features: StreetParkingFeature[] = []
  const purge = emptyPurgeStats()
  for (const f of raw.features ?? []) {
    if (!f.geometry) continue
    const p = f.properties ?? {}
    if (!isParkingFeature(p)) continue
    purge.input++

    const exclusion = getParkingExclusionReason(p)
    if (exclusion) {
      purge.purged[exclusion]++
      purge.purgedTotal++
      continue
    }

    const coords = extractLineCoords(f.geometry)
    if (!coords || coords.length < 2) continue

    const id = str(p['@id'] ?? p.id ?? f.id) || `street-${features.length}`
    const { rules, layer, free_minutes, price_per_hour, color, verified_free } = classifyRules(p)
    const nameTag = str(p.name)
    const street = nameTag || str(p['addr:street']) || 'Tänav'
    const zone = str(p.zone ?? p.zone_code ?? p.ref)
    const zone_code =
      zone ||
      (rules === 'free'
        ? 'FREE'
        : rules === 'clock'
          ? 'KELL'
          : rules === 'paid'
            ? 'PAID'
            : 'ZONE')
    const operator = str(p.operator) || 'Tallinna Linn'
    const address = [str(p['addr:street']), str(p['addr:housenumber']), str(p['addr:city'])]
      .filter(Boolean)
      .join(', ')

    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name: nameTag || `${street} · ${zone_code}`,
        street,
        zone_code,
        zone: zone_code,
        rules,
        operator,
        layer,
        free_minutes,
        price_per_hour,
        badge: mapLabelForLayer(layer, zone_code),
        address: address || street,
        desc: [
          rules === 'free' ? 'Tasuta tänavaparkimine' : null,
          rules === 'clock' ? `Kellaga · ${free_minutes} min` : null,
          rules === 'paid' ? 'Tasuline tsoon' : null,
          rules === 'unknown' ? 'Määramata / kontrolli silte' : null,
          str(p.description),
        ]
          .filter(Boolean)
          .join(' · '),
        color,
        verified_free,
      },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }
  purge.kept = features.length
  lastStreetPurgeStats = purge
  return { type: 'FeatureCollection', features }
}

export function streetFeatureToSpot(f: StreetParkingFeature): ParkingSpot {
  const { lat, lng } = lineMidpoint(f.geometry.coordinates)
  const p = f.properties as StreetParkingFeature['properties'] & {
    source?: string
    lastVerified?: string
    cityId?: 'tallinn' | 'parnu'
    freeNow?: boolean
    freeUntil?: string | null
    freeReason?: string
    exemptions?: Array<'ev_m1' | 'motorcycle' | 'disabled'>
    verifyOnSite?: boolean
    parnuZone?: 'kesklinn' | 'rand' | null
  }
  const isFree = p.verified_free || p.rules === 'free' || p.layer === 'free_street'
  const isClock = p.rules === 'clock' || p.layer === 'timed'
  const spot = normalizeSpot({
    id: p.id,
    name: p.name,
    featureType: 'on-street-line',
    operator: p.operator as ParkingOperator,
    layer: p.layer,
    zone_code: p.zone_code,
    free_minutes: p.free_minutes,
    price_per_hour: p.price_per_hour,
    badge: p.badge,
    timeLimit: isFree
      ? 'Tasuta tänav'
      : isClock
        ? `${p.free_minutes || 15} min · kellaga`
        : p.rules === 'unknown'
          ? `Määramata · ${p.zone_code}`
          : `Tasuline · ${p.zone_code}`,
    lat,
    lng,
    address: p.address || p.street,
    desc: p.desc ?? `${p.street} · ${p.zone_code}`,
    type: isFree ? 'free' : isClock ? 'timed' : 'paid',
    kind: 'street',
    landmark: true,
    line: lineToLatLng(f.geometry.coordinates),
    source: p.source,
    lastVerified: p.lastVerified,
    cityId: p.cityId,
    freeNow: p.freeNow,
    freeUntil: p.freeUntil,
    freeReason: p.freeReason,
    exemptions: p.exemptions,
    verifyOnSite: p.verifyOnSite,
    parnuZone: p.parnuZone,
  })
  if (p.badge === 'FREE' || p.badge === 'KELL' || p.badge === 'EV') {
    spot.badge = p.badge
    spot.zone_code = p.badge
  }
  return spot
}

export function streetCollectionToSpots(fc: StreetParkingCollection): ParkingSpot[] {
  return fc.features.map(streetFeatureToSpot)
}

/** Filter a street FeatureCollection by app layer keys (top filters). */
export function filterStreetCollection(
  fc: StreetParkingCollection,
  layers: ParkingLayerKey[] | 'all' | 'verified_free' | 'unclassified',
): StreetParkingCollection {
  if (layers === 'all') return fc
  if (layers === 'verified_free') {
    return {
      type: 'FeatureCollection',
      features: fc.features.filter(
        (f) => f.properties.verified_free || f.properties.layer === 'free_street',
      ),
    }
  }
  if (layers === 'unclassified') {
    return {
      type: 'FeatureCollection',
      features: fc.features.filter((f) =>
        isUnclassifiedParking({
          layer: f.properties.layer,
          verified_free: f.properties.verified_free,
          price_per_hour: f.properties.price_per_hour,
          zone_code: f.properties.zone_code,
          operator: f.properties.operator,
          color: f.properties.color,
        }),
      ),
    }
  }
  return {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => layers.includes(f.properties.layer)),
  }
}

export async function loadStreetParking(
  url = STREET_PARKING_URL,
): Promise<StreetParkingCollection> {
  if (url.includes('estonia_parking_master')) {
    const { loadEstoniaParkingMaster } = await import('./estoniaParkingMaster')
    return (await loadEstoniaParkingMaster(url)).streets
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load street parking (${res.status})`)
  const raw = (await res.json()) as RawCollection
  return prepareStreetParking(raw)
}
