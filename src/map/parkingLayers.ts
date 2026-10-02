import type { ParkingLayerKey } from '../types'

/** Soft, Apple-like palette for parking layers (readable on light 3D basemap). */
export const PARKING_LAYER_META: Record<
  ParkingLayerKey,
  { id: string; label: string; color: string; circleRadius: number }
> = {
  municipal: {
    id: 'parking-municipal',
    label: 'Avalik / munitsipaal',
    // Paid municipal → red; unclassified features override to gray via feature color
    color: '#FF0000',
    circleRadius: 7,
  },
  europark: {
    id: 'parking-europark',
    label: 'EuroPark',
    color: '#FF0000',
    circleRadius: 7,
  },
  snabb: {
    id: 'parking-snabb',
    label: 'Snabb',
    color: '#FF0000',
    circleRadius: 7,
  },
  citypark: {
    id: 'parking-citypark',
    label: 'Citypark',
    color: '#FF0000',
    circleRadius: 7,
  },
  uhisteenused: {
    id: 'parking-uhisteenused',
    label: 'Ühisteenused',
    color: '#FF0000',
    circleRadius: 7,
  },
  parkit: {
    id: 'parking-parkit',
    label: 'Parkit',
    color: '#FF0000',
    circleRadius: 7,
  },
  timed: {
    id: 'parking-timed',
    label: 'Kellaga / ajapiirang',
    color: '#FFCC00',
    circleRadius: 6,
  },
  free_street: {
    id: 'parking-free-street',
    label: 'Tasuta tänav',
    color: '#00FF00',
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
    color: '#FF0000',
    circleRadius: 6.5,
  },
  park_ride: {
    id: 'parking-park-ride',
    label: 'Pargi & Reisi',
    color: '#FF0000',
    circleRadius: 8,
  },
}

export const PARKING_PROVIDERS = Object.keys(PARKING_LAYER_META) as ParkingLayerKey[]

/** Single viewport GeoJSON source; layers filter by `layer` / `provider`. */
export const PARKING_VIEWPORT_SOURCE = 'parking-viewport'
