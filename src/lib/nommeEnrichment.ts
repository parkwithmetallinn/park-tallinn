/**
 * Tallinn + Nõmme parking enrichment.
 *
 * 1. Public streets outside municipal paid zones → Tasuta (green) from
 *    road-network GIS (`tallinn_free_streets.geojson`).
 * 2. Inside paid zones → keep master curb lines (zone overrides → red/yellow).
 * 3. Nõmme off-street lots → ONLY allowlisted verified polygons
 *    (`nomme_verified_lots.geojson`). No invented lots.
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
import { lookupTallinnPaidZone } from './tallinnZoneEnrichment'

const TALLINN_STREETS_URL = '/data/tallinn_free_streets.geojson'
const NOMME_LOTS_URL = '/data/nomme_verified_lots.geojson'
/** Legacy Nõmme-only extract — used as fallback if citywide file missing. */
const NOMME_STREETS_URL = '/data/nomme_free_streets.geojson'

const NOMME_RING: [number, number][] = nommeMeta.ring as [number, number][]
const VERIFIED_LOT_IDS = new Set<string>(nommeMeta.verifiedLotIds as string[])
const VERIFIED_OSM_WAYS = new Set<string>(nommeMeta.verifiedOsmWays as string[])

let freeStreetsCache: StreetParkingCollection | null = null
let nommeLotsCache: PreciseParkingCollection | null = null
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
  for (const way of VERIFIED_OSM_WAYS) {
    const short = way.replace('way/', 'w/')
    if (id === way || id === short || id.includes(way) || id.includes(short)) {
      return true
    }
  }
  return false
}

async function loadOverlays(force = false): Promise<void> {
  if (!force && freeStreetsCache && nommeLotsCache) return
  if (!force && overlayInflight) return overlayInflight

  overlayInflight = (async () => {
    const streetsRes = await fetch(TALLINN_STREETS_URL)
    const streetsUrlOk = streetsRes.ok
    const streetsRaw = streetsUrlOk
      ? await streetsRes.json()
      : await (await fetch(NOMME_STREETS_URL)).json()

    const lotsRes = await fetch(NOMME_LOTS_URL)
    if (!lotsRes.ok) {
      throw new Error(`Failed to load Nõmme lots (${lotsRes.status})`)
    }
    const lotsRaw = await lotsRes.json()

    for (const f of lotsRaw.features ?? []) {
      const p = f.properties ?? {}
      if (p.park_ride === 'yes' || p.parking === 'park_and_ride') {
        p.layer = 'park_ride'
      } else if (p.fee === 'no' || p.rules === 'free') {
        p.layer = 'free_street'
      }
      f.properties = p
    }

    freeStreetsCache = prepareStreetParking(streetsRaw)
    nommeLotsCache = prepareParkingPolygons(lotsRaw)

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.info('[parking] Tallinn free-street overlays', {
        source: streetsUrlOk ? 'tallinn_free_streets' : 'nomme_free_streets',
        streets: freeStreetsCache.features.length,
        nommeLots: nommeLotsCache.features.length,
        freeVerified: freeStreetsCache.features.filter(
          (f) => f.properties.verified_free,
        ).length,
      })
    }
  })().finally(() => {
    overlayInflight = null
  })

  return overlayInflight
}

/**
 * Apply Tallinn free-street GIS + Nõmme verified-lot allowlist.
 * Exported name kept for callers (`enrichNommeParking`).
 */
export async function enrichNommeParking(
  split: MasterParkingSplit,
  force = false,
): Promise<MasterParkingSplit> {
  await loadOverlays(force)

  const freeStreets = freeStreetsCache!.features
  const nommeLots = nommeLotsCache!.features
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
      continue
    }
    droppedLots++
  }

  // Outside paid zones: replace sparse OSM curb with road-GIS Tasuta lines.
  // Inside paid zones: keep master streets (zone overrides → red / yellow).
  let droppedStreets = 0
  const keptStreets: StreetParkingFeature[] = []
  for (const f of split.streets.features) {
    const c = featureCentroidLngLat(f.geometry)
    if (!c) continue
    const inPaid = Boolean(lookupTallinnPaidZone(c.lat, c.lng))
    if (inPaid) {
      keptStreets.push(f)
      continue
    }
    droppedStreets++
  }

  const polygons: PreciseParkingCollection = {
    type: 'FeatureCollection',
    features: [...keptLots, ...nommeLots],
  }
  const streets: StreetParkingCollection = {
    type: 'FeatureCollection',
    features: [...keptStreets, ...freeStreets],
  }

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.info('[parking] Tallinn enrichment', {
      droppedLots,
      droppedStreetsOutsidePaid: droppedStreets,
      injectedFreeStreets: freeStreets.length,
      injectedNommeLots: nommeLots.length,
      keptPaidZoneStreets: keptStreets.length,
      freeVerified: freeStreets.filter((f) => f.properties.verified_free).length,
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
    streets: freeStreetsCache?.features.length ?? 0,
    lots: nommeLotsCache?.features.length ?? 0,
    verifiedLotIds: [...VERIFIED_LOT_IDS],
  }
}
