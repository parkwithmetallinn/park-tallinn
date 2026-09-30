import type { ParkingLayerKey } from '../types'

/** Soft, Apple-like palette for parking layers (readable on light 3D basemap). */
export const PARKING_LAYER_META: Record<
  ParkingLayerKey,
  { id: string; label: string; color: string; circleRadius: number }
> = {
  municipal: {
    id: 'parking-municipal',
    label: 'Avalik / munitsipaal',
    // Not free-green — paid/unknown public lots use slate (feature color may override)
    color: '#64748B',
    circleRadius: 7,
  },
  europark: {
    id: 'parking-europark',
    label: 'EuroPark',
    color: '#0A84FF',
    circleRadius: 7,
  },
  snabb: {
    id: 'parking-snabb',
    label: 'Snabb',
    color: '#FF9F0A',
    circleRadius: 7,
  },
  citypark: {
    id: 'parking-citypark',
    label: 'Citypark',
    color: '#BF5AF2',
    circleRadius: 7,
  },
  uhisteenused: {
    id: 'parking-uhisteenused',
    label: 'Ühisteenused',
    color: '#64D2FF',
    circleRadius: 7,
  },
  parkit: {
    id: 'parking-parkit',
    label: 'Parkit',
    color: '#FF375F',
    circleRadius: 7,
  },
  timed: {
    id: 'parking-timed',
    label: 'Kellaga / ajapiirang',
    color: '#FFD60A',
    circleRadius: 6,
  },
  free_street: {
    id: 'parking-free-street',
    label: 'Tasuta tänav',
    // Strict verified-free green — do not reuse for municipal/unknown
    color: '#22C55E',
    circleRadius: 5.5,
  },
  ev: {
    id: 'parking-ev',
    label: 'Elektrilaadija',
    color: '#14B8A6',
    circleRadius: 7.5,
  },
  inva: {
    id: 'parking-inva',
    label: 'Inva-koht',
    color: '#0A84FF',
    circleRadius: 7,
  },
  loading: {
    id: 'parking-loading',
    label: 'Kauba laadimine',
    color: '#FF9F0A',
    circleRadius: 6.5,
  },
  park_ride: {
    id: 'parking-park-ride',
    label: 'Pargi & Reisi',
    color: '#5E5CE6',
    circleRadius: 8,
  },
}

export const PARKING_PROVIDERS = Object.keys(PARKING_LAYER_META) as ParkingLayerKey[]

/** Single viewport GeoJSON source; layers filter by `layer` / `provider`. */
export const PARKING_VIEWPORT_SOURCE = 'parking-viewport'
