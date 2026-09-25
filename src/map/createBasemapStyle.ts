import type { StyleSpecification } from 'maplibre-gl'
import {
  GLYPHS_URL,
  STYLE_URL,
  VECTOR_TILE_ATTRIBUTION,
  VECTOR_TILE_SOURCE_URL,
} from '../config/basemap'

const BG = '#F1F5F9'
const BUILDING = '#E2E8F0'
const ROAD = '#FFFFFF'
const ROAD_CASE = '#CBD5E1'
const WATER = '#93C5FD'

/**
 * Returns MapLibre style: either remote STYLE_URL or inline style
 * built from VECTOR_TILE_SOURCE_URL (swap that constant for Maa-amet).
 */
export function createBasemapStyle(): string | StyleSpecification {
  if (STYLE_URL) return STYLE_URL

  return {
    version: 8,
    name: 'Park Tallinn basemap (temporary OSM)',
    glyphs: GLYPHS_URL,
    sources: {
      openmaptiles: {
        type: 'vector',
        url: VECTOR_TILE_SOURCE_URL,
        attribution: VECTOR_TILE_ATTRIBUTION,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': BG } },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': WATER },
      },
      {
        id: 'landcover-soft',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#E8EEF3', 'fill-opacity': 0.4 },
      },
      {
        id: 'road-case',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: [
          'all',
          ['!=', ['get', 'class'], 'rail'],
          ['!=', ['get', 'class'], 'transit'],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROAD_CASE,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            2.5,
            14,
            10,
            16,
            18,
          ],
        },
      },
      {
        id: 'road',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: [
          'all',
          ['!=', ['get', 'class'], 'rail'],
          ['!=', ['get', 'class'], 'transit'],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROAD,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            1.2,
            14,
            6,
            16,
            12,
          ],
        },
      },
      {
        id: 'building-flat',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        maxzoom: 14,
        paint: {
          'fill-color': BUILDING,
          'fill-opacity': 0.95,
          'fill-outline-color': ROAD_CASE,
        },
      },
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': BUILDING,
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            0,
            14,
            ['coalesce', ['to-number', ['get', 'render_height']], 14],
          ],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9,
        },
      },
    ],
  }
}
