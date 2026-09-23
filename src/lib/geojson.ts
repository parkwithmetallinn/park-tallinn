import type { DistrictZone, ParkingSpot, SpotType } from '../types'

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

export function spotsToGeoJSON(spots: ParkingSpot[]) {
  return {
    type: 'FeatureCollection' as const,
    features: spots.map((s) => ({
      type: 'Feature' as const,
      properties: {
        id: s.id,
        name: s.name,
        type: s.type as SpotType,
        kind: s.kind,
        badge: s.badge,
        timeLimit: s.timeLimit,
        address: s.address,
        desc: s.desc,
        landmark: s.landmark ? 1 : 0,
        color:
          s.type === 'free'
            ? '#0B6E4F'
            : s.type === 'timed'
              ? '#0E7490'
              : s.type === 'pr'
                ? '#1D4E89'
                : '#C45C26',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [s.lng, s.lat] as [number, number],
      },
    })),
  }
}
