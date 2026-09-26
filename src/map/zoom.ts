/**
 * Zoom LOD for Park Tallinn map overlays.
 *
 *   zoom < 13  → district badges only (Vanalinn, Kesklinn, Mustamäe, …)
 *   13–15      → main lot polygons (EuroPark, Snabb, Citypark)
 *   zoom ≥ 15  → EV / INVA / timed pins (+15m/+30m); curb lines when snapped
 */
export const ZOOM = {
  /** Hide pins & street detail below this; show district zones only. */
  districtMax: 13,
  /** @deprecated use lotMin */
  clusterMax: 13,
  /** Lot polygons appear from this zoom. */
  lotMin: 13,
  /** Pins, timed clocks, EV chargers (and future curb lines) from this zoom. */
  detailMin: 15,
  /** @deprecated use detailMin */
  streetMin: 15,
  landmarkMin: 13,
} as const
