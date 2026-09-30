import {
  PARKING_COLOR_FREE,
  PARKING_COLOR_UNKNOWN,
} from '../lib/parkingClassification'
import type { ParkingLayerKey, ParkingSpot } from '../types'
import { PARKING_LAYER_META } from './parkingLayers'

/**
 * Curb / pin colors — green (#22C55E) only for verified free_street.
 * Zero price alone is NOT enough (unknown lots stay muted gray).
 */
export function streetLineColor(spot: ParkingSpot): string {
  if (spot.layer === 'free_street' || spot.zone_code === 'FREE') {
    return PARKING_COLOR_FREE
  }
  if (spot.layer === 'timed' || spot.featureType === 'on-street-line') {
    if (spot.free_minutes > 0 && spot.free_minutes <= 30) return '#FFD60A'
    if (spot.free_minutes > 30 && spot.free_minutes <= 60) return '#FF9F0A'
    if (spot.zone_code === 'VANALINN') return '#FF6961'
    if (spot.zone_code === 'SÜDALINN') return '#FF9F0A'
    if (spot.zone_code === 'KESKLINN') return '#64D2FF'
    if (spot.zone_code === 'PIRITA') return '#5AC8FA'
    if (spot.zone_code === 'ZONE' || spot.zone_code === 'UNK' || spot.zone_code === 'AVALIK') {
      return PARKING_COLOR_UNKNOWN
    }
    return '#FFD60A'
  }
  if (spot.layer === 'municipal') {
    if (spot.zone_code === 'VANALINN') return '#FF6961'
    if (spot.zone_code === 'SÜDALINN') return '#FF9F0A'
    if (spot.zone_code === 'KESKLINN') return '#64D2FF'
    if (spot.zone_code === 'PIRITA') return '#5AC8FA'
    // Unclassified / generic ZONE — muted gray, never free-green
    return PARKING_COLOR_UNKNOWN
  }
  return PARKING_LAYER_META[spot.layer]?.color ?? PARKING_COLOR_UNKNOWN
}

export function lotFillColor(layer: ParkingLayerKey): string {
  if (layer === 'free_street') return PARKING_COLOR_FREE
  if (layer === 'municipal') return PARKING_COLOR_UNKNOWN
  return PARKING_LAYER_META[layer]?.color ?? PARKING_COLOR_UNKNOWN
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
