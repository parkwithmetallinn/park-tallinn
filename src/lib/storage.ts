import { normalizeSpot } from './geojson'
import type { ParkingSpot } from '../types'

const STORAGE_KEY = 'park_tallinn_custom_spots'

export function loadCustomSpots(): ParkingSpot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ParkingSpot[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((s) => normalizeSpot(s))
  } catch {
    return []
  }
}

export function saveCustomSpot(spot: ParkingSpot): void {
  const existing = loadCustomSpots()
  existing.push(normalizeSpot(spot))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
}
