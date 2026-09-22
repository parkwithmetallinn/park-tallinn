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
}

export interface PaidZone {
  name: string
  color: string
  coords: [number, number][]
  note: string
}

export type FilterId = 'all' | SpotType | 'street' | 'lot'
