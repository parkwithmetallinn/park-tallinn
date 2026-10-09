/**
 * Zoom LOD for Park Tallinn map overlays.
 *
 * Soft fade ranges live in `parkingFade.ts` (START ≈ END − 1.5…2).
 * These END values are the former hard cutoffs (fully visible).
 *
 *   zoom < lot fade start → district badges only
 *   lot fade end (13)+    → lot polygons fully opaque
 *   street fade end (12)+ → street curb lines (when enabled)
 *   detail fade end (15)+ → EV / timed pin detail
 */
export const ZOOM = {
  /** Hide pins & street detail below this; show district zones only. */
  districtMax: 13,
  /** @deprecated use lotMin */
  clusterMax: 13,
  /** Lot polygons fully visible from this zoom (fade ends here). */
  lotMin: 13,
  /**
   * Street parking curb lines (master street_side / lane features).
   * Product: fully visible from zoom 12.
   */
  streetMin: 12,
  /**
   * EV / timed pin detail (fully visible from 15).
   */
  detailMin: 15,
  landmarkMin: 13,
} as const
