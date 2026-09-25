import { PARKING_LAYER_META } from '../map/parkingLayers'
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
      return 0
    case 'inva':
      return 0
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

export function spotsToGeoJSON(spots: ParkingSpot[]) {
  return {
    type: 'FeatureCollection' as const,
    features: spots.map((s) => ({
      type: 'Feature' as const,
      properties: {
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
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [s.lng, s.lat] as [number, number],
      },
    })),
  }
}

export function layerColor(layer: ParkingLayerKey): string {
  return PARKING_LAYER_META[layer]?.color ?? '#64748B'
}

/** @deprecated use layerColor */
export function providerColor(provider: ParkingLayerKey): string {
  return layerColor(provider)
}

export { countSpotsInDistrict, pointInPolygon } from './geojsonPolygons'
