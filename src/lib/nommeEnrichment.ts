/**
 * Nõmme parking enrichment (lots only).
 *
 * Street/road polyline overlays are globally disabled — this module no longer
 * injects road-GIS curb lines. Nõmme off-street lots stay allowlisted verified
 * polygons only (`nomme_verified_lots.geojson`).
 */

import nommeMeta from '../data/nommeDistrictRing.json'
import type { MasterParkingSplit } from './estoniaParkingMaster'
import {
  prepareParkingPolygons,
  type PreciseParkingCollection,
  type PreciseParkingFeature,
} from './preciseParkingPolygons'
import type { StreetParkingCollection } from './streetParkingLines'

const NOMME_LOTS_URL = '/data/nomme_verified_lots.geojson'

const NOMME_RING: [number, number][] = nommeMeta.ring as [number, number][]
const VERIFIED_LOT_IDS = new Set<string>(nommeMeta.verifiedLotIds as string[])
const VERIFIED_OSM_WAYS = new Set<string>(nommeMeta.verifiedOsmWays as string[])

const EMPTY_STREETS: StreetParkingCollection = {
  type: 'FeatureCollection',
  features: [],
}

let nommeLotsCache: PreciseParkingCollection | null = null
let overlayInflight: Promise<void> | null = null

/** Ray-cast PIP — ring is [lng, lat][]. Nõmme linnaosa only. */
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

async function loadNommeLots(force = false): Promise<void> {
  if (!force && nommeLotsCache) return
  if (!force && overlayInflight) return overlayInflight

  overlayInflight = (async () => {
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

    nommeLotsCache = prepareParkingPolygons(lotsRaw)

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.info('[parking] Nõmme verified lots only', {
        lots: nommeLotsCache.features.length,
        lotIds: nommeLotsCache.features.map((f) => f.id),
      })
    }
  })().finally(() => {
    overlayInflight = null
  })

  return overlayInflight
}

/**
 * Nõmme lot allowlist + **global ban on street polyline overlays**.
 * Always returns an empty streets FeatureCollection.
 */
export async function enrichNommeParking(
  split: MasterParkingSplit,
  force = false,
): Promise<MasterParkingSplit> {
  await loadNommeLots(force)

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

  const polygons: PreciseParkingCollection = {
    type: 'FeatureCollection',
    features: [...keptLots, ...nommeLots],
  }

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.info('[parking] enrichment (lots only, streets disabled)', {
      droppedLots,
      injectedNommeLots: nommeLots.length,
      streets: 0,
    })
  }

  return {
    ...split,
    polygons,
    // Absolute ban: never emit road/street polyline overlays
    streets: EMPTY_STREETS,
    lotCount: polygons.features.length,
    streetRawCount: 0,
  }
}

export function getNommeOverlayStats() {
  return {
    streets: 0,
    lots: nommeLotsCache?.features.length ?? 0,
    verifiedLotIds: [...VERIFIED_LOT_IDS],
  }
}
