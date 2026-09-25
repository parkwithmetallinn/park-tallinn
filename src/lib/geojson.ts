import type { ParkingProvider, ParkingSpot, SpotType } from '../types'

export function inferProvider(spot: Omit<ParkingSpot, 'provider'> & { provider?: ParkingProvider }): ParkingProvider {
  if (spot.provider) return spot.provider
  if (spot.type === 'pr') return 'park_ride'
  if (spot.type === 'timed') return 'timed'
  if (spot.kind === 'street' && spot.type === 'free') return 'free_street'
  if (spot.kind === 'lot') return 'municipal'
  return 'municipal'
}

export function withProvider(spot: Omit<ParkingSpot, 'provider'> & { provider?: ParkingProvider }): ParkingSpot {
  return { ...spot, provider: inferProvider(spot) }
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
        provider: s.provider,
        badge: s.badge,
        timeLimit: s.timeLimit,
        address: s.address,
        desc: s.desc,
        landmark: s.landmark ? 1 : 0,
        color: providerColor(s.provider),
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [s.lng, s.lat] as [number, number],
      },
    })),
  }
}

export function providerColor(provider: ParkingProvider): string {
  switch (provider) {
    case 'europark':
      return '#1D4ED8'
    case 'snabb':
      return '#EA580C'
    case 'free_street':
      return '#0B6E4F'
    case 'timed':
      return '#0E7490'
    case 'park_ride':
      return '#1D4E89'
    case 'municipal':
      return '#15803D'
    default:
      return '#64748B'
  }
}

// re-export point-in-polygon helpers used elsewhere
export { countSpotsInDistrict, pointInPolygon } from './geojsonPolygons'
