import { cellKey, latLngToCell } from './grid'
import type { ParkingProvider, ParkingSpot } from '../types'

export type CellAggregate = {
  key: string
  total: number
  byProvider: Partial<Record<ParkingProvider, number>>
}

/**
 * In-memory spatial index keyed by 100×100 m cell.
 * Swap `queryCells` implementation later for HTTP → Maa-amet / backend API
 * without changing MapView.
 */
export class ParkingSpatialIndex {
  private cells = new Map<string, ParkingSpot[]>()
  private byId = new Map<string, ParkingSpot>()
  private aggregates = new Map<string, CellAggregate>()

  clear() {
    this.cells.clear()
    this.byId.clear()
    this.aggregates.clear()
  }

  bulkLoad(spots: ParkingSpot[]) {
    this.clear()
    for (const spot of spots) {
      this.insert(spot)
    }
  }

  insert(spot: ParkingSpot) {
    this.byId.set(spot.id, spot)
    const key = cellKey(latLngToCell(spot.lat, spot.lng))
    let list = this.cells.get(key)
    if (!list) {
      list = []
      this.cells.set(key, list)
    }
    list.push(spot)

    let agg = this.aggregates.get(key)
    if (!agg) {
      agg = { key, total: 0, byProvider: {} }
      this.aggregates.set(key, agg)
    }
    agg.total++
    const p = spot.provider
    agg.byProvider[p] = (agg.byProvider[p] ?? 0) + 1
  }

  getById(id: string): ParkingSpot | undefined {
    return this.byId.get(id)
  }

  /** O(k) where k = number of requested cells — not total dataset size. */
  queryCells(keys: string[]): ParkingSpot[] {
    if (keys.length === 0) return []
    const out: ParkingSpot[] = []
    const seen = new Set<string>()
    for (const key of keys) {
      const list = this.cells.get(key)
      if (!list) continue
      for (const s of list) {
        if (seen.has(s.id)) continue
        seen.add(s.id)
        out.push(s)
      }
    }
    return out
  }

  queryCellAggregates(keys: string[]): CellAggregate[] {
    const out: CellAggregate[] = []
    for (const key of keys) {
      const agg = this.aggregates.get(key)
      if (agg) out.push(agg)
    }
    return out
  }

  get size() {
    return this.byId.size
  }

  get cellCount() {
    return this.cells.size
  }

  landmarks(): ParkingSpot[] {
    const out: ParkingSpot[] = []
    for (const s of this.byId.values()) {
      if (s.landmark) out.push(s)
    }
    return out
  }

  forEach(fn: (spot: ParkingSpot) => void) {
    for (const s of this.byId.values()) fn(s)
  }

  toArray(): ParkingSpot[] {
    return Array.from(this.byId.values())
  }
}

/** App-wide singleton — filled once at boot from local/mock data; later from API. */
export const parkingIndex = new ParkingSpatialIndex()
