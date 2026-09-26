import type { ParkingSpot } from '../types'
import { parkingIndex } from './spatialIndex'
import { padBounds, type LngLatBoundsLike } from './bbox'
import { isLotPolygonFeature } from './geojson'
import { ZOOM } from '../map/zoom'

export type ViewportQueryResult = {
  spots: ParkingSpot[]
  /** True when zoom is too low — show district aggregates only. */
  skippedForZoom: boolean
  /** True when viewport is huge — refuse to dump entire country into GPU. */
  skippedForExtent: boolean
  /** LOD band for the current zoom. */
  lod: 'district' | 'lots' | 'detail'
}

/** ~0.08° ≈ several km — above this at street zoom we still skip point dump. */
const MAX_VIEWPORT_AREA_DEG2 = 0.04

function lodForZoom(zoom: number): ViewportQueryResult['lod'] {
  if (zoom < ZOOM.lotMin) return 'district'
  if (zoom < ZOOM.detailMin) return 'lots'
  return 'detail'
}

/**
 * Viewport bounding-box parking query.
 * Today: in-memory index. Tomorrow:
 *   GET /api/v1/parking?west=&south=&east=&north=&zoom=
 */
export async function queryParkingInViewport(
  bounds: LngLatBoundsLike,
  zoom: number,
): Promise<ViewportQueryResult> {
  const lod = lodForZoom(zoom)

  if (lod === 'district') {
    return { spots: [], skippedForZoom: true, skippedForExtent: false, lod }
  }

  const padded = padBounds(bounds, 80)
  const area = (padded.east - padded.west) * (padded.north - padded.south)
  if (area > MAX_VIEWPORT_AREA_DEG2) {
    return { spots: [], skippedForZoom: false, skippedForExtent: true, lod }
  }

  // Local today — swap for network:
  // const q = new URLSearchParams({ west, south, east, north, zoom: String(zoom) })
  // const spots = await fetch(`/api/v1/parking?${q}`).then(r => r.json())
  let spots = parkingIndex.queryBounds(padded)

  // Zone view (13–15): lots only — hide street lines, EV, INVA, loading pins
  if (lod === 'lots') {
    spots = spots.filter((s) => isLotPolygonFeature(s))
  }

  return {
    spots,
    skippedForZoom: false,
    skippedForExtent: false,
    lod,
  }
}
