import { PARKING_LAYER_META } from '../map/parkingLayers'
import { lotFillColor } from '../map/streetLineTheme'
import type {
  ParkingLayerKey,
  ParkingOperator,
  ParkingSpot,
  ParkingStructureType,
} from '../types'
import { normalizeSpot } from './geojson'

export const PARKING_POLYGONS_URL = '/data/parking_polygons.geojson'

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
  labelRank: number
  floors_label: string
  structure_label: string
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

function asStructureType(raw: unknown): ParkingStructureType {
  if (raw === 'underground' || raw === 'multi_storey' || raw === 'surface') return raw
  return 'surface'
}

function structureLabel(t: ParkingStructureType): string {
  if (t === 'underground') return 'Underground'
  if (t === 'multi_storey') return 'Multi-storey'
  return 'Surface'
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

/** Enrich raw GeoJSON with paint/label fields for MapLibre. */
export function prepareParkingPolygons(raw: RawCollection): PreciseParkingCollection {
  const features: PreciseParkingFeature[] = []
  for (const f of raw.features ?? []) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
      continue
    }
    const p = f.properties ?? {}
    const id = String(p.id ?? f.id ?? `poly-${features.length}`)
    const layerRaw = String(p.layer ?? 'municipal') as ParkingLayerKey
    const layer = layerRaw in PARKING_LAYER_META ? layerRaw : 'municipal'
    const structureType = asStructureType(p.type)
    const floors =
      typeof p.floors === 'number' ? p.floors : structureType === 'multi_storey' ? 3 : 1
    const color = lotFillColor(layer)
    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name: String(p.name ?? 'Parkla'),
        zone_code: String(p.zone_code ?? 'ZONE'),
        operator: String(p.operator ?? 'Unknown'),
        layer,
        type: structureType,
        floors,
        free_minutes: Number(p.free_minutes ?? 0),
        price_per_hour: Number(p.price_per_hour ?? 0),
        badge: String(p.badge ?? p.name ?? 'P'),
        address: String(p.address ?? ''),
        desc: p.desc ? String(p.desc) : undefined,
        color,
        labelRank: 1,
        floors_label: structureType === 'multi_storey' ? `P+${floors}` : '',
        structure_label: structureLabel(structureType),
      },
      geometry: f.geometry,
    })
  }
  return { type: 'FeatureCollection', features }
}

export function preciseFeatureToSpot(f: PreciseParkingFeature): ParkingSpot {
  const { lat, lng } = featureCentroid(f.geometry)
  const p = f.properties
  return normalizeSpot({
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
        : `Tasuline · ${p.zone_code}`,
    lat,
    lng,
    address: p.address,
    desc: p.desc ?? p.structure_label,
    type: 'paid',
    kind: 'lot',
    landmark: true,
    polygon: polygonToLatLng(f.geometry),
    structureType: p.type,
    floors: p.floors,
  })
}

export function preciseCollectionToSpots(fc: PreciseParkingCollection): ParkingSpot[] {
  return fc.features.map(preciseFeatureToSpot)
}

export async function loadParkingPolygons(
  url = PARKING_POLYGONS_URL,
): Promise<PreciseParkingCollection> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load parking polygons (${res.status})`)
  const raw = (await res.json()) as RawCollection
  return prepareParkingPolygons(raw)
}
