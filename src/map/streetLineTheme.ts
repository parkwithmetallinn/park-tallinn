import type { ParkingLayerKey, ParkingSpot } from '../types'
import { PARKING_LAYER_META } from './parkingLayers'

/**
 * Soft Apple Maps–style curb colors — muted, readable on light basemap.
 */
export function streetLineColor(spot: ParkingSpot): string {
  if (spot.layer === 'free_street' || (spot.price_per_hour === 0 && spot.free_minutes === 0)) {
    return '#34C759'
  }
  if (spot.layer === 'timed' || spot.featureType === 'on-street-line') {
    if (spot.free_minutes > 0 && spot.free_minutes <= 30) return '#FFD60A'
    if (spot.free_minutes > 30 && spot.free_minutes <= 60) return '#FF9F0A'
    if (spot.zone_code === 'VANALINN') return '#FF6961'
    if (spot.zone_code === 'SÜDALINN') return '#FF9F0A'
    if (spot.zone_code === 'KESKLINN') return '#64D2FF'
    if (spot.zone_code === 'PIRITA') return '#5AC8FA'
    return '#FFD60A'
  }
  if (spot.layer === 'municipal') {
    if (spot.zone_code === 'VANALINN') return '#FF6961'
    if (spot.zone_code === 'SÜDALINN') return '#FF9F0A'
    if (spot.zone_code === 'KESKLINN') return '#64D2FF'
    if (spot.zone_code === 'PIRITA') return '#5AC8FA'
    return '#30D158'
  }
  return PARKING_LAYER_META[spot.layer]?.color ?? '#8E8E93'
}

export function lotFillColor(layer: ParkingLayerKey): string {
  return PARKING_LAYER_META[layer]?.color ?? '#8E8E93'
}

/** MapLibre source ids for geometry-aware parking overlays */
export const PARKING_LINES_SOURCE = 'parking-street-lines'
export const PARKING_LOTS_SOURCE = 'parking-lot-polygons'
export const PARKING_LINES_LAYER = 'parking-street-lines'
export const PARKING_LINES_CASING_LAYER = 'parking-street-lines-casing'
export const PARKING_LINES_GLOW_LAYER = 'parking-street-lines-glow'
export const PARKING_LOTS_FILL_LAYER = 'parking-lots-fill'
export const PARKING_LOTS_OUTLINE_LAYER = 'parking-lots-outline'
export const PARKING_LOTS_LABEL_LAYER = 'parking-lots-label'
