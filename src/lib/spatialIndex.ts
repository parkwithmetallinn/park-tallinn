import type { LngLatBoundsLike } from './bbox'
import type { ParkingSpot } from '../types'

/**
 * Flat + bbox spatial index.
 * Internal acceleration may use coarse cells; the public API is always
 * viewport bounding-box queries (not a drawn 100×100 m grid).
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
    this.byId.set(spot.id, spot)
    this.spots.push(spot)
  }

  getById(id: string): ParkingSpot | undefined {
    return this.byId.get(id)
  }

  get size() {
    return this.spots.length
  }

  /**
   * Return spots whose coordinates fall inside the viewport bbox
   * (optionally padded in degrees by the caller via expanded bounds).
   */
  queryBounds(bounds: LngLatBoundsLike): ParkingSpot[] {
    const { west, south, east, north } = bounds
    const out: ParkingSpot[] = []
    for (const s of this.spots) {
      if (s.lng >= west && s.lng <= east && s.lat >= south && s.lat <= north) {
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
}

export const parkingIndex = new ParkingSpatialIndex()
