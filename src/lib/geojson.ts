import { PARKING_LAYER_META } from '../map/parkingLayers'
import { lotFillColor, streetLineColor } from '../map/streetLineTheme'
import type {
  ParkingFeatureType,
  ParkingLayerKey,
  ParkingOperator,
  ParkingSpot,
  ParkingSpotSeed,
} from '../types'
import { mapLabelForLayer } from './mapLabels'

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
  // Only explicit free type → free_street (untagged street is not green)
  if (spot.kind === 'street' && spot.type === 'free') return 'free_street'
  if (spot.kind === 'street' && spot.type === 'paid') return 'municipal'
  if (spot.kind === 'street') return 'municipal'
  if (spot.type === 'free') return 'free_street'
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
  const badge = mapLabelForLayer(layer, zone_code)

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
    badge,
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

/**
 * Lower = placed first = wins collisions against lower-priority labels.
 * Major lot brands beat INVA / EV / timed pins.
 */
function labelRank(s: ParkingSpot): number {
  if (
    s.layer === 'europark' ||
    s.layer === 'snabb' ||
    s.layer === 'citypark' ||
    s.layer === 'uhisteenused' ||
    s.layer === 'parkit'
  ) {
    return 1
  }
  if (s.layer === 'park_ride') return 2
  if (s.featureType === 'municipal-zone' || s.layer === 'municipal') return 3
  if (s.layer === 'timed' || s.layer === 'free_street') return 6
  if (s.layer === 'ev') return 8
  if (s.layer === 'inva') return 9
  if (s.layer === 'loading') return 10
  return 5
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
    labelRank: labelRank(s),
  }
}

/** ~meters → degrees at Tallinn latitude */
function metersToDeg(lat: number, meters: number) {
  const dLat = meters / 111_320
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { dLat, dLng }
}

/** @deprecated Never invent curb stubs — they cut through buildings. */
export function stubStreetLine(
  _lat: number,
  _lng: number,
  _lengthM = 55,
  _bearingDeg = 75,
): [number, number][] {
  return []
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
  // Overlay curb lines disabled until road-snapped geometry exists
  void s
  return false
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

/**
 * Parking curb LineStrings are disabled.
 * Hand-authored diagonals cut through buildings — do not emit them.
 * Re-enable only for OSM / Maa-amet road-snapped segments.
 */
function resolveLine(_s: ParkingSpot): [number, number][] | null {
  return null
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
    // resolveLine always returns null today — no debug diagonals over buildings
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

    // Detail pins: EV, INVA, loading, P&R, timed (+15m/+30m), free street
    if (
      s.featureType === 'ev-charger' ||
      s.featureType === 'inva' ||
      s.featureType === 'loading' ||
      s.featureType === 'park-ride' ||
      s.featureType === 'on-street-line' ||
      s.layer === 'timed' ||
      s.layer === 'free_street'
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
