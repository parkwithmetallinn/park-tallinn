import { DISTRICT_ZONES } from '../data/districts'
import type { DistrictZone } from '../types'

type Feat = {
  type: 'Feature'
  id: string
  properties: {
    id: string
    name: string
    color: string
    kind: string
    summary: string
    labelRank: number
  }
  geometry: {
    type: 'Polygon'
    coordinates: [number, number][][]
  }
}

type FeatColl = { type: 'FeatureCollection'; features: Feat[] }

/** District polygons for city-macro LOD (zoom < 13). */
export function districtsToGeoJSON(
  zones: DistrictZone[] = DISTRICT_ZONES,
): FeatColl {
  const features: Feat[] = zones.map((z, i) => {
    const ring = z.coords.map(([lat, lng]) => [lng, lat] as [number, number])
    const [aLng, aLat] = ring[0]
    const [bLng, bLat] = ring[ring.length - 1]
    if (aLng !== bLng || aLat !== bLat) ring.push([aLng, aLat])
    return {
      type: 'Feature',
      id: z.id,
      properties: {
        id: z.id,
        name: z.name,
        color: z.color,
        kind: z.kind,
        summary: z.summary,
        // Unique ranks so overlapping district labels collide cleanly
        labelRank: i,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    }
  })
  return { type: 'FeatureCollection', features }
}
