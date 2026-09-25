export type SpotType = 'free' | 'timed' | 'pr' | 'paid'

export type SpotKind = 'lot' | 'street'

/**
 * Provider / product layer — each maps to its own MapLibre layer filter.
 * Ready for EuroPark / Snabb API feeds later.
 */
export type ParkingProvider =
  | 'europark'
  | 'snabb'
  | 'free_street'
  | 'timed'
  | 'park_ride'
  | 'municipal'

export interface ParkingSpot {
  id: string
  name: string
  type: SpotType
  kind: SpotKind
  provider: ParkingProvider
  badge: string
  timeLimit: string
  lat: number
  lng: number
  address: string
  desc: string
  hours?: string
  custom?: boolean
  /** Landmark lots appear slightly earlier / used for nearest banner. */
  landmark?: boolean
}

export interface PaidZone {
  name: string
  color: string
  coords: [number, number][]
  note: string
}

export interface DistrictZone {
  id: string
  name: string
  color: string
  kind: 'free' | 'mixed' | 'paid'
  summary: string
  /** [lat, lng] rings */
  coords: [number, number][]
}

export type FilterId =
  | 'all'
  | SpotType
  | 'street'
  | 'lot'
  | ParkingProvider
