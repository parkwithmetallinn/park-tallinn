/**
 * Zoom LOD for Park Tallinn map overlays.
 *
 *   zoom < 13  → district badges only (Vanalinn, Kesklinn, Mustamäe, …)
 *   13–15      → main lot polygons (EuroPark, Snabb, Citypark)
 *   zoom ≥ 15  → street curb LineStrings (street_parking.geojson) + EV / timed pins
 */
export const ZOOM = {
  /** Hide pins & street detail below this; show district zones only. */
  districtMax: 13,
  /** @deprecated use lotMin */
  clusterMax: 13,
  /** Lot polygons appear from this zoom. */
  lotMin: 13,
  /**
   * Street parking lines, EV, timed pins.
   * Lines use minzoom 15 and fade opacity 15→16.
   */
  detailMin: 15,
  /** @deprecated use detailMin */
  streetMin: 15,
  landmarkMin: 13,
} as const
