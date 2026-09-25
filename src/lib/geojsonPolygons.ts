import type { DistrictZone, ParkingSpot } from '../types'

/** Ray-casting point-in-polygon. Ring is [lat, lng][]. */
export function pointInPolygon(
  lat: number,
  lng: number,
  ring: [number, number][],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function countSpotsInDistrict(
  spots: ParkingSpot[],
  district: DistrictZone,
): { total: number; free: number; timed: number; pr: number } {
  let free = 0
  let timed = 0
  let pr = 0
  let total = 0
  for (const s of spots) {
    if (!pointInPolygon(s.lat, s.lng, district.coords)) continue
    total++
    if (s.type === 'free') free++
    else if (s.type === 'timed') timed++
    else if (s.type === 'pr') pr++
  }
  return { total, free, timed, pr }
}
