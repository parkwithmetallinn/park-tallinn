import {
  categoryPaintColor,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
  PARKING_COLOR_UNKNOWN,
} from '../lib/parkingClassification'
import type { ParkingLayerKey, ParkingSpot } from '../types'

/**
 * Strict category colors for curb lines / pins:
 * Green = unlimited free · Yellow = clock · Red = paid · Gray = other.
 * Operator brand colors are intentionally NOT used on the map.
 */
export function streetLineColor(spot: ParkingSpot): string {
  return categoryPaintColor({
    layer: spot.layer,
    type: spot.type,
    free_minutes: spot.free_minutes,
    price_per_hour: spot.price_per_hour,
    verified_free: spot.layer === 'free_street',
    zone_code: spot.zone_code,
  })
}

/** Layer-only fill color when feature props are not available. */
export function lotFillColor(layer: ParkingLayerKey): string {
  if (layer === 'free_street') return PARKING_COLOR_FREE
  if (layer === 'timed') return PARKING_COLOR_TIMED
  if (
    layer === 'europark' ||
    layer === 'snabb' ||
    layer === 'citypark' ||
    layer === 'uhisteenused' ||
    layer === 'parkit' ||
    layer === 'park_ride' ||
    layer === 'loading' ||
    layer === 'municipal'
  ) {
    // Municipal without spot-level props is treated as paid (red), not gray
    return PARKING_COLOR_PAID
  }
  return PARKING_COLOR_UNKNOWN
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
