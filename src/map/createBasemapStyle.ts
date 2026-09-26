import type { StyleSpecification } from 'maplibre-gl'
import {
  GLYPHS_URL,
  STYLE_URL,
  VECTOR_TILE_ATTRIBUTION,
  VECTOR_TILE_SOURCE_URL,
} from '../config/basemap'

const BG = '#F2F4F7'
/** Soft Apple Maps–like building mass */
const BUILDING = '#E8E8E8'
const BUILDING_EDGE = '#D8D8D8'
const ROAD = '#FFFFFF'
const ROAD_CASE = '#D5D9E0'
const WATER = '#A8C8F0'

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
    // Soft ambient lighting — reduces harsh extrusion shadows
    light: {
      anchor: 'viewport',
      color: '#ffffff',
      intensity: 0.28,
      position: [1.2, 210, 35],
    },
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
        paint: { 'fill-color': WATER, 'fill-opacity': 0.85 },
      },
      {
        id: 'landcover-soft',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#E6EDF2', 'fill-opacity': 0.35 },
      },
      {
        id: 'road-case',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: [
          'match',
          ['get', 'class'],
          [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'minor',
            'service',
            'street',
            'street_limited',
          ],
          true,
          false,
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
          'match',
          ['get', 'class'],
          [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'minor',
            'service',
            'street',
            'street_limited',
          ],
          true,
          false,
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
      // Flat footprint only below street/detail zoom
      {
        id: 'building-flat',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        maxzoom: 15,
        paint: {
          'fill-color': BUILDING,
          'fill-opacity': 0.7,
          'fill-outline-color': BUILDING_EDGE,
        },
      },
      // Premium 3D extrusions from z >= 15
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': BUILDING,
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            15.4,
            ['*', ['coalesce', ['to-number', ['get', 'render_height']], 12], 0.55],
            16.5,
            ['coalesce', ['to-number', ['get', 'render_height']], 14],
          ],
          'fill-extrusion-base': 0,
          // Soft enough that parking layers stay readable underneath/around
          'fill-extrusion-opacity': 0.55,
          'fill-extrusion-vertical-gradient': false,
        },
      },
    ],
  }
}
