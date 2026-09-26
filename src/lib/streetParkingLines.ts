import { normalizeSpot } from './geojson'
import type { ParkingLayerKey, ParkingOperator, ParkingSpot } from '../types'

export const STREET_PARKING_URL = '/data/street_parking.geojson'

export const STREET_PARKING_SOURCE = 'street-parking'
export const STREET_PARKING_LINE_LAYER = 'street-parking-line'
export const STREET_PARKING_CASING_LAYER = 'street-parking-casing'
export const STREET_PARKING_HIT_LAYER = 'street-parking-hit'

export type StreetParkingProps = {
  id: string
  name: string
  street: string
  zone_code: string
  zone: string
  rules: string
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
  geometry?: { type: string; coordinates?: number[][] } | null
}

type RawCollection = {
  type: string
  features?: RawFeature[]
}

/**
 * Zone colors (product rules):
 * Free / Clock → green, Kesklinn → red, EuroPark → blue
 */
export function streetZoneColor(zone: string, rules: string, layer: string): string {
  const z = zone.toUpperCase()
  const r = rules.toLowerCase()
  if (r === 'free' || z === 'FREE') return '#34C759'
  if (r === 'clock' || z === 'CLOCK') return '#34C759'
  if (z === 'KESKLINN') return '#FF3B30'
  if (z === 'EUROPARK' || layer === 'europark') return '#0A84FF'
  if (z === 'VANALINN') return '#FF6961'
  if (z === 'SÜDALINN' || z === 'SUDALINN') return '#FF9F0A'
  if (z === 'PIRITA') return '#5AC8FA'
  if (layer === 'snabb') return '#FF9F0A'
  if (layer === 'citypark') return '#BF5AF2'
  return '#34C759'
}

/** Reject sparse / diagonal junk — keep only densified road-following LineStrings. */
function isValidRoadLineString(coords: number[][]): boolean {
  if (!coords || coords.length < 4) return false
  let pathM = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [aLng, aLat] = coords[i]
    const [bLng, bLat] = coords[i + 1]
    const meters = Math.hypot(
      (aLat - bLat) * 111_320,
      (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
    )
    // Max jump between vertices ~80 m — no block-cutting diagonals
    if (meters > 80) return false
    pathM += meters
  }
  if (pathM > 600) return false
  const [sLng, sLat] = coords[0]
  const [eLng, eLat] = coords[coords.length - 1]
  const chord = Math.hypot(
    (sLat - eLat) * 111_320,
    (sLng - eLng) * 111_320 * Math.cos((sLat * Math.PI) / 180),
  )
  // Near-straight city-scale span → reject
  if (chord > 350 && pathM / Math.max(chord, 1) < 1.08) return false
  return true
}

function lineMidpoint(coords: number[][]): { lat: number; lng: number } {
  const mid = coords[Math.floor(coords.length / 2)]
  return { lng: mid[0], lat: mid[1] }
}

function lineToLatLng(coords: number[][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng] as [number, number])
}

export function prepareStreetParking(raw: RawCollection): StreetParkingCollection {
  const features: StreetParkingFeature[] = []
  for (const f of raw.features ?? []) {
    if (!f.geometry || f.geometry.type !== 'LineString') continue
    const coords = f.geometry.coordinates
    if (!coords || !isValidRoadLineString(coords)) continue

    const p = f.properties ?? {}
    const id = String(p.id ?? f.id ?? `street-${features.length}`)
    const layer = String(p.layer ?? 'municipal') as ParkingLayerKey
    const zone = String(p.zone ?? p.zone_code ?? 'FREE')
    const rules = String(p.rules ?? 'paid')
    const color = streetZoneColor(zone, rules, layer)

    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name: String(p.name ?? p.street ?? 'Tänav'),
        street: String(p.street ?? p.name ?? 'Tänav'),
        zone_code: String(p.zone_code ?? zone),
        zone,
        rules,
        operator: String(p.operator ?? 'Tallinna Linn'),
        layer,
        free_minutes: Number(p.free_minutes ?? 0),
        price_per_hour: Number(p.price_per_hour ?? 0),
        badge: String(p.badge ?? zone),
        address: String(p.address ?? ''),
        desc: p.desc ? String(p.desc) : undefined,
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
  const isFree = p.rules === 'free' || p.price_per_hour <= 0
  const isClock = p.rules === 'clock'
  return normalizeSpot({
    id: p.id,
    name: p.name,
    featureType: 'on-street-line',
    operator: p.operator as ParkingOperator,
    layer: isFree ? 'free_street' : isClock ? 'timed' : p.layer,
    zone_code: p.zone_code,
    free_minutes: p.free_minutes,
    price_per_hour: p.price_per_hour,
    badge: p.badge,
    timeLimit: isFree
      ? 'Tasuta tänav'
      : p.free_minutes > 0
        ? `${p.free_minutes} min · ${p.zone_code}`
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

export async function loadStreetParking(
  url = STREET_PARKING_URL,
): Promise<StreetParkingCollection> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load street parking (${res.status})`)
  const raw = (await res.json()) as RawCollection
  return prepareStreetParking(raw)
}
