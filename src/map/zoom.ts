/** Zoom thresholds for progressive map detail. */
export const ZOOM = {
  districtMax: 13.2,
  clusterMax: 14.2,
  /** Road-snapped curb lines & lot polygons appear from here. */
  streetMin: 14,
  landmarkMin: 13.5,
} as const
