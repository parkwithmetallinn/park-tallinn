import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { NAV_PITCH, ROUTE_COLOR, ROUTE_OUTLINE } from './theme'

export { NAV_PITCH, ROUTE_COLOR, ROUTE_OUTLINE }

/** Optional remote base if you want fuller POI/label layers later. */
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const BG = '#F1F5F9'
const BUILDING = '#E2E8F0'
const ROAD = '#FFFFFF'
const ROAD_CASE = '#CBD5E1'
const ROAD_CASE_MAJOR = '#94A3B8'
const WATER = '#93C5FD'

function setPaint(map: MapLibreMap, id: string, prop: string, value: unknown) {
  if (!map.getLayer(id)) return
  try {
    map.setPaintProperty(id, prop as never, value as never)
  } catch {
    /* layer/paint mismatch — skip */
  }
}

function setLayout(map: MapLibreMap, id: string, prop: string, value: unknown) {
  if (!map.getLayer(id)) return
  try {
    map.setLayoutProperty(id, prop as never, value as never)
  } catch {
    /* skip */
  }
}

/** Apply minimalist Waze palette + 3D buildings after style load. */
export function applyWazeTheme(map: MapLibreMap) {
  setPaint(map, 'background', 'background-color', BG)

  // Mute / hide noisy layers
  for (const id of [
    'natural_earth',
    'landcover-glacier',
    'landuse-residential',
    'landuse-commercial',
    'landuse-industrial',
    'landuse-cemetery',
    'landuse-hospital',
    'landuse-school',
    'landuse-railway',
    'landcover-wood',
    'landcover-grass',
    'landcover-ice-shelf',
    'landcover-sand',
    'park',
    'park-outline',
    'landuse-pitch',
  ]) {
    if (map.getLayer(id)) {
      try {
        map.setLayoutProperty(id, 'visibility', 'none')
      } catch {
        /* skip */
      }
    }
  }

  // Soft landuses that remain
  for (const id of map.getStyle().layers?.map((l) => l.id) ?? []) {
    const layer = map.getLayer(id)
    if (!layer) continue
    if (layer.type === 'background') continue

    if (id.includes('water') && layer.type === 'fill') {
      setPaint(map, id, 'fill-color', WATER)
      setPaint(map, id, 'fill-opacity', 1)
    }
    if (id.includes('waterway') && layer.type === 'line') {
      setPaint(map, id, 'line-color', WATER)
    }

    // Road casings → grey
    if (
      (id.includes('highway') || id.includes('road') || id.includes('tunnel') || id.includes('bridge')) &&
      id.includes('casing')
    ) {
      setPaint(map, id, 'line-color', id.includes('motorway') || id.includes('trunk') || id.includes('primary') ? ROAD_CASE_MAJOR : ROAD_CASE)
    }

    // Road fills → white
    if (
      (id.includes('highway') || id.includes('road') || id.includes('tunnel') || id.includes('bridge')) &&
      (id.includes('fill') || id.endsWith('-road') || /highway-(motorway|trunk|primary|secondary|tertiary|minor|service|path)/.test(id)) &&
      !id.includes('casing') &&
      !id.includes('name') &&
      !id.includes('label') &&
      layer.type === 'line'
    ) {
      setPaint(map, id, 'line-color', ROAD)
    }

    // Buildings flat
    if (id.includes('building') && layer.type === 'fill') {
      setPaint(map, id, 'fill-color', BUILDING)
      setPaint(map, id, 'fill-opacity', 0.95)
      setPaint(map, id, 'fill-outline-color', ROAD_CASE)
    }
  }

  // Replace flat buildings with 3D extrusion if possible
  const style = map.getStyle()
  const buildingLayer = style.layers?.find(
    (l) => l.type === 'fill' && l.id.includes('building') && 'source' in l,
  )
  if (buildingLayer && 'source' in buildingLayer && 'source-layer' in buildingLayer) {
    const source = buildingLayer.source as string
    const sourceLayer = (buildingLayer as { 'source-layer'?: string })['source-layer']
    if (sourceLayer && !map.getLayer('building-3d-waze')) {
      // Hide flat building fills at higher zoom
      for (const l of style.layers ?? []) {
        if (l.type === 'fill' && l.id.includes('building')) {
          setLayout(map, l.id, 'visibility', 'none')
        }
      }
      map.addLayer({
        id: 'building-3d-waze',
        type: 'fill-extrusion',
        source,
        'source-layer': sourceLayer,
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
            ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
          ],
          'fill-extrusion-base': [
            'coalesce',
            ['get', 'render_min_height'],
            ['get', 'min_height'],
            0,
          ],
          'fill-extrusion-opacity': 0.92,
        },
      })
    }
  }

  // Soften remaining landcover fills toward paper grey
  for (const l of map.getStyle().layers ?? []) {
    if (l.type === 'fill' && (l.id.includes('landcover') || l.id.includes('landuse'))) {
      if (map.getLayoutProperty(l.id, 'visibility') === 'none') continue
      setPaint(map, l.id, 'fill-color', '#E8EEF3')
      setPaint(map, l.id, 'fill-opacity', 0.45)
    }
  }
}

/** Minimal Waze-like style (OpenFreeMap vector tiles). */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: 'Waze minimal',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · OpenFreeMap',
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
      paint: {
        'fill-color': '#E8EEF3',
        'fill-opacity': 0.4,
      },
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
