import type { ParkingSpot } from '../types'
import { parkingIndex } from './spatialIndex'
import { cellsCoveringBounds, type LngLatBoundsLike } from './grid'
import { ZOOM } from '../map/zoom'

export type ViewportQueryResult = {
  spots: ParkingSpot[]
  cellKeys: string[]
  /** True when zoom is too low — individual spots must not be rendered. */
  skippedForZoom: boolean
  /** True when bounds cover too many cells — refuse to load all points. */
  skippedForExtent: boolean
}

/**
 * Spatial query API used by the map.
 * Today: local grid index. Tomorrow: `fetch(/api/parking?cells=...)`.
 */
export async function queryParkingInViewport(
  bounds: LngLatBoundsLike,
  zoom: number,
): Promise<ViewportQueryResult> {
  if (zoom < ZOOM.streetMin) {
    return { spots: [], cellKeys: [], skippedForZoom: true, skippedForExtent: false }
  }

  const cellKeys = cellsCoveringBounds(bounds, {
    maxCells: 350,
    padMeters: 50,
  })

  if (cellKeys.length === 0) {
    return { spots: [], cellKeys: [], skippedForZoom: false, skippedForExtent: true }
  }

  // Local index today — replace body with network call when backend exists:
  // const res = await fetch(`/api/v1/parking/cells?keys=${cellKeys.join(',')}`)
  // const spots = await res.json()
  const spots = parkingIndex.queryCells(cellKeys)

  return {
    spots,
    cellKeys,
    skippedForZoom: false,
    skippedForExtent: false,
  }
}
