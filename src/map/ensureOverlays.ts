import type { Map as MapLibreMapType } from 'maplibre-gl'
import {
  PARKING_LAYER_META,
  PARKING_PROVIDERS,
  PARKING_VIEWPORT_SOURCE,
} from './parkingLayers'
import {
  PARKING_LINES_CASING_LAYER,
  PARKING_LINES_GLOW_LAYER,
  PARKING_LINES_LAYER,
  PARKING_LINES_SOURCE,
  PARKING_LOTS_FILL_LAYER,
  PARKING_LOTS_LABEL_LAYER,
  PARKING_LOTS_OUTLINE_LAYER,
  PARKING_LOTS_SOURCE,
} from './streetLineTheme'
import { ZOOM } from './zoom'

const ROUTE_SOURCE = 'nav-route'

const selectedFillOpacity = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  0.58,
  0.26,
]

const selectedLineWidth = [
  'interpolate',
  ['linear'],
  ['zoom'],
  14,
  ['case', ['boolean', ['feature-state', 'selected'], false], 6.5, 3.2],
  17,
  ['case', ['boolean', ['feature-state', 'selected'], false], 10, 5.5],
  18,
  ['case', ['boolean', ['feature-state', 'selected'], false], 12, 7],
]

const selectedLineOpacity = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  1,
  0.78,
]

/** Clean parking overlays — soft fills/lines with selection highlight. */
export function ensureParkingOverlaySources(map: MapLibreMapType) {
  if (!map.getSource(PARKING_LOTS_SOURCE)) {
    map.addSource(PARKING_LOTS_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: PARKING_LOTS_FILL_LAYER,
      type: 'fill',
      source: PARKING_LOTS_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: { visibility: 'visible' },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': selectedFillOpacity as never,
      },
    })
    map.addLayer({
      id: PARKING_LOTS_OUTLINE_LAYER,
      type: 'line',
      source: PARKING_LOTS_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: { visibility: 'visible' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          ['case', ['boolean', ['feature-state', 'selected'], false], 2.8, 1.2],
          17,
          ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2],
        ] as never,
        'line-opacity': selectedLineOpacity as never,
      },
    })
    map.addLayer({
      id: PARKING_LOTS_LABEL_LAYER,
      type: 'symbol',
      source: PARKING_LOTS_SOURCE,
      minzoom: ZOOM.streetMin + 0.3,
      layout: {
        'text-field': ['get', 'badge'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 12],
        'text-max-width': 8,
        'symbol-placement': 'point',
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F8FAFC',
        'text-halo-width': 1.6,
      },
    })
  }

  if (!map.getSource(PARKING_LINES_SOURCE)) {
    map.addSource(PARKING_LINES_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: PARKING_LINES_CASING_LAYER,
      type: 'line',
      source: PARKING_LINES_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#FFFFFF',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 5, 17, 9, 18, 12],
        'line-opacity': 0.72,
      },
    })
    map.addLayer({
      id: PARKING_LINES_GLOW_LAYER,
      type: 'line',
      source: PARKING_LINES_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          ['case', ['boolean', ['feature-state', 'selected'], false], 14, 0],
          17,
          ['case', ['boolean', ['feature-state', 'selected'], false], 20, 0],
        ] as never,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.28,
          0,
        ] as never,
        'line-blur': 4,
      },
    })
    map.addLayer({
      id: PARKING_LINES_LAYER,
      type: 'line',
      source: PARKING_LINES_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': selectedLineWidth as never,
        'line-opacity': selectedLineOpacity as never,
      },
    })
    map.addLayer({
      id: 'parking-street-lines-hit',
      type: 'line',
      source: PARKING_LINES_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#000000',
        'line-width': 22,
        'line-opacity': 0.01,
      },
    })
  }

  if (!map.getSource(PARKING_VIEWPORT_SOURCE)) {
    map.addSource(PARKING_VIEWPORT_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })

    for (const layerKey of PARKING_PROVIDERS) {
      const meta = PARKING_LAYER_META[layerKey]
      map.addLayer({
        id: meta.id,
        type: 'circle',
        source: PARKING_VIEWPORT_SOURCE,
        filter: [
          'any',
          ['==', ['get', 'layer'], layerKey],
          ['==', ['get', 'provider'], layerKey],
        ],
        minzoom: ZOOM.streetMin,
        layout: { visibility: 'visible' },
        paint: {
          'circle-color': meta.color,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              meta.circleRadius * 1.25,
              meta.circleRadius * 0.85,
            ],
            17,
            [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              meta.circleRadius * 1.7,
              meta.circleRadius * 1.2,
            ],
          ] as never,
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            3.5,
            2,
          ] as never,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            1,
            0.82,
          ] as never,
        },
      })
      map.addLayer({
        id: `${meta.id}-label`,
        type: 'symbol',
        source: PARKING_VIEWPORT_SOURCE,
        filter: [
          'any',
          ['==', ['get', 'layer'], layerKey],
          ['==', ['get', 'provider'], layerKey],
        ],
        minzoom: ZOOM.streetMin + 0.5,
        layout: {
          'text-field': ['get', 'badge'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 9,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': meta.color,
          'text-halo-color': '#F1F5F9',
          'text-halo-width': 1.3,
        },
      })
    }
  }

  if (!map.getSource(ROUTE_SOURCE)) {
    map.addSource(ROUTE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'nav-route-outline',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#5E5CE6',
        'line-width': 14,
        'line-opacity': 0.85,
      },
    })
    map.addLayer({
      id: 'nav-route-line',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7C3AED',
        'line-width': 8,
        'line-opacity': 1,
      },
    })
  }
}

const GEOM_LAYER_IDS = [
  PARKING_LOTS_FILL_LAYER,
  PARKING_LOTS_OUTLINE_LAYER,
  PARKING_LOTS_LABEL_LAYER,
  PARKING_LINES_CASING_LAYER,
  PARKING_LINES_GLOW_LAYER,
  PARKING_LINES_LAYER,
  'parking-street-lines-hit',
] as const

export function setParkingLayerVisibility(
  map: MapLibreMapType,
  visible: Partial<Record<keyof typeof PARKING_LAYER_META, boolean>>,
) {
  for (const layerKey of PARKING_PROVIDERS) {
    const meta = PARKING_LAYER_META[layerKey]
    const on = visible[layerKey] !== false
    if (map.getLayer(meta.id)) {
      map.setLayoutProperty(meta.id, 'visibility', on ? 'visible' : 'none')
    }
    if (map.getLayer(`${meta.id}-label`)) {
      map.setLayoutProperty(`${meta.id}-label`, 'visibility', on ? 'visible' : 'none')
    }
  }
  for (const id of GEOM_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'visible')
    }
  }
}

export { ROUTE_SOURCE }
