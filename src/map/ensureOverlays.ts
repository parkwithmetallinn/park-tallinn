import type { Map as MapLibreMapType } from 'maplibre-gl'
import {
  GRID_DEBUG_SOURCE,
  PARKING_LAYER_META,
  PARKING_PROVIDERS,
  PARKING_VIEWPORT_SOURCE,
} from './parkingLayers'
import { ZOOM } from './zoom'

const PAID_SOURCE = 'paid-zones'
const DISTRICT_SOURCE = 'district-zones'
const ROUTE_SOURCE = 'nav-route'

export function ensureParkingOverlaySources(map: MapLibreMapType) {
  if (!map.getSource(PAID_SOURCE)) {
    map.addSource(PAID_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'paid-zones-fill',
      type: 'fill',
      source: PAID_SOURCE,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
    })
    map.addLayer({
      id: 'paid-zones-line',
      type: 'line',
      source: PAID_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2.5,
        'line-opacity': 0.95,
      },
    })
    map.addLayer({
      id: 'paid-zones-label',
      type: 'symbol',
      source: PAID_SOURCE,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-font': ['Noto Sans Bold'],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.04,
        'text-max-width': 10,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F1F5F9',
        'text-halo-width': 2,
      },
    })
  }

  if (!map.getSource(DISTRICT_SOURCE)) {
    map.addSource(DISTRICT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'district-fill',
      type: 'fill',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.streetMin,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.28,
          ZOOM.districtMax,
          0.18,
          ZOOM.streetMin,
          0.06,
        ],
      },
    })
    map.addLayer({
      id: 'district-outline',
      type: 'line',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.streetMin + 0.4,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 13, 3, 15, 1.5],
        'line-opacity': 0.9,
      },
    })
    map.addLayer({
      id: 'district-label',
      type: 'symbol',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.streetMin,
      layout: {
        'text-field': [
          'format',
          ['get', 'name'],
          { 'font-scale': 1.05 },
          '\n',
          {},
          ['get', 'countLabel'],
          { 'font-scale': 0.9 },
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 13, 14],
        'text-font': ['Noto Sans Bold'],
        'text-max-width': 12,
        'text-line-height': 1.15,
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#F1F5F9',
        'text-halo-width': 2.2,
      },
    })
  }

  if (!map.getSource(GRID_DEBUG_SOURCE)) {
    map.addSource(GRID_DEBUG_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'grid-debug-line',
      type: 'line',
      source: GRID_DEBUG_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#94A3B8',
        'line-width': 0.8,
        'line-opacity': 0.55,
      },
    })
  }

  // One viewport source → N provider layers (GPU filters, no DOM)
  if (!map.getSource(PARKING_VIEWPORT_SOURCE)) {
    map.addSource(PARKING_VIEWPORT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    for (const provider of PARKING_PROVIDERS) {
      const meta = PARKING_LAYER_META[provider]
      map.addLayer({
        id: meta.id,
        type: 'circle',
        source: PARKING_VIEWPORT_SOURCE,
        filter: ['==', ['get', 'provider'], provider],
        minzoom: ZOOM.streetMin,
        layout: { visibility: 'visible' },
        paint: {
          'circle-color': meta.color,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            meta.circleRadius * 0.85,
            17,
            meta.circleRadius * 1.25,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95,
        },
      })
      map.addLayer({
        id: `${meta.id}-label`,
        type: 'symbol',
        source: PARKING_VIEWPORT_SOURCE,
        filter: ['==', ['get', 'provider'], provider],
        minzoom: ZOOM.streetMin + 0.6,
        layout: {
          'text-field': ['get', 'badge'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 9,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': meta.color,
          'text-halo-color': '#F1F5F9',
          'text-halo-width': 1.2,
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
        'line-color': '#6B21A8',
        'line-width': 14,
        'line-opacity': 0.9,
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

export function setParkingLayerVisibility(
  map: MapLibreMapType,
  visible: Partial<Record<keyof typeof PARKING_LAYER_META, boolean>>,
) {
  for (const provider of PARKING_PROVIDERS) {
    const meta = PARKING_LAYER_META[provider]
    const on = visible[provider] !== false
    if (map.getLayer(meta.id)) {
      map.setLayoutProperty(meta.id, 'visibility', on ? 'visible' : 'none')
    }
    if (map.getLayer(`${meta.id}-label`)) {
      map.setLayoutProperty(`${meta.id}-label`, 'visibility', on ? 'visible' : 'none')
    }
  }
}

export { PAID_SOURCE, DISTRICT_SOURCE, ROUTE_SOURCE }
