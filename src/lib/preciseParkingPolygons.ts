import area from '@turf/area'
import { PARKING_LAYER_META } from '../map/parkingLayers'
import { lotFillColor } from '../map/streetLineTheme'
import type {
  ParkingLayerKey,
  ParkingOperator,
  ParkingSpot,
  ParkingStructureType,
} from '../types'
import { normalizeSpot } from './geojson'
import { mapLabelForLayer } from './mapLabels'
import {
  getParkingExclusionReason,
  isPaidFeeTag,
  isUnclassifiedParking,
  isVerifiedFreeParking,
  PARKING_COLOR_FREE,
  PARKING_COLOR_UNKNOWN,
  type ParkingPrepPurgeStats,
  emptyPurgeStats,
} from './parkingClassification'

/** Last prepareParkingPolygons purge counts (for health checks). */
let lastPolygonPurgeStats: ParkingPrepPurgeStats = emptyPurgeStats()

export function getLastPolygonPurgeStats(): ParkingPrepPurgeStats {
  return lastPolygonPurgeStats
}

/** @deprecated Use estonia_parking_master via parkingDataCache / loadEstoniaParkingMaster */
export const PARKING_POLYGONS_URL = '/data/estonia_parking_master.geojson'

export const PRECISE_PARKING_SOURCE = 'parking-polygons'
export const PRECISE_FILL_LAYER = 'parking-fill'
export const PRECISE_OUTLINE_LAYER = 'parking-outline'
export const PRECISE_OUTLINE_UNDERGROUND_LAYER = 'parking-outline-underground'
export const PRECISE_MULTISTOREY_BADGE_LAYER = 'parking-multistorey-badge'
export const PRECISE_LABEL_LAYER = 'parking-fill-label'

export type PreciseParkingProps = {
  id: string
  name: string
  zone_code: string
  operator: string
  layer: ParkingLayerKey
  type: ParkingStructureType
  floors: number
  free_minutes: number
  price_per_hour: number
  badge: string
  address: string
  desc?: string
  color: string
  /** True only for verified free public parking (matches Tasuta filter + green). */
  verified_free: boolean
  /** Feature area m² — larger lots win label collision (symbol-sort-key). */
  area_m2: number
  labelRank: number
  floors_label: string
  structure_label: string
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

type PolygonGeom = {
  type: 'Polygon'
  coordinates: number[][][]
}

type MultiPolygonGeom = {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

type PolyGeom = PolygonGeom | MultiPolygonGeom

export type PreciseParkingFeature = {
  type: 'Feature'
  id: string
  properties: PreciseParkingProps
  geometry: PolyGeom
}

export type PreciseParkingCollection = {
  type: 'FeatureCollection'
  features: PreciseParkingFeature[]
}

type RawFeature = {
  type: string
  id?: string | number
  properties?: Record<string, unknown> | null
  geometry?: PolyGeom | null
}

type RawCollection = {
  type: string
  features?: RawFeature[]
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function asStructureType(parking: string, building?: string): ParkingStructureType {
  const p = parking.toLowerCase()
  if (p === 'underground' || p === 'multi-storey' || p === 'multi_storey') {
    return p === 'underground' ? 'underground' : 'multi_storey'
  }
  if (building === 'parking' || building === 'garage') return 'multi_storey'
  return 'surface'
}

function structureLabel(t: ParkingStructureType): string {
  if (t === 'underground') return 'Underground'
  if (t === 'multi_storey') return 'Multi-storey'
  return 'Surface'
}

/** Map OSM operator / zone / free tags → app layer key. */
function layerFromOsm(
  operatorRaw: string,
  fee: string,
  zone: string,
  maxstay: string,
  access: string,
  charge: string,
): ParkingLayerKey {
  const op = operatorRaw.toLowerCase()
  if (op.includes('europark') || op.includes('euro park') || /^ep\d/i.test(zone)) return 'europark'
  if (op.includes('snabb') || /^x\d/i.test(zone) || /^sb\d/i.test(zone)) return 'snabb'
  if (op.includes('citypark') || op.includes('city park')) return 'citypark'
  if (op.includes('ühisteenused') || op.includes('uhisteenused') || /^yt\d/i.test(zone) || /^p\d+$/i.test(zone)) {
    return 'uhisteenused'
  }
  if (op.includes('parkit')) return 'parkit'
  if (op.includes('barking')) return 'parkit'

  const verifiedFree = isVerifiedFreeParking({ fee, access, zone, charge })
  // fee=no + maxstay → clocked free window (Kellaga), not unlimited Tasuta green
  if (verifiedFree && maxstay) return 'timed'
  if (verifiedFree) return 'free_street'
  if (op.includes('tallinn') || op.includes('linn')) return 'municipal'
  if (isPaidFeeTag(fee, charge)) return 'municipal'
  // Unclassified / generic ZONE — municipal layer, painted gray (not free-green)
  return 'municipal'
}

function operatorDisplay(operatorRaw: string, layer: ParkingLayerKey): string {
  if (operatorRaw) {
    const op = operatorRaw.toLowerCase()
    if (op.includes('europark')) return 'EuroPark'
    if (op.includes('snabb')) return 'Snabb'
    if (op.includes('citypark') || op.includes('city park')) return 'Citypark'
    if (op.includes('ühisteenused') || op.includes('uhisteenused')) return 'AS Ühisteenused'
    if (op.includes('parkit')) return 'Parkit'
    return operatorRaw
  }
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
    case 'free_street':
    case 'timed':
    case 'municipal':
      return 'Tallinna Linn'
    default:
      return 'Unknown'
  }
}

/** Parse OSM charge=* into approximate EUR/hour. */
function parsePricePerHour(charge: string, fee: string): number {
  if (!charge) {
    const feeLower = fee.toLowerCase()
    if (feeLower === 'no' || feeLower === 'free' || !fee) return 0
    if (feeLower === 'yes') return 0 // unknown rate
    return 0
  }
  const normalized = charge.replace(/,/g, '.').replace(/\s+/g, ' ')
  // Prefer hourly rates first
  const hour = normalized.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)?\s*\/\s*h(?:our)?/i)
  if (hour) return Math.round(parseFloat(hour[1]) * 100) / 100
  const hour2 = normalized.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)\s*\/\s*h(?:our)?/i)
  if (hour2) return Math.round(parseFloat(hour2[1]) * 100) / 100
  // per 30 minutes → ×2
  const half = normalized.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)?\s*\/\s*30\s*(?:min|minutes?)/i)
  if (half) return Math.round(parseFloat(half[1]) * 2 * 100) / 100
  // per minute
  const min = normalized.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)\s*\/\s*minute/i)
  if (min) return Math.round(parseFloat(min[1]) * 60 * 100) / 100
  // bare "X EUR/hour" already covered; try first money amount as hourly guess when /h present elsewhere
  const anyHour = /\/\s*h|per\s*hour|tunnis/i.test(normalized)
  const firstAmt = normalized.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)/i)
  if (anyHour && firstAmt) return Math.round(parseFloat(firstAmt[1]) * 100) / 100
  if (half) return 0
  // "2 EUR/hour" style without slash spacing already handled
  const eurHour = normalized.match(/(\d+(?:\.\d+)?)\s*eur\s*\/\s*hour/i)
  if (eurHour) return Math.round(parseFloat(eurHour[1]) * 100) / 100
  return 0
}

/** Parse OSM maxstay=* into minutes (used as free window when fee=no). */
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

function buildAddress(p: Record<string, unknown>): string {
  const street = str(p['addr:street'])
  const hn = str(p['addr:housenumber'])
  const city = str(p['addr:city'])
  const line = [street && hn ? `${street} ${hn}` : street || hn, city].filter(Boolean).join(', ')
  return line
}

function ringCentroid(ring: number[][]): { lat: number; lng: number } {
  let sx = 0
  let sy = 0
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  const n = Math.max(1, closed ? ring.length - 1 : ring.length)
  for (let i = 0; i < n; i++) {
    sx += ring[i][0]
    sy += ring[i][1]
  }
  return { lng: sx / n, lat: sy / n }
}

function featureCentroid(geom: PolyGeom): { lat: number; lng: number } {
  if (geom.type === 'Polygon') return ringCentroid(geom.coordinates[0])
  return ringCentroid(geom.coordinates[0][0])
}

function polygonToLatLng(geom: PolyGeom): [number, number][] {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0]
  return ring.map(([lng, lat]) => [lat, lng] as [number, number])
}

export function featureBounds(geom: PolyGeom): [[number, number], [number, number]] {
  const rings: number[][][] =
    geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flatMap((p) => p)
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng)
      minLat = Math.min(minLat, lat)
      maxLng = Math.max(maxLng, lng)
      maxLat = Math.max(maxLat, lat)
    }
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}

/**
 * Enrich Overpass / curated GeoJSON with paint + sheet fields for MapLibre.
 * Supports OSM tags: @id, parking, fee, operator, charge, maxstay, zone, name, addr:*.
 * Purges private yards / resident-only and non-public underground garages.
 */
export function prepareParkingPolygons(raw: RawCollection): PreciseParkingCollection {
  const features: PreciseParkingFeature[] = []
  const purge = emptyPurgeStats()
  for (const f of raw.features ?? []) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
      continue
    }
    const p = f.properties ?? {}
    purge.input++

    // Drop private yards / resident-only / phantom underground building parking
    const exclusion = getParkingExclusionReason(p)
    if (exclusion) {
      purge.purged[exclusion]++
      purge.purgedTotal++
      continue
    }

    // Prefer OSM @id; ignore numeric OSM `layer` (building level) as app layer key
    const id = str(p['@id'] ?? p.id ?? f.id) || `poly-${features.length}`
    const parkingTag = str(p.parking)
    const structureType = asStructureType(parkingTag, str(p.building))
    const floorsRaw = p['building:levels'] ?? p.floors
    const floors =
      typeof floorsRaw === 'number'
        ? floorsRaw
        : floorsRaw
          ? parseInt(String(floorsRaw), 10) || (structureType === 'multi_storey' ? 3 : 1)
          : structureType === 'multi_storey'
            ? 3
            : 1

    const operatorRaw = str(p.operator)
    const fee = str(p.fee)
    const charge = str(p.charge)
    const maxstay = str(p.maxstay)
    const access = str(p.access)
    const zone = str(p.zone ?? p.ref)
    const nameTag = str(p.name)

    const verified_free = isVerifiedFreeParking({
      fee,
      access,
      zone,
      charge,
      rules: p.rules,
      zone_code: p.zone_code,
    })

    // Curated schema fallback: explicit `layer` only if it is a known app key
    // (ignore numeric OSM building `layer` like "0"/"1"/"-1")
    const curatedLayer = str(p.layer)
    const curatedIsAppLayer =
      curatedLayer in PARKING_LAYER_META && !/^-?\d+$/.test(curatedLayer)
    let layer: ParkingLayerKey = curatedIsAppLayer
      ? (curatedLayer as ParkingLayerKey)
      : layerFromOsm(operatorRaw, fee, zone, maxstay, access, charge)

    // Never keep a curated free_street without verified free tags
    if (layer === 'free_street' && !verified_free) {
      layer = 'municipal'
    }
    // Promote verified free onto free_street unless clocked (maxstay)
    if (verified_free && layer === 'municipal') {
      layer = maxstay ? 'timed' : 'free_street'
    }

    const priceFromCurated = p.price_per_hour
    const freeFromCurated = p.free_minutes
    const feeIsFree = verified_free && !maxstay
    const feeIsPaid = isPaidFeeTag(fee, charge)
    let price_per_hour =
      typeof priceFromCurated === 'number' ? priceFromCurated : parsePricePerHour(charge, fee)
    // fee=yes without a parseable charge → layer default so sheet doesn't say "Tasuta"
    if (price_per_hour <= 0 && feeIsPaid) {
      const defaults: Partial<Record<ParkingLayerKey, number>> = {
        europark: 3.5,
        snabb: 3.2,
        citypark: 3.0,
        uhisteenused: 2.8,
        parkit: 2.5,
        municipal: 2.5,
        timed: 2.5,
      }
      price_per_hour = defaults[layer] ?? 2.5
    }
    // Unclassified unknown lots — do not imply free via 0 €/h
    if (price_per_hour <= 0 && !verified_free && layer === 'municipal' && !feeIsPaid) {
      price_per_hour = 0
    }
    const maxstayMins = parseMaxstayMinutes(maxstay)
    const free_minutes =
      typeof freeFromCurated === 'number'
        ? freeFromCurated
        : verified_free
          ? maxstayMins
          : 0

    const zone_code =
      zone ||
      (nameTag && /^[A-Z]{1,3}\d+/i.test(nameTag) ? nameTag.toUpperCase() : '') ||
      (layer === 'europark'
        ? 'EP'
        : layer === 'snabb'
          ? 'SN'
          : layer === 'citypark'
            ? 'CP'
            : layer === 'uhisteenused'
              ? 'UT'
              : layer === 'free_street'
                ? 'FREE'
                : layer === 'timed'
                  ? 'KELL'
                  : 'ZONE')

    const operator = operatorDisplay(operatorRaw, layer)
    const address = buildAddress(p) || str(p.address)
    const name =
      nameTag ||
      (zone ? `Zone ${zone}` : '') ||
      (operator !== 'Unknown' && operator !== 'Tallinna Linn' ? `${operator} parkla` : '') ||
      structureLabel(structureType)
    // Map badge from layer (Snabb → "SB"); zone_code keeps real X/SB codes for sheets.
    const badge = mapLabelForLayer(layer, zone_code)
    const area_m2 = Math.max(0, Math.round(area(f as never)))
    // Larger lots first: lower labelRank wins existing collision layout.
    const labelRank =
      structureType === 'multi_storey'
        ? 0
        : structureType === 'underground'
          ? 1
          : Math.max(2, 1_000_000 - area_m2)

    // Green ONLY when layer is free_street (verified free, no private/provider).
    // Unknown ZONE / untagged municipal → muted gray — never free-green.
    const color =
      layer === 'free_street'
        ? PARKING_COLOR_FREE
        : layer === 'municipal' && !feeIsPaid
          ? PARKING_COLOR_UNKNOWN
          : lotFillColor(layer)

    const descParts = [
      str(p.description),
      charge ? `Hind: ${charge}` : '',
      maxstay && !feeIsFree ? `Maxstay: ${maxstay}` : '',
      parkingTag ? `OSM: ${parkingTag}` : '',
    ].filter(Boolean)

    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name,
        zone_code,
        operator,
        layer,
        type: structureType,
        floors,
        free_minutes,
        price_per_hour,
        badge,
        address,
        desc: descParts.length ? descParts.join(' · ') : undefined,
        color,
        verified_free: verified_free && layer === 'free_street',
        area_m2,
        labelRank,
        floors_label: structureType === 'multi_storey' ? `P+${floors}` : '',
        structure_label: structureLabel(structureType),
        source: str(p.source) || undefined,
        lastVerified: str(p.lastVerified) || undefined,
      },
      geometry: f.geometry,
    })
    purge.kept++
  }
  lastPolygonPurgeStats = purge
  return { type: 'FeatureCollection', features }
}

export function preciseFeatureToSpot(f: PreciseParkingFeature): ParkingSpot {
  const { lat, lng } = featureCentroid(f.geometry)
  const p = f.properties
  const spot = normalizeSpot({
    id: p.id,
    name: p.name,
    featureType: 'off-street-lot',
    operator: p.operator as ParkingOperator,
    layer: p.layer,
    zone_code: p.zone_code,
    free_minutes: p.free_minutes,
    price_per_hour: p.price_per_hour,
    badge: p.badge,
    timeLimit:
      p.free_minutes > 0
        ? `${p.free_minutes} min · ${p.zone_code}`
        : p.verified_free || p.layer === 'free_street'
          ? `Tasuta · ${p.zone_code}`
          : p.price_per_hour > 0
            ? `Tasuline · ${p.zone_code}`
            : `Määramata · ${p.zone_code}`,
    lat,
    lng,
    address: p.address || p.name,
    desc: p.desc ?? p.structure_label,
    type:
      p.verified_free || p.layer === 'free_street'
        ? 'free'
        : p.free_minutes > 0 || p.layer === 'timed'
          ? 'timed'
          : p.price_per_hour > 0
            ? 'paid'
            : 'paid',
    kind: 'lot',
    landmark: true,
    polygon: polygonToLatLng(f.geometry),
    structureType: p.type,
    floors: p.floors,
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
  // Preserve FREE / KELL / EV badges exactly (no capacity / OSM id labels)
  if (p.badge === 'FREE' || p.badge === 'KELL' || p.badge === 'EV') {
    spot.badge = p.badge
    spot.zone_code = p.badge
  }
  return spot
}

export function preciseCollectionToSpots(fc: PreciseParkingCollection): ParkingSpot[] {
  return fc.features.map(preciseFeatureToSpot)
}

/** Filter lot polygons by app layer keys (top filters). */
export function filterPreciseCollection(
  fc: PreciseParkingCollection,
  layers: ParkingLayerKey[] | 'all' | 'verified_free' | 'unclassified',
): PreciseParkingCollection {
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

export async function loadParkingPolygons(
  url = PARKING_POLYGONS_URL,
): Promise<PreciseParkingCollection> {
  // Master file is split into lots vs streets — never paint curb polygons as lots.
  if (url.includes('estonia_parking_master')) {
    const { loadEstoniaParkingMaster } = await import('./estoniaParkingMaster')
    return (await loadEstoniaParkingMaster(url)).polygons
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load parking polygons (${res.status})`)
  const raw = (await res.json()) as RawCollection
  return prepareParkingPolygons(raw)
}
