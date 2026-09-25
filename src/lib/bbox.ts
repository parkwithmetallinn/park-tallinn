export type LngLatBoundsLike = {
  west: number
  south: number
  east: number
  north: number
}

/** Expand bbox by ~meters at mid-latitude (good enough for viewport padding). */
export function padBounds(
  bounds: LngLatBoundsLike,
  padMeters: number,
): LngLatBoundsLike {
  const midLat = (bounds.south + bounds.north) / 2
  const dLat = padMeters / 111_320
  const dLng = padMeters / (111_320 * Math.cos((midLat * Math.PI) / 180))
  return {
    west: bounds.west - dLng,
    south: bounds.south - dLat,
    east: bounds.east + dLng,
    north: bounds.north + dLat,
  }
}

export function boundsAreaDeg2(b: LngLatBoundsLike): number {
  return Math.max(0, b.east - b.west) * Math.max(0, b.north - b.south)
}
