import type { Map as MapLibreMapType } from 'maplibre-gl'
import { districtsToGeoJSON } from '../lib/districtsGeoJSON'
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
export const DISTRICT_SOURCE = 'district-zones'
export const DISTRICT_FILL_LAYER = 'district-zones-fill'
export const DISTRICT_OUTLINE_LAYER = 'district-zones-outline'
export const DISTRICT_LABEL_LAYER = 'district-zones-label'

const selectedFillOpacity = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  0.48,
  0.32,
]

const selectedLineWidth = [
  'interpolate',
  ['linear'],
  ['zoom'],
  15,
  ['case', ['boolean', ['feature-state', 'selected'], false], 5.5, 2.8],
  17,
  ['case', ['boolean', ['feature-state', 'selected'], false], 9, 4.5],
  18,
  ['case', ['boolean', ['feature-state', 'selected'], false], 11, 6],
]

const selectedLineOpacity = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  1,
  0.72,
]

/** Soft collision-safe symbol layout shared by parking labels. */
const noOverlapSymbol = {
  'icon-allow-overlap': false,
  'text-allow-overlap': false,
  'icon-ignore-placement': false,
  'text-ignore-placement': false,
  'symbol-z-order': 'source' as const,
}

/** Keep LOD zoom gates in sync even when layers already exist (HMR / remount). */
function syncLodZoomLimits(map: MapLibreMapType) {
  const setMin = (id: string, z: number) => {
    if (map.getLayer(id)) map.setLayerZoomRange(id, z, 24)
  }
  const setMax = (id: string, z: number) => {
    if (map.getLayer(id)) map.setLayerZoomRange(id, 0, z)
  }

  setMax(DISTRICT_FILL_LAYER, ZOOM.lotMin)
  setMax(DISTRICT_OUTLINE_LAYER, ZOOM.lotMin)
  setMax(DISTRICT_LABEL_LAYER, ZOOM.lotMin)

  setMin(PARKING_LOTS_FILL_LAYER, ZOOM.lotMin)
  setMin(PARKING_LOTS_OUTLINE_LAYER, ZOOM.lotMin)
  setMin(PARKING_LOTS_LABEL_LAYER, ZOOM.lotMin)

  for (const id of [
    PARKING_LINES_CASING_LAYER,
    PARKING_LINES_GLOW_LAYER,
    PARKING_LINES_LAYER,
    'parking-street-lines-hit',
  ]) {
    setMin(id, ZOOM.detailMin)
  }

  for (const layerKey of PARKING_PROVIDERS) {
    const meta = PARKING_LAYER_META[layerKey]
    setMin(meta.id, ZOOM.detailMin)
    setMin(`${meta.id}-label`, ZOOM.detailMin)
  }
}

/** Clean parking overlays — soft fills/lines with selection highlight + LOD. */
export function ensureParkingOverlaySources(map: MapLibreMapType) {
  // ——— District badges (city macro, zoom < 13) ———
  if (!map.getSource(DISTRICT_SOURCE)) {
    map.addSource(DISTRICT_SOURCE, {
      type: 'geojson',
      data: districtsToGeoJSON(),
    })
    map.addLayer({
      id: DISTRICT_FILL_LAYER,
      type: 'fill',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.lotMin,
      layout: { visibility: 'visible' },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.12,
      },
    })
    map.addLayer({
      id: DISTRICT_OUTLINE_LAYER,
      type: 'line',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.lotMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.2,
        'line-opacity': 0.4,
        'line-dasharray': [2, 1.5],
      },
    })
    map.addLayer({
      id: DISTRICT_LABEL_LAYER,
      type: 'symbol',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.lotMin,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 13, 12.5, 16],
        'text-max-width': 10,
        'text-letter-spacing': 0.02,
        'symbol-placement': 'point',
        'symbol-sort-key': ['get', 'labelRank'],
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F8FAFC',
        'text-halo-width': 2.2,
      },
    })
  }

  // ——— Lot polygons (zone view ≥ 13) ———
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
      minzoom: ZOOM.lotMin,
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
      minzoom: ZOOM.lotMin,
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
          13,
          ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 1],
          17,
          ['case', ['boolean', ['feature-state', 'selected'], false], 3.2, 1.6],
        ] as never,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.85,
          0.45,
        ] as never,
        'line-blur': 0.6,
      },
    })
    map.addLayer({
      id: PARKING_LOTS_LABEL_LAYER,
      type: 'symbol',
      source: PARKING_LOTS_SOURCE,
      minzoom: ZOOM.lotMin,
      layout: {
        'text-field': ['get', 'badge'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 17, 13],
        'text-max-width': 8,
        'symbol-placement': 'point',
        'symbol-sort-key': ['get', 'labelRank'],
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F8FAFC',
        'text-halo-width': 1.8,
      },
    })
  }

  // ——— Street curb lines (detail ≥ 15 only) ———
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
      minzoom: ZOOM.detailMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#FFFFFF',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 5, 17, 9, 18, 12],
        'line-opacity': 0.72,
      },
    })
    map.addLayer({
      id: PARKING_LINES_GLOW_LAYER,
      type: 'line',
      source: PARKING_LINES_SOURCE,
      minzoom: ZOOM.detailMin,
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
          15,
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
      minzoom: ZOOM.detailMin,
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
      minzoom: ZOOM.detailMin,
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

  // ——— POI pins: EV / INVA / loading / P&R (detail ≥ 15) ———
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
        minzoom: ZOOM.detailMin,
        layout: { visibility: 'visible' },
        paint: {
          'circle-color': meta.color,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
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
        minzoom: ZOOM.detailMin,
        layout: {
          'text-field': ['get', 'badge'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 9,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'symbol-sort-key': ['get', 'labelRank'],
          ...noOverlapSymbol,
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

  syncLodZoomLimits(map)
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
