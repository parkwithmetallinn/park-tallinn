export type SpotType = 'free' | 'timed' | 'pr' | 'paid'

export type SpotKind = 'lot' | 'street'

export interface ParkingSpot {
  id: string
  name: string
  type: SpotType
  kind: SpotKind
  badge: string
  timeLimit: string
  lat: number
  lng: number
  address: string
  desc: string
  hours?: string
  custom?: boolean
  /** Landmark lots appear slightly earlier than dense street pins. */
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

export type FilterId = 'all' | SpotType | 'street' | 'lot'
