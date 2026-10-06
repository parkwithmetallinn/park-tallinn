/**
 * Nõmme district parking enrichment.
 *
 * Official Tallinn rule: public streets in Nõmme are unlimited free (Tasuta)
 * unless privately signed. We map that from the road-network GIS extract and
 * keep ONLY allowlisted verified off-street lots (no invented polygons).
 */

import nommeMeta from '../data/nommeDistrictRing.json'
import type { MasterParkingSplit } from './estoniaParkingMaster'
import {
  prepareParkingPolygons,
  type PreciseParkingCollection,
  type PreciseParkingFeature,
} from './preciseParkingPolygons'
import {
  prepareStreetParking,
  type StreetParkingCollection,
  type StreetParkingFeature,
} from './streetParkingLines'

const STREETS_URL = '/data/nomme_free_streets.geojson'
const LOTS_URL = '/data/nomme_verified_lots.geojson'

/** Nõmme outer ring as [lng, lat][] from Tallinn GIS districts. */
const NOMME_RING: [number, number][] = nommeMeta.ring as [number, number][]

const VERIFIED_LOT_IDS = new Set<string>(nommeMeta.verifiedLotIds as string[])
const VERIFIED_OSM_WAYS = new Set<string>(nommeMeta.verifiedOsmWays as string[])

let streetsCache: StreetParkingCollection | null = null
let lotsCache: PreciseParkingCollection | null = null
let overlayInflight: Promise<void> | null = null

/** Ray-cast PIP — ring is [lng, lat][]. */
export function pointInNomme(lng: number, lat: number): boolean {
  let inside = false
  for (let i = 0, j = NOMME_RING.length - 1; i < NOMME_RING.length; j = i++) {
    const [xi, yi] = NOMME_RING[i]
    const [xj, yj] = NOMME_RING[j]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function featureCentroidLngLat(geom: {
  type: string
  coordinates: unknown
}): { lng: number; lat: number } | null {
  try {
    if (geom.type === 'Point') {
      const c = geom.coordinates as number[]
      return { lng: c[0], lat: c[1] }
    }
    if (geom.type === 'LineString') {
      const coords = geom.coordinates as number[][]
      const mid = coords[Math.floor(coords.length / 2)]
      return { lng: mid[0], lat: mid[1] }
    }
    if (geom.type === 'Polygon') {
      const ring = (geom.coordinates as number[][][])[0]
      let sx = 0
      let sy = 0
      const n = Math.max(1, ring.length - 1)
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return { lng: sx / n, lat: sy / n }
    }
    if (geom.type === 'MultiPolygon') {
      const ring = (geom.coordinates as number[][][][])[0][0]
      let sx = 0
      let sy = 0
      const n = Math.max(1, ring.length - 1)
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return { lng: sx / n, lat: sy / n }
    }
  } catch {
    return null
  }
  return null
}

function isVerifiedNommeLot(f: PreciseParkingFeature): boolean {
  const id = String(f.id ?? f.properties.id ?? '')
  if (VERIFIED_LOT_IDS.has(id)) return true
  if (id.startsWith('lot-nomme-')) return true
  const src = String(f.properties.source ?? '')
  if (src === 'nomme_verified') return true
  // Match OSM way ids that may appear as w/… or way/…
  for (const way of VERIFIED_OSM_WAYS) {
    const short = way.replace('way/', 'w/')
    if (id === way || id === short || id.includes(way) || id.includes(short)) {
      return true
    }
  }
  return false
}

async function loadNommeOverlays(force = false): Promise<void> {
  if (!force && streetsCache && lotsCache) return
  if (!force && overlayInflight) return overlayInflight

  overlayInflight = (async () => {
    const [streetsRes, lotsRes] = await Promise.all([
      fetch(STREETS_URL),
      fetch(LOTS_URL),
    ])
    if (!streetsRes.ok) {
      throw new Error(`Failed to load Nõmme streets (${streetsRes.status})`)
    }
    if (!lotsRes.ok) {
      throw new Error(`Failed to load Nõmme lots (${lotsRes.status})`)
    }
    const streetsRaw = await streetsRes.json()
    const lotsRaw = await lotsRes.json()

    // Ensure Laagri is classified as park_ride before prepare
    for (const f of lotsRaw.features ?? []) {
      const p = f.properties ?? {}
      if (p.park_ride === 'yes' || p.parking === 'park_and_ride') {
        p.layer = 'park_ride'
      } else if (p.fee === 'no' || p.rules === 'free') {
        p.layer = 'free_street'
      }
      f.properties = p
    }

    streetsCache = prepareStreetParking(streetsRaw)
    lotsCache = prepareParkingPolygons(lotsRaw)

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.info('[parking] Nõmme overlays', {
        streets: streetsCache.features.length,
        lots: lotsCache.features.length,
        lotIds: lotsCache.features.map((f) => f.id),
      })
    }
  })().finally(() => {
    overlayInflight = null
  })

  return overlayInflight
}

/**
 * Strip unverified Nõmme lots + sparse OSM curb lines, inject road-GIS
 * Tasuta streets and allowlisted verified lots.
 */
export async function enrichNommeParking(
  split: MasterParkingSplit,
  force = false,
): Promise<MasterParkingSplit> {
  await loadNommeOverlays(force)

  const nommeStreets = streetsCache!.features
  const nommeLots = lotsCache!.features
  const nommeLotIdSet = new Set(nommeLots.map((f) => String(f.id)))

  let droppedLots = 0
  const keptLots: PreciseParkingFeature[] = []
  for (const f of split.polygons.features) {
    const c = featureCentroidLngLat(f.geometry)
    if (!c || !pointInNomme(c.lng, c.lat)) {
      keptLots.push(f)
      continue
    }
    if (isVerifiedNommeLot(f) || nommeLotIdSet.has(String(f.id))) {
      // Prefer our curated verified geometry — skip duplicate OSM copy
      continue
    }
    // Drop unverified / random OSM lots inside Nõmme
    droppedLots++
  }

  let droppedStreets = 0
  const keptStreets: StreetParkingFeature[] = []
  for (const f of split.streets.features) {
    const c = featureCentroidLngLat(f.geometry)
    if (!c || !pointInNomme(c.lng, c.lat)) {
      keptStreets.push(f)
      continue
    }
    // Replace sparse OSM lane fragments with full road-GIS coverage
    droppedStreets++
  }

  const polygons: PreciseParkingCollection = {
    type: 'FeatureCollection',
    features: [...keptLots, ...nommeLots],
  }
  const streets: StreetParkingCollection = {
    type: 'FeatureCollection',
    features: [...keptStreets, ...nommeStreets],
  }

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.info('[parking] Nõmme enrichment', {
      droppedLots,
      droppedStreets,
      injectedLots: nommeLots.length,
      injectedStreets: nommeStreets.length,
      freeStreets: nommeStreets.filter((f) => f.properties.verified_free).length,
    })
  }

  return {
    ...split,
    polygons,
    streets,
    lotCount: polygons.features.length,
    streetRawCount: streets.features.length,
  }
}

export function getNommeOverlayStats() {
  return {
    streets: streetsCache?.features.length ?? 0,
    lots: lotsCache?.features.length ?? 0,
    verifiedLotIds: [...VERIFIED_LOT_IDS],
  }
}
