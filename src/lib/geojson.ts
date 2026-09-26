import { PARKING_LAYER_META } from '../map/parkingLayers'
import { lotFillColor, streetLineColor } from '../map/streetLineTheme'
import type {
  ParkingFeatureType,
  ParkingLayerKey,
  ParkingOperator,
  ParkingSpot,
  ParkingSpotSeed,
} from '../types'

function freeMinutesFromBadge(badge: string, fallback = 0): number {
  if (/\b15\b/.test(badge)) return 15
  if (/\b30\b/.test(badge)) return 30
  if (/\b60\b/.test(badge) || /\b1h\b/i.test(badge)) return 60
  if (/\b2h\b/i.test(badge)) return 120
  if (/\b3h\b/i.test(badge)) return 180
  if (/\b4h\b/i.test(badge)) return 240
  return fallback
}

function inferLayer(spot: ParkingSpotSeed): ParkingLayerKey {
  if (spot.layer) return spot.layer
  if (spot.provider) return spot.provider
  if (spot.featureType === 'ev-charger') return 'ev'
  if (spot.featureType === 'inva') return 'inva'
  if (spot.featureType === 'loading') return 'loading'
  if (spot.featureType === 'park-ride' || spot.type === 'pr') return 'park_ride'
  if (spot.type === 'timed') return 'timed'
  if (spot.kind === 'street' && (spot.type === 'free' || !spot.type)) return 'free_street'
  if (spot.type === 'paid') return 'europark'
  return 'municipal'
}

function inferFeatureType(spot: ParkingSpotSeed, layer: ParkingLayerKey): ParkingFeatureType {
  if (spot.featureType) return spot.featureType
  if (layer === 'ev') return 'ev-charger'
  if (layer === 'inva') return 'inva'
  if (layer === 'loading') return 'loading'
  if (layer === 'park_ride') return 'park-ride'
  if (layer === 'municipal' && spot.kind !== 'street') return 'municipal-zone'
  if (layer === 'timed' || layer === 'free_street') return 'on-street-line'
  return 'off-street-lot'
}

function inferOperator(spot: ParkingSpotSeed, layer: ParkingLayerKey): ParkingOperator {
  if (spot.operator) return spot.operator
  switch (layer) {
    case 'europark':
      return 'EuroPark'
    case 'snabb':
      return 'Snabb'
    case 'citypark':
      return 'Citypark'
    case 'uhisteenused':
      return 'AS Ühisteenused'
    case 'parkit':
      return 'Parkit'
    case 'ev':
      return 'Enefit Volt'
    case 'municipal':
    case 'free_street':
    case 'timed':
    case 'inva':
    case 'loading':
    case 'park_ride':
      return 'Tallinna Linn'
    default:
      return 'Unknown'
  }
}

function inferZoneCode(spot: ParkingSpotSeed, layer: ParkingLayerKey): string {
  if (spot.zone_code) return spot.zone_code
  switch (layer) {
    case 'europark':
      return 'EP'
    case 'snabb':
      return 'SN'
    case 'citypark':
      return 'CP'
    case 'uhisteenused':
      return 'UT'
    case 'parkit':
      return 'PK'
    case 'park_ride':
      return 'PR'
    case 'ev':
      return 'EV'
    case 'inva':
      return 'INVA'
    case 'loading':
      return 'LOAD'
    case 'timed':
      return 'KELL'
    case 'free_street':
      return 'FREE'
    case 'municipal':
      return 'AVALIK'
    default:
      return 'UNK'
  }
}

function inferFreeMinutes(spot: ParkingSpotSeed, layer: ParkingLayerKey): number {
  if (typeof spot.free_minutes === 'number') return spot.free_minutes
  if (layer === 'free_street' || layer === 'park_ride') return 0
  if (layer === 'timed') return freeMinutesFromBadge(spot.badge, 15)
  if (layer === 'municipal') return 15
  return freeMinutesFromBadge(spot.badge, 0)
}

function inferPrice(spot: ParkingSpotSeed, layer: ParkingLayerKey): number {
  if (typeof spot.price_per_hour === 'number') return spot.price_per_hour
  switch (layer) {
    case 'free_street':
    case 'park_ride':
      return 0
    case 'municipal':
    case 'timed':
      return 2.5
    case 'europark':
      return 3.5
    case 'snabb':
      return 3.2
    case 'citypark':
      return 3.0
    case 'uhisteenused':
      return 2.8
    case 'parkit':
      return 2.5
    case 'ev':
    case 'inva':
    case 'loading':
      return 0
    default:
      return 0
  }
}

function inferLegacyType(
  layer: ParkingLayerKey,
): NonNullable<ParkingSpot['type']> {
  if (layer === 'park_ride') return 'pr'
  if (layer === 'timed') return 'timed'
  if (
    layer === 'europark' ||
    layer === 'snabb' ||
    layer === 'citypark' ||
    layer === 'uhisteenused' ||
    layer === 'parkit'
  ) {
    return 'paid'
  }
  return 'free'
}

function inferKind(spot: ParkingSpotSeed, featureType: ParkingFeatureType): NonNullable<ParkingSpot['kind']> {
  if (spot.kind) return spot.kind
  if (featureType === 'on-street-line') return 'street'
  return 'lot'
}

/** Normalize any seed / legacy record into the full Estonia parking schema. */
export function normalizeSpot(spot: ParkingSpotSeed): ParkingSpot {
  const layer = inferLayer(spot)
  const featureType = inferFeatureType(spot, layer)
  const operator = inferOperator(spot, layer)
  const zone_code = inferZoneCode(spot, layer)
  const free_minutes = inferFreeMinutes(spot, layer)
  const price_per_hour = inferPrice(spot, layer)
  const type = spot.type ?? inferLegacyType(layer)
  const kind = inferKind(spot, featureType)

  return {
    ...spot,
    featureType,
    operator,
    layer,
    zone_code,
    free_minutes,
    price_per_hour,
    type,
    kind,
    provider: layer,
  }
}

/** @deprecated use normalizeSpot */
export function withProvider(spot: ParkingSpotSeed): ParkingSpot {
  return normalizeSpot(spot)
}

export function inferProvider(spot: ParkingSpotSeed): ParkingLayerKey {
  return normalizeSpot(spot).layer
}

function sharedProps(s: ParkingSpot) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    kind: s.kind,
    featureType: s.featureType,
    operator: s.operator,
    layer: s.layer,
    provider: s.layer,
    zone_code: s.zone_code,
    free_minutes: s.free_minutes,
    price_per_hour: s.price_per_hour,
    badge: s.badge,
    timeLimit: s.timeLimit,
    address: s.address,
    desc: s.desc,
    landmark: s.landmark ? 1 : 0,
    color: layerColor(s.layer),
  }
}

/** ~meters → degrees at Tallinn latitude */
function metersToDeg(lat: number, meters: number) {
  const dLat = meters / 111_320
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { dLat, dLng }
}

/** Short curb stub when no surveyed line exists (dense synthetic data). */
export function stubStreetLine(
  lat: number,
  lng: number,
  lengthM = 55,
  bearingDeg = 75,
): [number, number][] {
  const rad = (bearingDeg * Math.PI) / 180
  const { dLat, dLng } = metersToDeg(lat, lengthM / 2)
  const dy = Math.cos(rad) * dLat
  const dx = Math.sin(rad) * dLng
  return [
    [lat - dy, lng - dx],
    [lat + dy, lng + dx],
  ]
}

/** Soft rounded rectangle footprint (chamfered corners) for off-street lots. */
export function stubLotPolygon(
  lat: number,
  lng: number,
  halfWm = 28,
  halfHm = 22,
): [number, number][] {
  const { dLat, dLng } = metersToDeg(lat, 1)
  const hw = halfWm * dLng
  const hh = halfHm * dLat
  const rx = Math.min(hw, dLng * 8)
  const ry = Math.min(hh, dLat * 8)
  // Clockwise ring with chamfered corners ≈ soft rounded lot
  return [
    [lat - hh + ry, lng - hw],
    [lat - hh, lng - hw + rx],
    [lat - hh, lng + hw - rx],
    [lat - hh + ry, lng + hw],
    [lat + hh - ry, lng + hw],
    [lat + hh, lng + hw - rx],
    [lat + hh, lng - hw + rx],
    [lat + hh - ry, lng - hw],
    [lat - hh + ry, lng - hw],
  ]
}

export function isOnStreetFeature(s: ParkingSpot): boolean {
  // Only surveyed / road-snapped polylines — never invent stubs through buildings
  return Boolean(s.line && s.line.length >= 3)
}

export function isLotPolygonFeature(s: ParkingSpot): boolean {
  if (s.polygon && s.polygon.length >= 3) return true
  if (s.featureType === 'off-street-lot') return true
  return (
    s.kind === 'lot' &&
    (s.layer === 'europark' ||
      s.layer === 'snabb' ||
      s.layer === 'citypark' ||
      s.layer === 'uhisteenused' ||
      s.layer === 'parkit')
  )
}

/** Densify long straight segments so lines never look like building-cutting diagonals. */
function densifyLine(line: [number, number][], maxSegM = 45): [number, number][] {
  if (line.length < 2) return line
  const out: [number, number][] = [line[0]]
  for (let i = 0; i < line.length - 1; i++) {
    const [aLat, aLng] = line[i]
    const [bLat, bLng] = line[i + 1]
    const meters = Math.hypot(
      (aLat - bLat) * 111_320,
      (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
    )
    const steps = Math.max(1, Math.ceil(meters / maxSegM))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      out.push([aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t])
    }
  }
  return out
}

function resolveLine(s: ParkingSpot): [number, number][] | null {
  if (!s.line || s.line.length < 3) return null
  // Reject sparse polylines with huge jumps (not road-following)
  const maxJumpM = 180
  for (let i = 0; i < s.line.length - 1; i++) {
    const [aLat, aLng] = s.line[i]
    const [bLat, bLng] = s.line[i + 1]
    const meters = Math.hypot(
      (aLat - bLat) * 111_320,
      (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
    )
    if (meters > maxJumpM) return null
  }
  return densifyLine(s.line, 40)
}

function resolvePolygon(s: ParkingSpot): [number, number][] | null {
  if (s.polygon && s.polygon.length >= 3) {
    const ring = s.polygon.slice()
    const [aLat, aLng] = ring[0]
    const [bLat, bLng] = ring[ring.length - 1]
    if (aLat !== bLat || aLng !== bLng) ring.push([aLat, aLng])
    return ring
  }
  if (isLotPolygonFeature(s)) {
    return stubLotPolygon(s.lat, s.lng, 38, 28)
  }
  return null
}

type Feat = {
  type: 'Feature'
  properties: Record<string, string | number | undefined>
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'Polygon'; coordinates: [number, number][][] }
}

type FeatColl = { type: 'FeatureCollection'; features: Feat[] }

export type ParkingMapGeoJSON = {
  points: FeatColl
  lines: FeatColl
  polygons: FeatColl
}

/** Split parking records into point / line / polygon FeatureCollections. */
export function spotsToMapGeoJSON(spots: ParkingSpot[]): ParkingMapGeoJSON {
  const points: Feat[] = []
  const lines: Feat[] = []
  const polygons: Feat[] = []

  for (const s of spots) {
    const line = resolveLine(s)
    if (line) {
      lines.push({
        type: 'Feature',
        properties: {
          ...sharedProps(s),
          color: streetLineColor(s),
          render: 'line',
        },
        geometry: {
          type: 'LineString',
          coordinates: line.map(([lat, lng]) => [lng, lat] as [number, number]),
        },
      })
      continue
    }

    const ring = resolvePolygon(s)
    if (ring) {
      polygons.push({
        type: 'Feature',
        properties: {
          ...sharedProps(s),
          color: lotFillColor(s.layer),
          render: 'polygon',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring.map(([lat, lng]) => [lng, lat] as [number, number])],
        },
      })
      continue
    }

    // Points only for true POIs (EV / inva / loading / P&R)
    if (
      s.featureType === 'ev-charger' ||
      s.featureType === 'inva' ||
      s.featureType === 'loading' ||
      s.featureType === 'park-ride'
    ) {
      points.push({
        type: 'Feature',
        properties: {
          ...sharedProps(s),
          render: 'point',
        },
        geometry: {
          type: 'Point',
          coordinates: [s.lng, s.lat],
        },
      })
    }
  }

  return {
    points: { type: 'FeatureCollection', features: points },
    lines: { type: 'FeatureCollection', features: lines },
    polygons: { type: 'FeatureCollection', features: polygons },
  }
}

/** @deprecated use spotsToMapGeoJSON — points only for legacy callers */
export function spotsToGeoJSON(spots: ParkingSpot[]) {
  return spotsToMapGeoJSON(spots).points
}

export function layerColor(layer: ParkingLayerKey): string {
  return PARKING_LAYER_META[layer]?.color ?? '#64748B'
}

/** @deprecated use layerColor */
export function providerColor(provider: ParkingLayerKey): string {
  return layerColor(provider)
}

export { countSpotsInDistrict, pointInPolygon } from './geojsonPolygons'
