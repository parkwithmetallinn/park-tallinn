/**
 * Zoom LOD for Park Tallinn map overlays.
 *
 *   zoom < 13  → district badges only (Vanalinn, Kesklinn, Mustamäe, …)
 *   13+        → lot polygons (parking_polygons.geojson)
 *   zoom ≥ 12  → street curb LineStrings (street_parking.geojson)
 */
export const ZOOM = {
  /** Hide pins & street detail below this; show district zones only. */
  districtMax: 13,
  /** @deprecated use lotMin */
  clusterMax: 13,
  /** Lot polygons appear from this zoom. */
  lotMin: 13,
  /**
   * Street parking curb lines (street_parking.geojson).
   * Product: visible from zoom 12.
   */
  streetMin: 12,
  /**
   * EV / timed pin detail (kept at 15 so street lines can appear earlier).
   */
  detailMin: 15,
  landmarkMin: 13,
} as const
