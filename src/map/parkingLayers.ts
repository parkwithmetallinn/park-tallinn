import type { ParkingProvider } from '../types'

export const PARKING_LAYER_META: Record<
  ParkingProvider,
  { id: string; label: string; color: string; circleRadius: number }
> = {
  europark: {
    id: 'parking-europark',
    label: 'EuroPark',
    color: '#1D4ED8',
    circleRadius: 7,
  },
  snabb: {
    id: 'parking-snabb',
    label: 'Snabb',
    color: '#EA580C',
    circleRadius: 7,
  },
  free_street: {
    id: 'parking-free-street',
    label: 'Tasuta tänav',
    color: '#0B6E4F',
    circleRadius: 5.5,
  },
  timed: {
    id: 'parking-timed',
    label: 'Kellaga / ajapiirang',
    color: '#0E7490',
    circleRadius: 6,
  },
  park_ride: {
    id: 'parking-park-ride',
    label: 'Pargi & Reisi',
    color: '#1D4E89',
    circleRadius: 8,
  },
  municipal: {
    id: 'parking-municipal',
    label: 'Avalik / munitsipaal',
    color: '#15803D',
    circleRadius: 7,
  },
}

export const PARKING_PROVIDERS = Object.keys(PARKING_LAYER_META) as ParkingProvider[]

/** Single viewport GeoJSON source; layers filter by `provider`. */
export const PARKING_VIEWPORT_SOURCE = 'parking-viewport'

export const GRID_DEBUG_SOURCE = 'grid-debug'
