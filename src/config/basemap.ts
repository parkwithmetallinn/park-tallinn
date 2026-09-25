/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BASEMAP — one-line swap for production Maa-amet tiles
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TEMPORARY: OpenFreeMap (OSM OpenMapTiles schema) — free, no API key.
 * PRODUCTION: replace VECTOR_TILE_SOURCE_URL (and optionally STYLE_URL)
 * with your Maa-amet / self-hosted vector tile endpoint.
 *
 * Examples for later:
 *   export const VECTOR_TILE_SOURCE_URL = 'https://tiles.example.ee/maaamet/v1'
 *   export const STYLE_URL = 'https://tiles.example.ee/styles/park-tallinn.json'
 *
 * If STYLE_URL is set, MapLibre loads that style wholesale.
 * If null, we build an inline style from VECTOR_TILE_SOURCE_URL (see createBasemapStyle).
 */

/** ← Change this one line when Maa-amet vector tiles are ready. */
export const VECTOR_TILE_SOURCE_URL = 'https://tiles.openfreemap.org/planet'

/**
 * Optional full style JSON URL. Keep null to use our inline Waze-like style
 * that reads VECTOR_TILE_SOURCE_URL above.
 */
export const STYLE_URL: string | null = null

export const VECTOR_TILE_ATTRIBUTION =
  '© OpenStreetMap · OpenFreeMap · (ajutine; asendub Maa-ameti vektorkaardiga)'

export const GLYPHS_URL =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
