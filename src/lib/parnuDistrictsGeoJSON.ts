/**
 * Pärnu official city districts (asumid) from OSM quarter relations.
 * Bundled JSON: src/data/parnuDistricts.json (= public/data/parnu_districts.geojson).
 */

import parnuDistrictsData from '../data/parnuDistricts.json'
import { parnuZonesToGeoJSON } from '../data/parnuZones'
import type {
  DistrictLabelCollection,
  DistrictPolyCollection,
} from './districtsGeoJSON'

type RawFeature = {
  type: string
  id?: string
  properties: {
    id: string
    name_et: string
    role: string
    labelPoint: [number, number]
  }
  geometry: DistrictPolyCollection['features'][number]['geometry']
}

type RawFC = {
  type: string
  features: RawFeature[]
}

const DATA = parnuDistrictsData as unknown as RawFC

/** Blue / dark-blue family — readable fills with strong outlines. */
const PARNU_DISTRICT_COLORS: Record<string, string> = {
  'vana-parnu': '#1E3A8A',
  ulejoe: '#1D4ED8',
  raama: '#2563EB',
  tammiste: '#1E40AF',
  kesklinn: '#1E3A8A',
  eeslinn: '#1D4ED8',
  rannarajoon: '#0369A1',
  mai: '#0284C7',
  raekula: '#0C4A6E',
  lodja: '#1E40AF',
}

const FALLBACK_BLUE = '#1D4ED8'

/** Display names uppercase with correct Estonian diacritics. */
const LABEL_UPPER: Record<string, string> = {
  'vana-parnu': 'VANA-PÄRNU',
  ulejoe: 'ÜLEJÕE',
  raama: 'RÄÄMA',
  tammiste: 'TAMMISTE',
  kesklinn: 'KESKLINN',
  eeslinn: 'EESLINN',
  rannarajoon: 'RANNARAJOON',
  mai: 'MAI',
  raekula: 'RAEKÜLA',
  lodja: 'LODJA',
}

export function parnuDistrictsToGeoJSON(): DistrictPolyCollection {
  return {
    type: 'FeatureCollection',
    features: DATA.features.map((f, i) => {
      const id = f.properties.id
      return {
        type: 'Feature' as const,
        id,
        properties: {
          id,
          name: LABEL_UPPER[id] ?? f.properties.name_et.toUpperCase(),
          name_et: LABEL_UPPER[id] ?? f.properties.name_et.toUpperCase(),
          role: 'district',
          color: PARNU_DISTRICT_COLORS[id] ?? FALLBACK_BLUE,
          labelRank: i + 1,
        },
        geometry: f.geometry,
      }
    }),
  }
}

export function parnuDistrictLabelsToGeoJSON(): DistrictLabelCollection {
  return {
    type: 'FeatureCollection',
    features: DATA.features.map((f, i) => {
      const id = f.properties.id
      const name = LABEL_UPPER[id] ?? f.properties.name_et.toUpperCase()
      return {
        type: 'Feature' as const,
        id,
        properties: {
          id,
          name,
          name_et: name,
          role: 'district',
          color: PARNU_DISTRICT_COLORS[id] ?? FALLBACK_BLUE,
          labelRank: i + 1,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: f.properties.labelPoint,
        },
      }
    }),
  }
}

/**
 * Combined overlay for Pärnu:
 * - role=district → official asumid (blue outlines)
 * - role=subzone → paid parking kesklinn/rand (existing)
 */
export function parnuOverlayPolygonsToGeoJSON(): DistrictPolyCollection {
  const districts = parnuDistrictsToGeoJSON()
  const zones = parnuZonesToGeoJSON()
  return {
    type: 'FeatureCollection',
    features: [
      ...districts.features,
      ...zones.features.map((f) => ({
        type: 'Feature' as const,
        id: String(f.id ?? f.properties.id),
        properties: {
          id: String(f.properties.id),
          name: String(f.properties.name_et ?? f.properties.name),
          name_et: String(f.properties.name_et ?? f.properties.name),
          role: 'subzone',
          color: String(f.properties.color),
          labelRank: 20,
        },
        geometry: f.geometry as DistrictPolyCollection['features'][number]['geometry'],
      })),
    ],
  }
}
