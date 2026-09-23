/** Zoom thresholds for progressive map detail. */
export const ZOOM = {
  /** Below this: district polygons + paid zones only (city overview). */
  districtMax: 13.2,
  /** Clusters visible until this zoom. */
  clusterMax: 15,
  /** Individual pins & street corridors appear from this zoom (street / quarter level). */
  streetMin: 15,
  /** Landmark lots (P&R, big free lots) can appear slightly earlier. */
  landmarkMin: 14.2,
} as const
