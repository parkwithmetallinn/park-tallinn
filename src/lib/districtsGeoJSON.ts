import { DISTRICT_ZONES } from '../data/districts'
import type { DistrictZone } from '../types'

type DistrictProps = {
  id: string
  name: string
  color: string
  kind: string
  summary: string
  labelRank: number
  fillSort: number
  layerRole: string
}

type PolyFeat = {
  type: 'Feature'
  id: string
  properties: DistrictProps
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

type PointFeat = {
  type: 'Feature'
  id: string
  properties: DistrictProps
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
}

export type DistrictPolyCollection = {
  type: 'FeatureCollection'
  features: PolyFeat[]
}

export type DistrictLabelCollection = {
  type: 'FeatureCollection'
  features: PointFeat[]
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (!ring.length) return ring
  const [aLng, aLat] = ring[0]
  const [bLng, bLat] = ring[ring.length - 1]
  if (aLng !== bLng || aLat !== bLat) return [...ring, [aLng, aLat]]
  return ring
}

/** Fallback when a zone still has only legacy [lat,lng] rings. */
function polygonFromCoords(coords: [number, number][]): PolyFeat['geometry'] {
  const ring = closeRing(coords.map(([lat, lng]) => [lng, lat] as [number, number]))
  return { type: 'Polygon', coordinates: [ring] }
}

function propsOf(z: DistrictZone, index: number): DistrictProps {
  const layerRole = z.layerRole ?? (z.kind === 'paid' ? 'subzone' : 'district')
  return {
    id: z.id,
    name: z.name,
    color: z.color,
    kind: z.kind,
    summary: z.summary,
    labelRank: z.labelRank ?? index,
    fillSort: z.fillSort ?? (layerRole === 'subzone' ? 50 : 10),
    layerRole,
  }
}

function labelPoint(z: DistrictZone): [number, number] {
  if (
    typeof z.labelLng === 'number' &&
    typeof z.labelLat === 'number' &&
    Number.isFinite(z.labelLng) &&
    Number.isFinite(z.labelLat)
  ) {
    return [z.labelLng, z.labelLat]
  }
  // Fallback: average of outer ring vertices
  const lats = z.coords.map((c) => c[0])
  const lngs = z.coords.map((c) => c[1])
  return [
    lngs.reduce((a, b) => a + b, 0) / Math.max(1, lngs.length),
    lats.reduce((a, b) => a + b, 0) / Math.max(1, lats.length),
  ]
}

/** Precise district / sub-zone polygons for city-macro LOD (zoom < 13). */
export function districtsToGeoJSON(
  zones: DistrictZone[] = DISTRICT_ZONES,
): DistrictPolyCollection {
  const features: PolyFeat[] = zones.map((z, i) => ({
    type: 'Feature',
    id: z.id,
    properties: propsOf(z, i),
    geometry: z.geometry ?? polygonFromCoords(z.coords),
  }))
  return { type: 'FeatureCollection', features }
}

/**
 * Explicit Point features at each zone's visual centroid / mass center.
 * Keeps labels off bounding-box centers and off water for coastal districts.
 */
export function districtLabelsToGeoJSON(
  zones: DistrictZone[] = DISTRICT_ZONES,
): DistrictLabelCollection {
  const features: PointFeat[] = zones.map((z, i) => ({
    type: 'Feature',
    id: `${z.id}-label`,
    properties: propsOf(z, i),
    geometry: {
      type: 'Point',
      coordinates: labelPoint(z),
    },
  }))
  return { type: 'FeatureCollection', features }
}
