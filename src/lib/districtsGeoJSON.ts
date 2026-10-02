/**
 * Tallinn district overlays from public/data/districts.geojson
 * (bundled via src/data/districts.json).
 */
import districtsData from '../data/districts.json'
import type { DistrictZone } from '../types'

type DistrictProps = {
  id: string
  name_et: string
  role: 'district' | 'subzone'
  labelPoint: [number, number]
}

type DistrictFeature = {
  type: 'Feature'
  id?: string
  properties: DistrictProps
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

type DistrictFC = {
  type: 'FeatureCollection'
  features: DistrictFeature[]
  properties?: Record<string, unknown>
}

const DATA = districtsData as unknown as DistrictFC

export type DistrictPolyCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    id: string
    properties: {
      id: string
      name: string
      name_et: string
      role: string
      labelRank: number
    }
    geometry: DistrictFeature['geometry']
  }>
}

export type DistrictLabelCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    id: string
    properties: {
      id: string
      name: string
      name_et: string
      role: string
      labelRank: number
    }
    geometry: { type: 'Point'; coordinates: [number, number] }
  }>
}

/** Debug markers for the 12 QA reference points. */
export const DISTRICT_DEBUG_REFS: Array<{
  id: string
  name: string
  expect: string
  coordinates: [number, number]
}> = [
  { id: 'ref-town-hall', name: 'Town Hall', expect: 'Vanalinn', coordinates: [24.7454, 59.437] },
  { id: 'ref-freedom', name: 'Freedom Sq', expect: 'Kesklinn', coordinates: [24.7439, 59.4343] },
  { id: 'ref-viru', name: 'Viru', expect: 'Kesklinn', coordinates: [24.7536, 59.4363] },
  { id: 'ref-kadriorg', name: 'Kadriorg', expect: 'Kesklinn', coordinates: [24.792, 59.438] },
  { id: 'ref-kalamaja', name: 'Kalamaja', expect: 'Põhja-Tallinn', coordinates: [24.735, 59.445] },
  { id: 'ref-kopli', name: 'Kopli', expect: 'Põhja-Tallinn', coordinates: [24.69, 59.452] },
  { id: 'ref-oismae', name: 'Õismäe', expect: 'Haabersti', coordinates: [24.655, 59.416] },
  { id: 'ref-kristiine', name: 'Kristiine C', expect: 'Kristiine', coordinates: [24.72, 59.426] },
  { id: 'ref-mustamae', name: 'Mustamäe C', expect: 'Mustamäe', coordinates: [24.697, 59.407] },
  { id: 'ref-nomme', name: 'Nõmme C', expect: 'Nõmme', coordinates: [24.67, 59.388] },
  { id: 'ref-lasnamae', name: 'Lasnamäe C', expect: 'Lasnamäe', coordinates: [24.83, 59.435] },
  { id: 'ref-pirita', name: 'Pirita Beach', expect: 'Pirita', coordinates: [24.828, 59.468] },
]

function labelRank(role: string, name: string): number {
  if (role === 'subzone') return 1
  // Stable order for collision: central names prefer lower rank
  const order = [
    'Kesklinn',
    'Põhja-Tallinn',
    'Haabersti',
    'Kristiine',
    'Mustamäe',
    'Nõmme',
    'Lasnamäe',
    'Pirita',
  ]
  const i = order.indexOf(name)
  return i === -1 ? 50 : 10 + i
}

export function districtsToGeoJSON(): DistrictPolyCollection {
  return {
    type: 'FeatureCollection',
    features: DATA.features.map((f) => ({
      type: 'Feature',
      id: f.properties.id,
      properties: {
        id: f.properties.id,
        name: f.properties.name_et,
        name_et: f.properties.name_et,
        role: f.properties.role,
        labelRank: labelRank(f.properties.role, f.properties.name_et),
      },
      geometry: f.geometry,
    })),
  }
}

export function districtLabelsToGeoJSON(): DistrictLabelCollection {
  return {
    type: 'FeatureCollection',
    features: DATA.features.map((f) => ({
      type: 'Feature',
      id: `${f.properties.id}-label`,
      properties: {
        id: f.properties.id,
        name: f.properties.name_et,
        name_et: f.properties.name_et,
        role: f.properties.role,
        labelRank: labelRank(f.properties.role, f.properties.name_et),
      },
      geometry: {
        type: 'Point',
        coordinates: f.properties.labelPoint,
      },
    })),
  }
}

export function districtDebugRefsToGeoJSON() {
  return {
    type: 'FeatureCollection' as const,
    features: DISTRICT_DEBUG_REFS.map((r) => ({
      type: 'Feature' as const,
      id: r.id,
      properties: {
        id: r.id,
        name: r.name,
        expect: r.expect,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: r.coordinates,
      },
    })),
  }
}

/** Legacy DistrictZone[] for generateSpots / PIP helpers. */
export function districtsAsZones(): DistrictZone[] {
  return DATA.features
    .filter((f) => f.properties.role === 'district')
    .map((f) => {
      const ring: number[][] =
        f.geometry.type === 'Polygon'
          ? (f.geometry.coordinates[0] as number[][])
          : (f.geometry.coordinates[0][0] as number[][])
      const coords = ring.map(
        (pt) => [pt[1], pt[0]] as [number, number],
      )
      return {
        id: `d-${f.properties.id}`,
        name: f.properties.name_et,
        color: '#64748B',
        kind: 'mixed' as const,
        summary: f.properties.name_et,
        coords,
        layerRole: 'district' as const,
        labelLng: f.properties.labelPoint[0],
        labelLat: f.properties.labelPoint[1],
        geometry: f.geometry,
      }
    })
}
