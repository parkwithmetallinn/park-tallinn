/**
 * Single source of truth for map parking geometry:
 *   public/data/ee_parking_max.geojson (nationwide Overpass + municipal merge)
 *
 * Splits features into lot polygons vs roadside curb geometry so MapView
 * can keep its dual-layer rendering without the old split files.
 */

import {
  prepareParkingPolygons,
  type PreciseParkingCollection,
} from './preciseParkingPolygons'
import {
  prepareStreetParking,
  type StreetParkingCollection,
} from './streetParkingLines'

export const ESTONIA_PARKING_MASTER_URL = '/data/ee_parking_max.geojson'

type RawFeature = {
  type: string
  id?: string | number
  properties?: Record<string, unknown> | null
  geometry?: {
    type: string
    coordinates?: unknown
  } | null
}

type RawCollection = {
  type: string
  features?: RawFeature[]
}

export type MasterParkingSplit = {
  polygons: PreciseParkingCollection
  streets: StreetParkingCollection
  rawCount: number
  lotCount: number
  streetRawCount: number
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function hasParkingLaneTags(p: Record<string, unknown>): boolean {
  for (const k of Object.keys(p)) {
    if (
      k.startsWith('parking:lane') ||
      k.startsWith('parking:both') ||
      k.startsWith('parking:left') ||
      k.startsWith('parking:right')
    ) {
      const val = str(p[k]).toLowerCase()
      if (val && val !== 'no') return true
    }
  }
  return false
}

/** Roadside / curb features → street layer; everything else polygonal → lots. */
export function isStreetParkingFeature(f: RawFeature): boolean {
  const g = f.geometry?.type
  if (g === 'LineString' || g === 'MultiLineString') return true
  const p = f.properties ?? {}
  const parking = str(p.parking).toLowerCase()
  if (parking === 'street_side' || parking === 'lane' || parking === 'on_kerb') {
    return true
  }
  if (hasParkingLaneTags(p)) return true
  return false
}

export function splitMasterCollection(raw: RawCollection): {
  lotRaw: RawCollection
  streetRaw: RawCollection
} {
  const lots: RawFeature[] = []
  const streets: RawFeature[] = []
  for (const f of raw.features ?? []) {
    if (!f.geometry) continue
    if (isStreetParkingFeature(f)) {
      streets.push(f)
      continue
    }
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      lots.push(f)
    }
  }
  return {
    lotRaw: { type: 'FeatureCollection', features: lots },
    streetRaw: { type: 'FeatureCollection', features: streets },
  }
}

let masterInflight: Promise<MasterParkingSplit> | null = null
let masterMemory: MasterParkingSplit | null = null

export function getCachedMasterSplit(): MasterParkingSplit | null {
  return masterMemory
}

export async function loadEstoniaParkingMaster(
  url = ESTONIA_PARKING_MASTER_URL,
  force = false,
): Promise<MasterParkingSplit> {
  if (!force && masterMemory) return masterMemory
  if (!force && masterInflight) return masterInflight

  masterInflight = (async () => {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to load ee_parking_max.geojson (${res.status})`)
    }
    const raw = (await res.json()) as RawCollection
    const { lotRaw, streetRaw } = splitMasterCollection(raw)
    // Prepare fns own narrower RawCollection types; master features are OSM-mixed.
    const polygons = prepareParkingPolygons(lotRaw as never)
    const streets = prepareStreetParking(streetRaw as never)
    const split: MasterParkingSplit = {
      polygons,
      streets,
      rawCount: raw.features?.length ?? 0,
      lotCount: lotRaw.features?.length ?? 0,
      streetRawCount: streetRaw.features?.length ?? 0,
    }
    masterMemory = split
    return split
  })().finally(() => {
    masterInflight = null
  })

  return masterInflight
}
