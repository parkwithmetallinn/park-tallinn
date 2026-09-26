/** Zoom thresholds for progressive map detail (LOD). */
export const ZOOM = {
  /**
   * City macro view: zoom < lotMin.
   * Show ONLY district badges/zones (Vanalinn, Kesklinn, …).
   */
  districtMax: 13,
  /** @deprecated alias — use lotMin for zone-view start */
  clusterMax: 13,
  /**
   * Zone view: zoom ≥ lotMin and < detailMin.
   * Main parking lot polygons (EuroPark, Snabb, Citypark) + labels.
   */
  lotMin: 13,
  /**
   * Detail view: zoom ≥ detailMin.
   * Street curb lines, timed clocks, EV chargers, INVA pins.
   */
  detailMin: 15,
  /**
   * @deprecated use detailMin — kept so older call sites keep compiling.
   * Road-snapped curb lines & POI pins appear from here.
   */
  streetMin: 15,
  landmarkMin: 13,
} as const
