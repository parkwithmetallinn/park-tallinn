import type { ParkingSpot } from '../types'

const STORAGE_KEY = 'park_tallinn_custom_spots'

export function loadCustomSpots(): ParkingSpot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ParkingSpot[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCustomSpot(spot: ParkingSpot): void {
  const existing = loadCustomSpots()
  existing.push(spot)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
}
