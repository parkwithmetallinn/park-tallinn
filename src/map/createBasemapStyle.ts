import type { StyleSpecification } from 'maplibre-gl'
import {
  GLYPHS_URL,
  STYLE_URL,
  VECTOR_TILE_ATTRIBUTION,
  VECTOR_TILE_SOURCE_URL,
} from '../config/basemap'
import type { ThemeMode } from '../lib/theme'

type Palette = {
  bg: string
  water: string
  landcover: string
  park: string
  road: string
  roadMajor: string
  roadCase: string
  building: string
  buildingEdge: string
  label: string
  labelHalo: string
  lightColor: string
  lightIntensity: number
}

const LIGHT: Palette = {
  bg: '#F2F4F7',
  water: '#A8C8F0',
  landcover: '#E6EDF2',
  park: '#D7E8D2',
  road: '#FFFFFF',
  roadMajor: '#FFFFFF',
  roadCase: '#D5D9E0',
  building: '#E8E8E8',
  buildingEdge: '#D8D8D8',
  label: '#3A3A3C',
  labelHalo: '#FFFFFF',
  lightColor: '#ffffff',
  lightIntensity: 0.28,
}

const DARK: Palette = {
  bg: '#12161c',
  water: '#0f2236',
  landcover: '#1a1f27',
  park: '#1a2a1f',
  road: '#2a313c',
  roadMajor: '#3a4350',
  roadCase: '#1a1f27',
  building: '#222831',
  buildingEdge: '#2c333d',
  label: '#c9d1da',
  labelHalo: '#0b0e12',
  lightColor: '#8a9bb0',
  lightIntensity: 0.22,
}

/** Real roads only — exclude ferry/rail/path diagonals that cut across the map. */
const ROAD_CLASS_FILTER = [
  'all',
  [
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
  ['!=', ['get', 'class'], 'ferry'],
  ['!=', ['get', 'class'], 'rail'],
  ['!=', ['get', 'class'], 'transit'],
  ['!=', ['get', 'class'], 'path'],
  ['!=', ['get', 'class'], 'track'],
  ['!=', ['get', 'class'], 'pier'],
] as StyleSpecification['layers'][number] extends { filter?: infer F } ? F : never

const MAJOR_ROAD_FILTER = [
  'all',
  [
    'match',
    ['get', 'class'],
    ['motorway', 'trunk', 'primary', 'secondary'],
    true,
    false,
  ],
] as StyleSpecification['layers'][number] extends { filter?: infer F } ? F : never

function buildInlineStyle(mode: ThemeMode): StyleSpecification {
  const p = mode === 'dark' ? DARK : LIGHT

  return {
    version: 8,
    name:
      mode === 'dark'
        ? 'Park Tallinn basemap (dark)'
        : 'Park Tallinn basemap (temporary OSM)',
    glyphs: GLYPHS_URL,
    light: {
      anchor: 'viewport',
      color: p.lightColor,
      intensity: p.lightIntensity,
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
      { id: 'background', type: 'background', paint: { 'background-color': p.bg } },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': p.water, 'fill-opacity': mode === 'dark' ? 1 : 0.85 },
      },
      {
        id: 'landcover-soft',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: {
          'fill-color': p.landcover,
          'fill-opacity': mode === 'dark' ? 0.55 : 0.35,
        },
      },
      {
        id: 'landuse-park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: [
          'match',
          ['get', 'class'],
          ['park', 'grass', 'cemetery', 'wood', 'forest'],
          true,
          false,
        ],
        paint: {
          'fill-color': p.park,
          'fill-opacity': mode === 'dark' ? 0.45 : 0.35,
        },
      },
      {
        id: 'road-case',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ROAD_CLASS_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.roadCase,
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
        filter: ROAD_CLASS_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.road,
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
        id: 'road-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: MAJOR_ROAD_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.roadMajor,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            1.4,
            14,
            7,
            16,
            13,
          ],
        },
      },
      {
        id: 'building-flat',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        maxzoom: 15,
        paint: {
          'fill-color': p.building,
          'fill-opacity': mode === 'dark' ? 0.85 : 0.7,
          'fill-outline-color': p.buildingEdge,
        },
      },
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': p.building,
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
          'fill-extrusion-opacity': mode === 'dark' ? 0.7 : 0.55,
          'fill-extrusion-vertical-gradient': false,
        },
      },
      {
        id: 'place-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 10,
        maxzoom: 14,
        layout: {
          'text-field': ['coalesce', ['get', 'name:et'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 13, 14],
          'text-max-width': 8,
          'text-padding': 4,
          'text-optional': true,
        },
        paint: {
          'text-color': p.label,
          'text-halo-color': p.labelHalo,
          'text-halo-width': 1.4,
        },
      },
    ],
  }
}

/**
 * Returns MapLibre style: either remote STYLE_URL or inline style
 * built from VECTOR_TILE_SOURCE_URL (swap that constant for Maa-amet).
 */
export function createBasemapStyle(
  mode: ThemeMode = 'light',
): string | StyleSpecification {
  if (STYLE_URL) return STYLE_URL
  return buildInlineStyle(mode)
}
