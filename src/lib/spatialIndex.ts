import type { LngLatBoundsLike } from './bbox'
import { distanceMeters } from './geo'
import type { ParkingSpot } from '../types'

function pointInBounds(lat: number, lng: number, b: LngLatBoundsLike): boolean {
  return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north
}

function coordsHitBounds(
  coords: [number, number][] | undefined,
  b: LngLatBoundsLike,
): boolean {
  if (!coords?.length) return false
  for (const [lat, lng] of coords) {
    if (pointInBounds(lat, lng, b)) return true
  }
  // Also: segment/ring bbox intersects viewport
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lat, lng] of coords) {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }
  return !(maxLng < b.west || minLng > b.east || maxLat < b.south || minLat > b.north)
}

/**
 * Flat + bbox spatial index.
 * Public API: viewport bounding-box queries (points, lines, polygons).
 */
export class ParkingSpatialIndex {
  private spots: ParkingSpot[] = []
  private byId = new Map<string, ParkingSpot>()

  clear() {
    this.spots = []
    this.byId.clear()
  }

  bulkLoad(spots: ParkingSpot[]) {
    this.clear()
    for (const spot of spots) this.insert(spot)
  }

  insert(spot: ParkingSpot) {
    const prev = this.byId.get(spot.id)
    if (prev) {
      const idx = this.spots.indexOf(prev)
      if (idx >= 0) this.spots[idx] = spot
      else this.spots.push(spot)
    } else {
      this.spots.push(spot)
    }
    this.byId.set(spot.id, spot)
  }

  getById(id: string): ParkingSpot | undefined {
    return this.byId.get(id)
  }

  get size() {
    return this.spots.length
  }

  queryBounds(bounds: LngLatBoundsLike): ParkingSpot[] {
    const out: ParkingSpot[] = []
    for (const s of this.spots) {
      if (pointInBounds(s.lat, s.lng, bounds)) {
        out.push(s)
        continue
      }
      if (coordsHitBounds(s.line, bounds) || coordsHitBounds(s.polygon, bounds)) {
        out.push(s)
      }
    }
    return out
  }

  landmarks(): ParkingSpot[] {
    return this.spots.filter((s) => s.landmark)
  }

  forEach(fn: (spot: ParkingSpot) => void) {
    for (const s of this.spots) fn(s)
  }

  toArray(): ParkingSpot[] {
    return this.spots.slice()
  }

  /**
   * Nearest roadside line or lot polygon within `radiusM` of a destination.
   * Used by the search Destination Interceptor.
   * Do not change this behavior — alternatives use queryNearbyParkingList.
   */
  queryNearbyParking(
    lat: number,
    lng: number,
    radiusM = 400,
  ): { spot: ParkingSpot; distanceM: number } | null {
    let best: ParkingSpot | null = null
    let bestD = Infinity
    for (const s of this.spots) {
      const isRoadside =
        s.featureType === 'on-street-line' || Boolean(s.line) || s.kind === 'street'
      const isLot =
        s.featureType === 'off-street-lot' ||
        s.featureType === 'municipal-zone' ||
        Boolean(s.polygon) ||
        s.kind === 'lot'
      if (!isRoadside && !isLot) continue
      const d = distanceMeters(lat, lng, s.lat, s.lng)
      if (d <= radiusM && d < bestD) {
        best = s
        bestD = d
      }
    }
    return best ? { spot: best, distanceM: bestD } : null
  }

  /**
   * All roadside / lot parking within `radiusM`, nearest first.
   * Optional excludeIds skips already-selected or full spots.
   */
  queryNearbyParkingList(
    lat: number,
    lng: number,
    radiusM = 400,
    opts?: { excludeIds?: Iterable<string> },
  ): Array<{ spot: ParkingSpot; distanceM: number }> {
    const exclude = new Set(opts?.excludeIds ?? [])
    const out: Array<{ spot: ParkingSpot; distanceM: number }> = []
    for (const s of this.spots) {
      if (exclude.has(s.id)) continue
      const isRoadside =
        s.featureType === 'on-street-line' || Boolean(s.line) || s.kind === 'street'
      const isLot =
        s.featureType === 'off-street-lot' ||
        s.featureType === 'municipal-zone' ||
        Boolean(s.polygon) ||
        s.kind === 'lot'
      if (!isRoadside && !isLot) continue
      const d = distanceMeters(lat, lng, s.lat, s.lng)
      if (d <= radiusM) out.push({ spot: s, distanceM: d })
    }
    out.sort((a, b) => a.distanceM - b.distanceM)
    return out
  }
}

export const parkingIndex = new ParkingSpatialIndex()
