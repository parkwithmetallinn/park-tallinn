import type { ParkingLayerKey } from '../types'

export const PARKING_LAYER_META: Record<
  ParkingLayerKey,
  { id: string; label: string; color: string; circleRadius: number }
> = {
  municipal: {
    id: 'parking-municipal',
    label: 'Avalik / munitsipaal',
    color: '#15803D',
    circleRadius: 7,
  },
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
  citypark: {
    id: 'parking-citypark',
    label: 'Citypark',
    color: '#7C3AED',
    circleRadius: 7,
  },
  uhisteenused: {
    id: 'parking-uhisteenused',
    label: 'Ühisteenused',
    color: '#0F766E',
    circleRadius: 7,
  },
  parkit: {
    id: 'parking-parkit',
    label: 'Parkit',
    color: '#BE185D',
    circleRadius: 7,
  },
  timed: {
    id: 'parking-timed',
    label: 'Kellaga / ajapiirang',
    color: '#EAB308',
    circleRadius: 6,
  },
  free_street: {
    id: 'parking-free-street',
    label: 'Tasuta tänav',
    color: '#16A34A',
    circleRadius: 5.5,
  },
  ev: {
    id: 'parking-ev',
    label: 'Elektrilaadija',
    color: '#059669',
    circleRadius: 7.5,
  },
  inva: {
    id: 'parking-inva',
    label: 'Inva-koht',
    color: '#2563EB',
    circleRadius: 7,
  },
  loading: {
    id: 'parking-loading',
    label: 'Kauba laadimine',
    color: '#B45309',
    circleRadius: 6.5,
  },
  park_ride: {
    id: 'parking-park-ride',
    label: 'Pargi & Reisi',
    color: '#1D4E89',
    circleRadius: 8,
  },
}

export const PARKING_PROVIDERS = Object.keys(PARKING_LAYER_META) as ParkingLayerKey[]

/** Single viewport GeoJSON source; layers filter by `layer` / `provider`. */
export const PARKING_VIEWPORT_SOURCE = 'parking-viewport'
