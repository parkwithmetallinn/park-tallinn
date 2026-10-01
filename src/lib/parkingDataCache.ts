/**
 * Cache-first parking loaders backed by estonia_parking_master.geojson.
 * Production master file is never mutated; results live in memory.
 */

import {
  getCachedMasterSplit,
  loadEstoniaParkingMaster,
  type MasterParkingSplit,
} from './estoniaParkingMaster'
import type { PreciseParkingCollection } from './preciseParkingPolygons'
import type { StreetParkingCollection } from './streetParkingLines'

const META_KEY = 'parkvibe_master_cache_meta'

type CacheMeta = { fetchedAt: number; rawCount: number; lots: number; streets: number }

function writeMeta(meta: CacheMeta) {
  try {
    sessionStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
}

function readMeta(): CacheMeta | null {
  try {
    const raw = sessionStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as CacheMeta) : null
  } catch {
    return null
  }
}

async function ensureMaster(force = false): Promise<MasterParkingSplit> {
  const split = await loadEstoniaParkingMaster(undefined, force)
  writeMeta({
    fetchedAt: Date.now(),
    rawCount: split.rawCount,
    lots: split.polygons.features.length,
    streets: split.streets.features.length,
  })
  return split
}

export function getCachedPolygons(): PreciseParkingCollection | null {
  return getCachedMasterSplit()?.polygons ?? null
}

export function getCachedStreets(): StreetParkingCollection | null {
  return getCachedMasterSplit()?.streets ?? null
}

export async function loadParkingPolygonsCached(
  force = false,
): Promise<PreciseParkingCollection> {
  const split = await ensureMaster(force)
  return split.polygons
}

export async function loadStreetParkingCached(
  force = false,
): Promise<StreetParkingCollection> {
  const split = await ensureMaster(force)
  return split.streets
}

/** Prefetch master layer (call on app boot / hover admin). */
export function prefetchParkingLayers(): void {
  void ensureMaster(false)
}

export function parkingCacheMeta() {
  const mem = getCachedMasterSplit()
  return {
    master: readMeta(),
    hasMemory: Boolean(mem),
    lots: mem?.polygons.features.length ?? 0,
    streets: mem?.streets.features.length ?? 0,
  }
}
