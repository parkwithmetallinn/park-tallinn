import type { DistrictZone } from '../types'
import tallinnDistricts from './tallinn_districts.json'

type DistrictFeature = {
  id?: string
  properties: {
    id: string
    name: string
    color: string
    kind: DistrictZone['kind']
    summary: string
    layerRole?: DistrictZone['layerRole']
    labelRank?: number
    fillSort?: number
    labelLng?: number
    labelLat?: number
  }
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

function ringArea(ring: number[][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Largest mainland outer ring as [lat, lng][] for PIP / synthetic sampling. */
function outerRingLatLng(geometry: DistrictFeature['geometry']): [number, number][] {
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : (geometry.coordinates as number[][][][])
  const mainland = polys.filter((poly) => {
    const ys = poly[0].map((p) => p[1])
    return Math.max(...ys) < 59.52
  })
  const use = mainland.length ? mainland : polys
  let best = use[0][0]
  let bestA = 0
  for (const poly of use) {
    const a = ringArea(poly[0])
    if (a > bestA) {
      bestA = a
      best = poly[0]
    }
  }
  const open =
    best.length > 1 &&
    best[0][0] === best[best.length - 1][0] &&
    best[0][1] === best[best.length - 1][1]
      ? best.slice(0, -1)
      : best
  return open.map(([lng, lat]) => [lat, lng] as [number, number])
}

const features = (tallinnDistricts as unknown as { features: DistrictFeature[] })
  .features

/**
 * Tallinn linnaosad + paid sub-zones (Vanalinn, Südalinn).
 * Geometry comes from official Tallinn GIS borders (coastline-clipped, non-overlapping
 * districts) — see `tallinn_districts.geojson`.
 */
export const DISTRICT_ZONES: DistrictZone[] = features.map((f) => {
  const p = f.properties
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    kind: p.kind,
    summary: p.summary,
    coords: outerRingLatLng(f.geometry),
    layerRole: p.layerRole ?? 'district',
    labelRank: p.labelRank,
    fillSort: p.fillSort,
    labelLng: p.labelLng,
    labelLat: p.labelLat,
    geometry: f.geometry,
  }
})
