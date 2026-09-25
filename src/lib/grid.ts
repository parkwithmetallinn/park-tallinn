/**
 * 100×100 m spatial grid in Web Mercator (EPSG:3857 metres).
 * Cell keys are stable across Tallinn / Pärnu / Narva / all of Estonia.
 */

export const GRID_CELL_SIZE_M = 100

const EARTH_RADIUS = 6378137 // Web Mercator sphere

export type GridCell = { ix: number; iy: number }

export type LngLatBoundsLike = {
  west: number
  south: number
  east: number
  north: number
}

export function latLngToMercator(lat: number, lng: number): { x: number; y: number } {
  const λ = (lng * Math.PI) / 180
  const φ = (lat * Math.PI) / 180
  return {
    x: EARTH_RADIUS * λ,
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + φ / 2)),
  }
}

export function mercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI)
  const lat =
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI)
  return { lat, lng }
}

export function latLngToCell(lat: number, lng: number): GridCell {
  const { x, y } = latLngToMercator(lat, lng)
  return {
    ix: Math.floor(x / GRID_CELL_SIZE_M),
    iy: Math.floor(y / GRID_CELL_SIZE_M),
  }
}

export function cellKey(cell: GridCell): string {
  return `${cell.ix}:${cell.iy}`
}

export function parseCellKey(key: string): GridCell {
  const [ix, iy] = key.split(':').map(Number)
  return { ix, iy }
}

/** Polygon ring [lng, lat][] for a cell (for debug / viz). */
export function cellToPolygon(cell: GridCell): [number, number][] {
  const x0 = cell.ix * GRID_CELL_SIZE_M
  const y0 = cell.iy * GRID_CELL_SIZE_M
  const x1 = x0 + GRID_CELL_SIZE_M
  const y1 = y0 + GRID_CELL_SIZE_M
  const sw = mercatorToLatLng(x0, y0)
  const se = mercatorToLatLng(x1, y0)
  const ne = mercatorToLatLng(x1, y1)
  const nw = mercatorToLatLng(x0, y1)
  return [
    [sw.lng, sw.lat],
    [se.lng, se.lat],
    [ne.lng, ne.lat],
    [nw.lng, nw.lat],
    [sw.lng, sw.lat],
  ]
}

/**
 * All 100×100 m cells that intersect a geographic bounding box.
 * Caps cell count as a safety valve for extreme zooms-out.
 */
export function cellsCoveringBounds(
  bounds: LngLatBoundsLike,
  options?: { maxCells?: number; padMeters?: number },
): string[] {
  const maxCells = options?.maxCells ?? 400
  const pad = options?.padMeters ?? GRID_CELL_SIZE_M * 0.5

  const sw = latLngToMercator(bounds.south, bounds.west)
  const ne = latLngToMercator(bounds.north, bounds.east)

  const minX = Math.min(sw.x, ne.x) - pad
  const maxX = Math.max(sw.x, ne.x) + pad
  const minY = Math.min(sw.y, ne.y) - pad
  const maxY = Math.max(sw.y, ne.y) + pad

  const ix0 = Math.floor(minX / GRID_CELL_SIZE_M)
  const ix1 = Math.floor(maxX / GRID_CELL_SIZE_M)
  const iy0 = Math.floor(minY / GRID_CELL_SIZE_M)
  const iy1 = Math.floor(maxY / GRID_CELL_SIZE_M)

  const width = ix1 - ix0 + 1
  const height = iy1 - iy0 + 1
  if (width * height > maxCells) {
    // Too many cells (zoomed out) — caller should not load individual spots
    return []
  }

  const keys: string[] = []
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      keys.push(cellKey({ ix, iy }))
    }
  }
  return keys
}
