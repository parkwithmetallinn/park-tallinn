/** Haversine distance helpers */

import { getDistanceUnits, type DistanceUnits } from './appSettings'

export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatDistance(
  meters: number,
  units?: DistanceUnits,
): string {
  const u = units ?? getDistanceUnits()
  if (u === 'imperial') {
    const miles = meters / 1609.344
    if (miles < 0.1) {
      const feet = Math.round(meters * 3.28084)
      return `${feet} ft`
    }
    return `${miles.toFixed(1)} mi`
  }
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
