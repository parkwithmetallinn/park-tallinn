/**
 * Cache-first parking GeoJSON loaders (stale-while-revalidate).
 * Production files are never mutated; results live in memory + optional IDB-ish
 * session markers so revisits / remounts paint immediately.
 */

import {
  loadParkingPolygons,
  type PreciseParkingCollection,
} from './preciseParkingPolygons'
import {
  loadStreetParking,
  type StreetParkingCollection,
} from './streetParkingLines'

const POLY_META_KEY = 'parkvibe_poly_cache_meta'
const STREET_META_KEY = 'parkvibe_street_cache_meta'

type CacheMeta = { fetchedAt: number; featureCount: number }

let polyMemory: PreciseParkingCollection | null = null
let streetMemory: StreetParkingCollection | null = null
let polyInflight: Promise<PreciseParkingCollection> | null = null
let streetInflight: Promise<StreetParkingCollection> | null = null

function readMeta(key: string): CacheMeta | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as CacheMeta) : null
  } catch {
    return null
  }
}

function writeMeta(key: string, meta: CacheMeta) {
  try {
    sessionStorage.setItem(key, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
}

export function getCachedPolygons(): PreciseParkingCollection | null {
  return polyMemory
}

export function getCachedStreets(): StreetParkingCollection | null {
  return streetMemory
}

export async function loadParkingPolygonsCached(
  force = false,
): Promise<PreciseParkingCollection> {
  if (!force && polyMemory) return polyMemory
  if (!force && polyInflight) return polyInflight
  polyInflight = loadParkingPolygons()
    .then((fc) => {
      polyMemory = fc
      writeMeta(POLY_META_KEY, {
        fetchedAt: Date.now(),
        featureCount: fc.features.length,
      })
      return fc
    })
    .finally(() => {
      polyInflight = null
    })
  return polyInflight
}

export async function loadStreetParkingCached(
  force = false,
): Promise<StreetParkingCollection> {
  if (!force && streetMemory) return streetMemory
  if (!force && streetInflight) return streetInflight
  streetInflight = loadStreetParking()
    .then((fc) => {
      streetMemory = fc
      writeMeta(STREET_META_KEY, {
        fetchedAt: Date.now(),
        featureCount: fc.features.length,
      })
      return fc
    })
    .finally(() => {
      streetInflight = null
    })
  return streetInflight
}

/** Prefetch both layers (call on app boot / hover admin). */
export function prefetchParkingLayers(): void {
  void loadParkingPolygonsCached()
  void loadStreetParkingCached()
}

export function parkingCacheMeta() {
  return {
    polygons: readMeta(POLY_META_KEY),
    streets: readMeta(STREET_META_KEY),
    hasPolyMemory: Boolean(polyMemory),
    hasStreetMemory: Boolean(streetMemory),
  }
}
