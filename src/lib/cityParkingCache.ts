/**
 * City-aware parking loaders. Tallinn keeps the existing Estonia master path;
 * Pärnu loads its own extract and applies zone freeRules enrichment.
 */

import { CITIES, type CityId } from '../data/cities'
import {
  getCachedMasterSplit,
  loadEstoniaParkingMaster,
  splitMasterCollection,
  type MasterParkingSplit,
} from './estoniaParkingMaster'
import { enrichParnuPolygons, enrichParnuStreets } from './parnuEnrichment'
import {
  prepareParkingPolygons,
  type PreciseParkingCollection,
} from './preciseParkingPolygons'
import {
  prepareStreetParking,
  type StreetParkingCollection,
} from './streetParkingLines'

type CitySplit = MasterParkingSplit & { cityId: CityId }

const memory = new Map<CityId, CitySplit>()
const inflight = new Map<CityId, Promise<CitySplit>>()

async function loadTallinn(force = false): Promise<CitySplit> {
  const split = await loadEstoniaParkingMaster(CITIES.tallinn.parkingUrl, force)
  return { ...split, cityId: 'tallinn' }
}

async function loadParnu(_force = false): Promise<CitySplit> {
  const url = CITIES.parnu.parkingUrl
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load Pärnu parking (${res.status})`)
  const raw = (await res.json()) as {
    type: string
    features?: Array<{
      type: string
      id?: string | number
      properties?: Record<string, unknown> | null
      geometry?: { type: string; coordinates?: unknown } | null
    }>
  }
  const { lotRaw, streetRaw } = splitMasterCollection(raw)
  // prepare → enrich (injects Kesklinn/Rand RED paid-zone polygons)
  const polygons = enrichParnuPolygons(
    prepareParkingPolygons(lotRaw as never),
  )
  const streets = enrichParnuStreets(prepareStreetParking(streetRaw as never))
  if (import.meta.env.DEV) {
    const zones = polygons.features.filter((f) =>
      String(f.properties.id).startsWith('parnu-zone-'),
    )
    console.info('[parking] Pärnu enriched', {
      lots: polygons.features.length,
      streets: streets.features.length,
      paidZones: zones.map((z) => z.properties.id),
    })
  }
  return {
    cityId: 'parnu',
    polygons,
    streets,
    rawCount: raw.features?.length ?? 0,
    lotCount: polygons.features.length,
    streetRawCount: streets.features.length,
  }
}

export async function loadCityParking(
  cityId: CityId,
  force = false,
): Promise<CitySplit> {
  if (!force && memory.has(cityId)) return memory.get(cityId)!
  if (!force && inflight.has(cityId)) return inflight.get(cityId)!

  const p = (async () => {
    const split = cityId === 'parnu' ? await loadParnu(force) : await loadTallinn(force)
    memory.set(cityId, split)
    return split
  })().finally(() => {
    inflight.delete(cityId)
  })

  inflight.set(cityId, p)
  return p
}

export function getCachedCityPolygons(cityId: CityId): PreciseParkingCollection | null {
  if (cityId === 'tallinn') return getCachedMasterSplit()?.polygons ?? null
  return memory.get(cityId)?.polygons ?? null
}

export function getCachedCityStreets(cityId: CityId): StreetParkingCollection | null {
  if (cityId === 'tallinn') return getCachedMasterSplit()?.streets ?? null
  return memory.get(cityId)?.streets ?? null
}

export function clearCityParkingMemory(cityId?: CityId) {
  if (cityId) memory.delete(cityId)
  else memory.clear()
}
