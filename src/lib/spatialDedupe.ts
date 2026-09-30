/**
 * Suppress roadside curb lines that fall inside / directly border lot polygons.
 * Polygon lots win — avoids double-rendering the same parking area.
 */

import type { PreciseParkingCollection, PreciseParkingFeature } from './preciseParkingPolygons'
import type { StreetParkingCollection, StreetParkingFeature } from './streetParkingLines'

const CELL = 0.004 // ~300–400 m grid cells at Tallinn latitude
const DEFAULT_BORDER_M = 14

type PolyEntry = {
  feature: PreciseParkingFeature
  rings: number[][][] // outer rings as [lng,lat][]
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

function ringBBox(ring: number[][]): {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
} {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }
  return { minLng, minLat, maxLng, maxLat }
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function distPointToSegM(
  lng: number,
  lat: number,
  a: number[],
  b: number[],
): number {
  // Equirectangular meters near Tallinn
  const cos = Math.cos((lat * Math.PI) / 180)
  const ax = a[0] * 111_320 * cos
  const ay = a[1] * 111_320
  const bx = b[0] * 111_320 * cos
  const by = b[1] * 111_320
  const px = lng * 111_320 * cos
  const py = lat * 111_320
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function distPointToRingM(lng: number, lat: number, ring: number[][]): number {
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    best = Math.min(best, distPointToSegM(lng, lat, ring[i], ring[i + 1]))
  }
  return best
}

function extractOuterRings(f: PreciseParkingFeature): number[][][] {
  const g = f.geometry
  if (g.type === 'Polygon') return [g.coordinates[0]]
  return g.coordinates.map((poly) => poly[0])
}

function buildPolyIndex(polyFc: PreciseParkingCollection): {
  grid: Map<string, PolyEntry[]>
  entries: PolyEntry[]
} {
  const entries: PolyEntry[] = []
  const grid = new Map<string, PolyEntry[]>()

  for (const feature of polyFc.features) {
    const rings = extractOuterRings(feature)
    if (!rings.length) continue
    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity
    for (const ring of rings) {
      const b = ringBBox(ring)
      minLng = Math.min(minLng, b.minLng)
      minLat = Math.min(minLat, b.minLat)
      maxLng = Math.max(maxLng, b.maxLng)
      maxLat = Math.max(maxLat, b.maxLat)
    }
    const entry: PolyEntry = { feature, rings, minLng, minLat, maxLng, maxLat }
    entries.push(entry)

    const c0 = Math.floor(minLng / CELL)
    const c1 = Math.floor(maxLng / CELL)
    const r0 = Math.floor(minLat / CELL)
    const r1 = Math.floor(maxLat / CELL)
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = `${c}:${r}`
        const bucket = grid.get(key)
        if (bucket) bucket.push(entry)
        else grid.set(key, [entry])
      }
    }
  }

  return { grid, entries }
}

function candidatesNear(
  grid: Map<string, PolyEntry[]>,
  lng: number,
  lat: number,
): PolyEntry[] {
  const c = Math.floor(lng / CELL)
  const r = Math.floor(lat / CELL)
  const seen = new Set<PolyEntry>()
  const out: PolyEntry[] = []
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const bucket = grid.get(`${c + dc}:${r + dr}`)
      if (!bucket) continue
      for (const e of bucket) {
        if (seen.has(e)) continue
        seen.add(e)
        out.push(e)
      }
    }
  }
  return out
}

function sampleLine(coords: number[][], maxSamples = 7): number[][] {
  if (coords.length <= maxSamples) return coords
  const out: number[][] = []
  for (let i = 0; i < maxSamples; i++) {
    const t = i / (maxSamples - 1)
    const idx = Math.round(t * (coords.length - 1))
    out.push(coords[idx])
  }
  return out
}

function pointHitsPolygon(
  lng: number,
  lat: number,
  entry: PolyEntry,
  borderM: number,
): boolean {
  // Quick bbox reject with border padding (~meters → deg)
  const padLat = borderM / 111_320
  const padLng = borderM / (111_320 * Math.cos((lat * Math.PI) / 180))
  if (
    lng < entry.minLng - padLng ||
    lng > entry.maxLng + padLng ||
    lat < entry.minLat - padLat ||
    lat > entry.maxLat + padLat
  ) {
    return false
  }

  for (const ring of entry.rings) {
    if (pointInRing(lng, lat, ring)) return true
    if (distPointToRingM(lng, lat, ring) <= borderM) return true
  }
  return false
}

/** True when the street line lies inside / along a lot polygon. */
export function streetOverlapsPolygonLot(
  coords: number[][],
  grid: Map<string, PolyEntry[]>,
  borderM = DEFAULT_BORDER_M,
): boolean {
  if (coords.length < 2) return false
  const samples = sampleLine(coords)
  let hits = 0
  for (const [lng, lat] of samples) {
    const cands = candidatesNear(grid, lng, lat)
    for (const entry of cands) {
      if (pointHitsPolygon(lng, lat, entry, borderM)) {
        hits++
        break
      }
    }
  }
  // Majority of samples overlap → suppress (covers lines along lot edges)
  return hits >= Math.ceil(samples.length * 0.5)
}

export type StreetDedupeResult = {
  collection: StreetParkingCollection
  suppressed: number
  kept: number
  suppressedIds: string[]
}

/**
 * Prioritize polygons: drop street curb lines that overlap lot footprints.
 */
export function dedupeStreetAgainstPolygons(
  streetFc: StreetParkingCollection,
  polyFc: PreciseParkingCollection | null,
  borderMeters = DEFAULT_BORDER_M,
): StreetDedupeResult {
  if (!polyFc?.features.length) {
    return {
      collection: streetFc,
      suppressed: 0,
      kept: streetFc.features.length,
      suppressedIds: [],
    }
  }

  const { grid } = buildPolyIndex(polyFc)
  const kept: StreetParkingFeature[] = []
  const suppressedIds: string[] = []

  for (const f of streetFc.features) {
    const coords = f.geometry.coordinates
    if (streetOverlapsPolygonLot(coords, grid, borderMeters)) {
      suppressedIds.push(f.properties.id)
      continue
    }
    kept.push(f)
  }

  return {
    collection: { type: 'FeatureCollection', features: kept },
    suppressed: suppressedIds.length,
    kept: kept.length,
    suppressedIds,
  }
}
