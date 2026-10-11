import { normalizeSpot } from './geojson'
import { mapLabelForLayer } from './mapLabels'
import { parkingDisplayName } from './parkingDisplayName'
import { uniqueParkingFeatureId } from './nearestParking'
import {
  emptyPurgeStats,
  extractClockMinutes,
  getParkingExclusionReason,
  getParkingFilterCategory,
  hasClockKeyword,
  isPaidFeeTag,
  isUnclassifiedParking,
  isVerifiedFreeParking,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
  PARKING_COLOR_UNKNOWN,
  parseMaxstayMinutes,
  type ParkingPrepPurgeStats,
} from './parkingClassification'
import { applyTallinnZoneOverrides } from './tallinnZoneEnrichment'

/** Last prepareStreetParking purge counts (for health checks). */
let lastStreetPurgeStats: ParkingPrepPurgeStats = emptyPurgeStats()

export function getLastStreetPurgeStats(): ParkingPrepPurgeStats {
  return lastStreetPurgeStats
}
import type { ParkingLayerKey, ParkingOperator, ParkingSpot } from '../types'

/** @deprecated Use ee_parking_max via parkingDataCache / loadEstoniaParkingMaster */
export const STREET_PARKING_URL = '/data/ee_parking_max.geojson'

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
  const maxMins =
    parseMaxstayMinutes(maxstay) || extractClockMinutes(p, maxstay, p.name)
  const feeIsPaid = isPaidFeeTag(fee, p.charge)
  const verified_free = isVerifiedFreeParking({
    fee,
    access: p.access,
    zone: p.zone ?? p.zone_code ?? p.ref,
    charge: p.charge,
    rules: p.rules,
    enriched_as: p.enriched_as,
    enriched_from_zone: p.enriched_from_zone,
  })

  const curatedFreeMins = Number(p.free_minutes ?? 0)
  const clockSignal =
    curatedFreeMins > 0 ||
    maxMins > 0 ||
    hasClockKeyword(p, p.name, maxstay)

  // Curated schema fallback — only trust rules=free when verified + unlimited
  const curatedRules = str(p.rules).toLowerCase()
  if (curatedRules === 'free' || curatedRules === 'clock' || curatedRules === 'paid') {
    if (curatedRules === 'free' && verified_free) {
      // Any clock window (free_minutes / maxstay) → Kellaga, not Tasuta
      if (clockSignal) {
        return {
          rules: 'clock',
          layer: 'timed',
          free_minutes: curatedFreeMins || maxMins || 15,
          price_per_hour: 0,
          color: STREET_COLOR.timed,
          verified_free: false,
        }
      }
      return {
        rules: 'free',
        layer: 'free_street',
        free_minutes: 0,
        price_per_hour: 0,
        color: STREET_COLOR.free,
        verified_free: true,
      }
    }
    if (curatedRules === 'clock') {
      return {
        rules: 'clock',
        layer: 'timed',
        free_minutes: curatedFreeMins || maxMins || 15,
        price_per_hour: Number(p.price_per_hour ?? 0),
        color: STREET_COLOR.timed,
        verified_free: false,
      }
    }
    if (curatedRules === 'paid' || feeIsPaid) {
      const mins = curatedFreeMins || maxMins
      // Tallinn-style paid + free clock window → Kellaga (keep minutes)
      if (mins > 0) {
        return {
          rules: 'clock',
          layer: 'municipal',
          free_minutes: mins,
          price_per_hour: Number(p.price_per_hour ?? 2.5),
          color: STREET_COLOR.timed,
          verified_free: false,
        }
      }
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

  // Tallinn municipal zone / Arena overrides
  if (
    Number(p.price_per_hour) > 0 &&
    (str(p.enriched_as) === 'tallinn_paid_zone' ||
      str(p.enriched_as) === 'arena_stadium_paid')
  ) {
    const mins = Number(p.free_minutes ?? 0)
    // Arena lots have no free clock — pure paid. Tallinn zones keep 15 min.
    if (str(p.enriched_as) === 'tallinn_paid_zone' && mins > 0) {
      return {
        rules: 'clock',
        layer: 'municipal',
        free_minutes: mins,
        price_per_hour: Number(p.price_per_hour),
        color: STREET_COLOR.timed,
        verified_free: false,
      }
    }
    return {
      rules: 'paid',
      layer: 'municipal',
      free_minutes: mins,
      price_per_hour: Number(p.price_per_hour),
      color: STREET_COLOR.paid,
      verified_free: false,
    }
  }

  if (feeIsPaid) {
    const mins = Number(p.free_minutes ?? 0) || curatedFreeMins || maxMins
    if (mins > 0) {
      return {
        rules: 'clock',
        layer: 'municipal',
        free_minutes: mins,
        price_per_hour: Number(p.price_per_hour ?? 2.5),
        color: STREET_COLOR.timed,
        verified_free: false,
      }
    }
    return {
      rules: 'paid',
      layer: 'municipal',
      free_minutes: 0,
      price_per_hour: Number(p.price_per_hour ?? 2.5),
      color: STREET_COLOR.paid,
      verified_free: false,
    }
  }

  // Verified free + time window → Kellaga, never unlimited Tasuta green
  if (verified_free && clockSignal) {
    return {
      rules: 'clock',
      layer: 'timed',
      free_minutes: curatedFreeMins || maxMins || 15,
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

  if (clockSignal) {
    return {
      rules: 'clock',
      layer: 'timed',
      free_minutes: curatedFreeMins || maxMins || 15,
      price_per_hour: 0,
      color: STREET_COLOR.timed,
      verified_free: false,
    }
  }

  // Public curb without verified free / paid / clock tags → Määramata (gray).
  // Never invent Kellaga minutes or Tasuta green from missing tags.
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
  const seenIds = new Set<string>()
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

    const mid = coords[Math.floor(coords.length / 2)]
    // Override OSM fee=no inside Tallinn paid zones BEFORE classify
    applyTallinnZoneOverrides(p, mid[1], mid[0])
    let id = uniqueParkingFeatureId(
      (p['@id'] ?? p.id ?? f.id) as string | number | null | undefined,
      mid[1],
      mid[0],
      features.length,
    )
    if (seenIds.has(id)) id = `${id}#${features.length}`
    seenIds.add(id)
    const { rules, layer, free_minutes, price_per_hour, color, verified_free } = classifyRules(p)
    const nameTag = str(p.name)
    const streetAddr = str(p['addr:street'])
    const houseNo = str(p['addr:housenumber'])
    const zone = str(p.zone ?? p.zone_code ?? p.ref)
    const zone_code =
      zone ||
      (rules === 'free'
        ? 'TASUTA'
        : rules === 'clock'
          ? 'KELL'
          : rules === 'paid'
            ? 'TASULINE'
            : '')
    const operator = str(p.operator) || 'Tallinna Linn'
    const address = [streetAddr, houseNo, str(p['addr:city'])]
      .filter(Boolean)
      .join(', ')
    const name = parkingDisplayName({
      name: nameTag,
      operator,
      zone_code,
      zone,
      address,
      layer,
      'addr:street': streetAddr,
      'addr:housenumber': houseNo,
    })
    const street = streetAddr || nameTag || name

    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name,
        street,
        zone_code,
        zone: zone_code,
        rules,
        operator,
        layer,
        free_minutes,
        price_per_hour,
        badge: mapLabelForLayer(layer, zone_code),
        address: address || street || name,
        desc: [
          rules === 'free' ? 'Tasuta tänavaparkimine' : null,
          rules === 'clock'
            ? `Parkimiskellaga / Ajapiiranguga · ${free_minutes} min`
            : null,
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
    timeLimit: isClock
      ? `Parkimiskellaga / Ajapiiranguga · ${p.free_minutes || 15} min`
      : isFree
        ? 'Tasuta · piiramatu · kellata'
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
  if (
    p.badge === 'TASUTA' ||
    p.badge === 'FREE' ||
    p.badge === 'KELL' ||
    p.badge === 'EV'
  ) {
    const normalized = p.badge === 'FREE' ? 'TASUTA' : p.badge
    spot.badge = normalized
    spot.zone_code = normalized
  }
  return spot
}

export function streetCollectionToSpots(fc: StreetParkingCollection): ParkingSpot[] {
  return fc.features.map(streetFeatureToSpot)
}

/** Filter street lines by exclusive free / timed / paid buckets. */
function streetFilterCategory(p: StreetParkingProps) {
  return getParkingFilterCategory({
    layer: p.layer,
    free_minutes: p.free_minutes,
    price_per_hour: p.price_per_hour,
    verified_free: p.verified_free,
    zone_code: p.zone_code,
    badge: p.badge,
    name: p.name,
    desc: p.desc,
  })
}

export function filterStreetCollection(
  fc: StreetParkingCollection,
  layers:
    | ParkingLayerKey[]
    | 'all'
    | 'verified_free'
    | 'clock'
    | 'unclassified'
    | 'paid',
): StreetParkingCollection {
  if (layers === 'all') return fc
  if (layers === 'verified_free') {
    return {
      type: 'FeatureCollection',
      features: fc.features.filter(
        (f) => streetFilterCategory(f.properties) === 'free',
      ),
    }
  }
  if (layers === 'clock') {
    return {
      type: 'FeatureCollection',
      features: fc.features.filter(
        (f) => streetFilterCategory(f.properties) === 'timed',
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
          free_minutes: f.properties.free_minutes,
          zone_code: f.properties.zone_code,
          operator: f.properties.operator,
          color: f.properties.color,
          name: f.properties.name,
          desc: f.properties.desc,
          badge: f.properties.badge,
        }),
      ),
    }
  }
  if (layers === 'paid') {
    return {
      type: 'FeatureCollection',
      features: fc.features.filter(
        (f) => streetFilterCategory(f.properties) === 'paid',
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
  if (url.includes('ee_parking_max') || url.includes('estonia_parking_master')) {
    const { loadEstoniaParkingMaster } = await import('./estoniaParkingMaster')
    return (await loadEstoniaParkingMaster(url)).streets
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load street parking (${res.status})`)
  const raw = (await res.json()) as RawCollection
  return prepareStreetParking(raw)
}
