/**
 * Zoom-based opacity fade for parking overlays (MapLibre expressions + JS helper).
 *
 * Former hard `minzoom` cutoffs are the END of each fade (fully visible).
 * Layers mount ~1.5–2 zooms earlier at opacity 0 so data is warm before visible.
 */

import { ZOOM } from './zoom'

/** Lot polygons: fully invisible → fully visible. */
export const PARKING_FADE_START_ZOOM = ZOOM.lotMin - 1.8
export const PARKING_FADE_END_ZOOM = ZOOM.lotMin

/** Street curb lines (if enabled). */
export const STREET_FADE_START_ZOOM = ZOOM.streetMin - 1.5
export const STREET_FADE_END_ZOOM = ZOOM.streetMin

/** Detail pins / lot name badges. */
export const DETAIL_FADE_START_ZOOM = ZOOM.detailMin - 1.5
export const DETAIL_FADE_END_ZOOM = ZOOM.detailMin

/** Below this opacity, parking geometry must not receive clicks / hover. */
export const PARKING_INTERACTIVE_OPACITY = 0.15

/** Ease approximating smoothstep for MapLibre zoom interpolation. */
const FADE_EASING = ['cubic-bezier', 0.42, 0, 0.58, 1] as const

export type FadeRange = {
  start: number
  end: number
}

export const PARKING_FADE: FadeRange = {
  start: PARKING_FADE_START_ZOOM,
  end: PARKING_FADE_END_ZOOM,
}

export const STREET_FADE: FadeRange = {
  start: STREET_FADE_START_ZOOM,
  end: STREET_FADE_END_ZOOM,
}

export const DETAIL_FADE: FadeRange = {
  start: DETAIL_FADE_START_ZOOM,
  end: DETAIL_FADE_END_ZOOM,
}

/** Smoothstep clamp — matches the cubic-bezier fade curve used in paint. */
export function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Normalized parking opacity for the given zoom (0..1).
 * Defaults to the lot-polygon fade range.
 */
export function getParkingOpacity(
  zoom: number,
  range: FadeRange = PARKING_FADE,
): number {
  if (range.end <= range.start) return zoom >= range.end ? 1 : 0
  return smoothstep01((zoom - range.start) / (range.end - range.start))
}

export function isParkingInteractiveAtZoom(
  zoom: number,
  range: FadeRange = PARKING_FADE,
): boolean {
  return getParkingOpacity(zoom, range) >= PARKING_INTERACTIVE_OPACITY
}

/**
 * MapLibre paint expression: zoom → 0..maxOpacity with eased curve.
 */
export function fadeOpacityExpr(
  maxOpacity: number,
  range: FadeRange = PARKING_FADE,
): unknown[] {
  return [
    'interpolate',
    FADE_EASING,
    ['zoom'],
    range.start,
    0,
    range.end,
    maxOpacity,
  ]
}

/**
 * Fade non-selected features; selected / route target stay at full max opacity.
 *
 * MapLibre requires `['zoom']` only as the input of a *top-level* interpolate/step,
 * so selection is encoded in the stop values (not wrapping the interpolate in `case`).
 */
export function fadeOpacityKeepSelected(
  maxNormal: number,
  maxSelected: number = maxNormal,
  range: FadeRange = PARKING_FADE,
): unknown[] {
  const selected = ['boolean', ['feature-state', 'selected'], false] as const
  return [
    'interpolate',
    FADE_EASING,
    ['zoom'],
    range.start,
    ['case', selected, maxSelected, 0],
    range.end,
    ['case', selected, maxSelected, maxNormal],
  ]
}

/** Zero paint transitions so zoom expressions track pinch/scroll continuously. */
export const NO_OPACITY_TRANSITION = { duration: 0, delay: 0 } as const
