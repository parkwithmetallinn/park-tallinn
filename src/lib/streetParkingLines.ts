import { normalizeSpot } from './geojson'
import type { ParkingLayerKey, ParkingOperator, ParkingSpot } from '../types'

export const STREET_PARKING_URL = '/data/street_parking.geojson'

export const STREET_PARKING_SOURCE = 'street-parking'
export const STREET_PARKING_LINE_LAYER = 'street-parking-line'
export const STREET_PARKING_CASING_LAYER = 'street-parking-casing'
export const STREET_PARKING_HIT_LAYER = 'street-parking-hit'

/** Product colors for roadside curb lines. */
export const STREET_COLOR = {
  free: '#34C759',
  paid: '#FF3B30',
  timed: '#0A84FF',
} as const

export type StreetRules = 'free' | 'paid' | 'clock'

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
} {
  const fee = str(p.fee).toLowerCase()
  const maxstay = str(p.maxstay)
  const maxMins = parseMaxstayMinutes(maxstay)
  const feeIsFree = fee === 'no' || fee === 'free'
  const feeIsPaid = fee === 'yes' || fee.includes('€') || fee.includes('eur') || Boolean(str(p.charge))

  // Curated schema fallback
  const curatedRules = str(p.rules).toLowerCase()
  if (curatedRules === 'free' || curatedRules === 'clock' || curatedRules === 'paid') {
    const rules = curatedRules as StreetRules
    return {
      rules,
      layer: rules === 'free' ? 'free_street' : rules === 'clock' ? 'timed' : 'municipal',
      free_minutes: Number(p.free_minutes ?? (rules === 'clock' ? maxMins || 15 : 0)),
      price_per_hour: Number(p.price_per_hour ?? (rules === 'paid' ? 2.5 : 0)),
      color:
        rules === 'free'
          ? STREET_COLOR.free
          : rules === 'clock'
            ? STREET_COLOR.timed
            : STREET_COLOR.paid,
    }
  }

  if (feeIsPaid) {
    return {
      rules: 'paid',
      layer: 'municipal',
      free_minutes: 0,
      price_per_hour: Number(p.price_per_hour ?? 2.5),
      color: STREET_COLOR.paid,
    }
  }

  if (maxMins > 0 || feeIsFree && maxstay) {
    return {
      rules: 'clock',
      layer: 'timed',
      free_minutes: maxMins || Number(p.free_minutes ?? 15),
      price_per_hour: 0,
      color: STREET_COLOR.timed,
    }
  }

  // Default street_side without fee tags → free curb
  return {
    rules: 'free',
    layer: 'free_street',
    free_minutes: 0,
    price_per_hour: 0,
    color: STREET_COLOR.free,
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
 */
export function prepareStreetParking(raw: RawCollection): StreetParkingCollection {
  const features: StreetParkingFeature[] = []
  for (const f of raw.features ?? []) {
    if (!f.geometry) continue
    const p = f.properties ?? {}
    if (!isParkingFeature(p)) continue

    const coords = extractLineCoords(f.geometry)
    if (!coords || coords.length < 2) continue

    const id = str(p['@id'] ?? p.id ?? f.id) || `street-${features.length}`
    const { rules, layer, free_minutes, price_per_hour, color } = classifyRules(p)
    const nameTag = str(p.name)
    const street = nameTag || str(p['addr:street']) || 'Tänav'
    const zone = str(p.zone ?? p.zone_code ?? p.ref)
    const zone_code =
      zone ||
      (rules === 'free' ? 'FREE' : rules === 'clock' ? 'KELL' : 'PAID')
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
        badge: zone_code.length <= 8 ? zone_code : zone_code.slice(0, 8),
        address: address || street,
        desc: [
          rules === 'free' ? 'Tasuta tänavaparkimine' : null,
          rules === 'clock' ? `Kellaga · ${free_minutes} min` : null,
          rules === 'paid' ? 'Tasuline tsoon' : null,
          str(p.description),
        ]
          .filter(Boolean)
          .join(' · '),
        color,
      },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function streetFeatureToSpot(f: StreetParkingFeature): ParkingSpot {
  const { lat, lng } = lineMidpoint(f.geometry.coordinates)
  const p = f.properties
  const isFree = p.rules === 'free'
  const isClock = p.rules === 'clock'
  return normalizeSpot({
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
        : `Tasuline · ${p.zone_code}`,
    lat,
    lng,
    address: p.address || p.street,
    desc: p.desc ?? `${p.street} · ${p.zone_code}`,
    type: isFree ? 'free' : isClock ? 'timed' : 'paid',
    kind: 'street',
    landmark: true,
    line: lineToLatLng(f.geometry.coordinates),
  })
}

export function streetCollectionToSpots(fc: StreetParkingCollection): ParkingSpot[] {
  return fc.features.map(streetFeatureToSpot)
}

/** Filter a street FeatureCollection by app layer keys (top filters). */
export function filterStreetCollection(
  fc: StreetParkingCollection,
  layers: ParkingLayerKey[] | 'all',
): StreetParkingCollection {
  if (layers === 'all') return fc
  return {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => layers.includes(f.properties.layer)),
  }
}

export async function loadStreetParking(
  url = STREET_PARKING_URL,
): Promise<StreetParkingCollection> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load street parking (${res.status})`)
  const raw = (await res.json()) as RawCollection
  return prepareStreetParking(raw)
}
