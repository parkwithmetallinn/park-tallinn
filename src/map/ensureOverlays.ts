import type { Map as MapLibreMapType } from 'maplibre-gl'
import type { ThemeMode } from '../lib/theme'
import {
  districtDebugRefsToGeoJSON,
  districtLabelsToGeoJSON,
  districtsToGeoJSON,
} from '../lib/districtsGeoJSON'
import {
  parnuZoneLabelsToGeoJSON,
  parnuZonesToGeoJSON,
} from '../data/parnuZones'
import type { CityId } from '../data/cities'
import {
  PRECISE_FILL_LAYER,
  PRECISE_LABEL_LAYER,
  PRECISE_MULTISTOREY_BADGE_LAYER,
  PRECISE_OUTLINE_LAYER,
  PRECISE_OUTLINE_UNDERGROUND_LAYER,
  PRECISE_PARKING_SOURCE,
} from '../lib/preciseParkingPolygons'
import {
  STREET_PARKING_CASING_LAYER,
  STREET_PARKING_HIT_LAYER,
  STREET_PARKING_LINE_LAYER,
  STREET_PARKING_SOURCE,
} from '../lib/streetParkingLines'
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
export const DISTRICT_LABEL_SOURCE = 'district-zone-labels'
export const DISTRICT_DEBUG_SOURCE = 'district-debug-refs'
export const DISTRICT_FILL_LAYER = 'district-zones-fill'
export const DISTRICT_SUBZONE_FILL_LAYER = 'district-zones-subzone-fill'
export const DISTRICT_OUTLINE_LAYER = 'district-zones-outline'
export const DISTRICT_SUBZONE_OUTLINE_LAYER = 'district-zones-subzone-outline'
export const DISTRICT_LABEL_LAYER = 'district-zones-label'
export const DISTRICT_DEBUG_CIRCLE_LAYER = 'district-debug-refs-circle'
export const DISTRICT_DEBUG_LABEL_LAYER = 'district-debug-refs-label'

/** Fallback if a feature is missing its per-district color property. */
const DISTRICT_COLOR_FALLBACK = '#64748B'

/** Dark-mode district stroke — light gray-blue, readable on #12161c land. */
const DISTRICT_LINE_DARK = '#8fa3ba'
const DISTRICT_FILL_DARK = '#8fa3ba'
const LABEL_HALO_LIGHT = '#FFFFFF'
const LABEL_HALO_DARK = '#0b0e12'
const CASING_LIGHT = '#FFFFFF'
const CASING_DARK = '#0b0e12'
const CIRCLE_STROKE_LIGHT = '#ffffff'
const CIRCLE_STROKE_DARK = '#1a1f27'

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

/** Soft collision-safe symbol layout — required on every parking label layer. */
const noOverlapSymbol = {
  'icon-allow-overlap': false as const,
  'text-allow-overlap': false as const,
  'icon-ignore-placement': false as const,
  'text-ignore-placement': false as const,
  'symbol-z-order': 'source' as const,
}

const SYMBOL_LAYER_IDS = [
  DISTRICT_LABEL_LAYER,
  PARKING_LOTS_LABEL_LAYER,
  PRECISE_LABEL_LAYER,
  PRECISE_MULTISTOREY_BADGE_LAYER,
  ...PARKING_PROVIDERS.map((k) => `${PARKING_LAYER_META[k].id}-label`),
]

/** Force collision-safe layout on every parking symbol layer. */
function syncCollisionProps(map: MapLibreMapType) {
  for (const id of SYMBOL_LAYER_IDS) {
    if (!map.getLayer(id)) continue
    map.setLayoutProperty(id, 'icon-allow-overlap', false)
    map.setLayoutProperty(id, 'text-allow-overlap', false)
    map.setLayoutProperty(id, 'icon-ignore-placement', false)
    map.setLayoutProperty(id, 'text-ignore-placement', false)
  }
}

/** Keep LOD zoom gates in sync even when layers already exist (HMR / remount). */
function syncLodZoomLimits(map: MapLibreMapType) {
  const setMin = (id: string, z: number) => {
    if (map.getLayer(id)) map.setLayerZoomRange(id, z, 24)
  }
  const setMax = (id: string, z: number) => {
    if (map.getLayer(id)) map.setLayerZoomRange(id, 0, z)
  }

  // Fill fades by zoom 14; lines/labels stay useful a bit longer / labels 10–13
  setMax(DISTRICT_FILL_LAYER, 14)
  setMax(DISTRICT_SUBZONE_FILL_LAYER, 14)
  setMax(DISTRICT_OUTLINE_LAYER, 14)
  setMax(DISTRICT_SUBZONE_OUTLINE_LAYER, 14)
  if (map.getLayer(DISTRICT_LABEL_LAYER)) {
    map.setLayerZoomRange(DISTRICT_LABEL_LAYER, 10, 13)
  }

  setMin(PARKING_LOTS_FILL_LAYER, ZOOM.lotMin)
  setMin(PARKING_LOTS_OUTLINE_LAYER, ZOOM.lotMin)
  setMin(PARKING_LOTS_LABEL_LAYER, ZOOM.lotMin)

  setMin(PRECISE_FILL_LAYER, ZOOM.lotMin)
  setMin(PRECISE_OUTLINE_LAYER, ZOOM.lotMin)
  setMin(PRECISE_OUTLINE_UNDERGROUND_LAYER, ZOOM.lotMin)
  // Lot name badges (SB / EP / FREE…) from detail zoom to declutter dense operators
  setMin(PRECISE_LABEL_LAYER, ZOOM.detailMin)
  setMin(PRECISE_MULTISTOREY_BADGE_LAYER, ZOOM.lotMin)

  setMin(STREET_PARKING_CASING_LAYER, ZOOM.streetMin)
  setMin(STREET_PARKING_LINE_LAYER, ZOOM.streetMin)
  setMin(STREET_PARKING_HIT_LAYER, ZOOM.streetMin)

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

function ensureUndergroundHatch(map: MapLibreMapType) {
  if (map.hasImage('underground-hatch')) return
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const on = (x + y) % 4 === 0
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = on ? 90 : 0
    }
  }
  map.addImage('underground-hatch', { width: size, height: size, data }, { pixelRatio: 2 })
}

/** Theme-aware paints for districts, label halos, casings, marker strokes. */
function applyOverlayThemePaints(map: MapLibreMapType, mode: ThemeMode) {
  const dark = mode === 'dark'
  const halo = dark ? LABEL_HALO_DARK : LABEL_HALO_LIGHT
  const casing = dark ? CASING_DARK : CASING_LIGHT
  const circleStroke = dark ? CIRCLE_STROKE_DARK : CIRCLE_STROKE_LIGHT

  if (map.getLayer(DISTRICT_FILL_LAYER)) {
    map.setPaintProperty(
      DISTRICT_FILL_LAYER,
      'fill-color',
      dark
        ? DISTRICT_FILL_DARK
        : (['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK] as never),
    )
    map.setPaintProperty(
      DISTRICT_FILL_LAYER,
      'fill-opacity',
      dark
        ? ([
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.1,
            ['case', ['boolean', ['feature-state', 'dim'], false], 0.04, 0.07],
          ] as never)
        : ([
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.28,
            ['case', ['boolean', ['feature-state', 'dim'], false], 0.06, 0.16],
          ] as never),
    )
  }
  if (map.getLayer(DISTRICT_OUTLINE_LAYER)) {
    map.setPaintProperty(
      DISTRICT_OUTLINE_LAYER,
      'line-color',
      dark
        ? DISTRICT_LINE_DARK
        : (['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK] as never),
    )
    map.setPaintProperty(DISTRICT_OUTLINE_LAYER, 'line-width', [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      2.4,
      1.5,
    ])
    map.setPaintProperty(
      DISTRICT_OUTLINE_LAYER,
      'line-opacity',
      dark
        ? ([
            'case',
            ['boolean', ['feature-state', 'dim'], false],
            0.3,
            0.6,
          ] as never)
        : ([
            'case',
            ['boolean', ['feature-state', 'dim'], false],
            0.25,
            0.55,
          ] as never),
    )
  }
  if (map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
    map.setPaintProperty(
      DISTRICT_SUBZONE_FILL_LAYER,
      'fill-color',
      dark
        ? '#c4a574'
        : (['coalesce', ['get', 'color'], '#B45309'] as never),
    )
    map.setPaintProperty(
      DISTRICT_SUBZONE_FILL_LAYER,
      'fill-opacity',
      dark
        ? ([
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.12,
            0.08,
          ] as never)
        : ([
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.32,
            0.22,
          ] as never),
    )
  }
  if (map.getLayer(DISTRICT_SUBZONE_OUTLINE_LAYER)) {
    map.setPaintProperty(
      DISTRICT_SUBZONE_OUTLINE_LAYER,
      'line-color',
      dark ? '#c4a574' : (['coalesce', ['get', 'color'], '#B45309'] as never),
    )
    map.setPaintProperty(
      DISTRICT_SUBZONE_OUTLINE_LAYER,
      'line-opacity',
      dark ? 0.7 : 0.85,
    )
  }
  if (map.getLayer(DISTRICT_LABEL_LAYER)) {
    map.setPaintProperty(
      DISTRICT_LABEL_LAYER,
      'text-color',
      dark
        ? '#c9d1da'
        : (['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK] as never),
    )
    map.setPaintProperty(DISTRICT_LABEL_LAYER, 'text-halo-color', halo)
    map.setPaintProperty(DISTRICT_LABEL_LAYER, 'text-halo-width', dark ? 2 : 2.4)
  }

  for (const id of [
    PRECISE_LABEL_LAYER,
    PARKING_LOTS_LABEL_LAYER,
    PRECISE_MULTISTOREY_BADGE_LAYER,
  ]) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(id, 'text-halo-color', halo)
  }
  if (map.getLayer(PRECISE_MULTISTOREY_BADGE_LAYER)) {
    map.setPaintProperty(
      PRECISE_MULTISTOREY_BADGE_LAYER,
      'text-color',
      dark ? '#e5e7eb' : '#1C1C1E',
    )
  }

  for (const id of [STREET_PARKING_CASING_LAYER, PARKING_LINES_CASING_LAYER]) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(id, 'line-color', casing)
    if (dark && id === STREET_PARKING_CASING_LAYER) {
      map.setPaintProperty(id, 'line-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        0.35,
        13,
        0.55,
        16,
        0.85,
      ])
    }
  }

  // Slightly stronger parking fills on dark basemap for hue recognition
  if (map.getLayer(PRECISE_FILL_LAYER)) {
    map.setPaintProperty(
      PRECISE_FILL_LAYER,
      'fill-opacity',
      dark
        ? ([
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.58,
            0.42,
          ] as never)
        : ([
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.48,
            0.35,
          ] as never),
    )
  }

  for (const layerKey of PARKING_PROVIDERS) {
    const meta = PARKING_LAYER_META[layerKey]
    if (map.getLayer(meta.id)) {
      map.setPaintProperty(meta.id, 'circle-stroke-color', circleStroke)
    }
    const labelId = `${meta.id}-label`
    if (map.getLayer(labelId)) {
      map.setPaintProperty(labelId, 'text-halo-color', halo)
    }
  }

  if (map.getLayer(DISTRICT_DEBUG_CIRCLE_LAYER)) {
    map.setPaintProperty(
      DISTRICT_DEBUG_CIRCLE_LAYER,
      'circle-color',
      dark ? '#e5e7eb' : '#0F172A',
    )
    map.setPaintProperty(
      DISTRICT_DEBUG_CIRCLE_LAYER,
      'circle-stroke-color',
      dark ? '#0b0e12' : '#FFFFFF',
    )
  }
  if (map.getLayer(DISTRICT_DEBUG_LABEL_LAYER)) {
    map.setPaintProperty(
      DISTRICT_DEBUG_LABEL_LAYER,
      'text-color',
      dark ? '#e5e7eb' : '#0F172A',
    )
    map.setPaintProperty(DISTRICT_DEBUG_LABEL_LAYER, 'text-halo-color', halo)
  }
}

/** Clean parking overlays — soft fills/lines with selection highlight + LOD. */
export function ensureParkingOverlaySources(
  map: MapLibreMapType,
  mode: ThemeMode = 'light',
) {
  ensureUndergroundHatch(map)

  // ——— Districts (Tallinn GIS → public/data/districts.geojson) ———
  // Order: fill → district lines → Vanalinn line → labels. Per-district colors.
  if (!map.getSource(DISTRICT_SOURCE)) {
    map.addSource(DISTRICT_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: districtsToGeoJSON(),
    })
  } else {
    const src = map.getSource(DISTRICT_SOURCE) as { setData?: (d: unknown) => void }
    src.setData?.(districtsToGeoJSON())
  }
  if (!map.getSource(DISTRICT_LABEL_SOURCE)) {
    map.addSource(DISTRICT_LABEL_SOURCE, {
      type: 'geojson',
      data: districtLabelsToGeoJSON(),
    })
  } else {
    const src = map.getSource(DISTRICT_LABEL_SOURCE) as {
      setData?: (d: unknown) => void
    }
    src.setData?.(districtLabelsToGeoJSON())
  }
  if (!map.getSource(DISTRICT_DEBUG_SOURCE)) {
    map.addSource(DISTRICT_DEBUG_SOURCE, {
      type: 'geojson',
      data: districtDebugRefsToGeoJSON(),
    })
  }

  if (!map.getLayer(DISTRICT_FILL_LAYER)) {
    map.addLayer({
      id: DISTRICT_FILL_LAYER,
      type: 'fill',
      source: DISTRICT_SOURCE,
      maxzoom: 14,
      filter: ['==', ['get', 'role'], 'district'],
      layout: { visibility: 'visible' },
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.28,
          [
            'case',
            ['boolean', ['feature-state', 'dim'], false],
            0.06,
            0.16,
          ],
        ],
      },
    })
  }
  if (!map.getLayer(DISTRICT_OUTLINE_LAYER)) {
    map.addLayer({
      id: DISTRICT_OUTLINE_LAYER,
      type: 'line',
      source: DISTRICT_SOURCE,
      maxzoom: 14,
      filter: ['==', ['get', 'role'], 'district'],
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          2.4,
          1.5,
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'dim'], false],
          0.25,
          0.55,
        ],
      },
    })
  }
  // Vanalinn overlay on top of district lines
  if (!map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
    map.addLayer({
      id: DISTRICT_SUBZONE_FILL_LAYER,
      type: 'fill',
      source: DISTRICT_SOURCE,
      maxzoom: 14,
      filter: ['==', ['get', 'role'], 'subzone'],
      layout: { visibility: 'visible' },
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#B45309'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.32,
          0.22,
        ],
      },
    })
  }
  if (!map.getLayer(DISTRICT_SUBZONE_OUTLINE_LAYER)) {
    map.addLayer({
      id: DISTRICT_SUBZONE_OUTLINE_LAYER,
      type: 'line',
      source: DISTRICT_SOURCE,
      maxzoom: 14,
      filter: ['==', ['get', 'role'], 'subzone'],
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#B45309'],
        'line-width': 2,
        'line-opacity': 0.85,
      },
    })
  }
  if (!map.getLayer(DISTRICT_LABEL_LAYER)) {
    map.addLayer({
      id: DISTRICT_LABEL_LAYER,
      type: 'symbol',
      source: DISTRICT_LABEL_SOURCE,
      minzoom: 10,
      maxzoom: 13,
      layout: {
        'text-field': ['get', 'name_et'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 12, 12.5, 15],
        'text-max-width': 10,
        'text-letter-spacing': 0.02,
        'symbol-placement': 'point',
        'symbol-sort-key': ['get', 'labelRank'],
        'text-padding': 6,
        'text-optional': true,
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK],
        'text-halo-color': LABEL_HALO_LIGHT,
        'text-halo-width': 2.4,
        'text-halo-blur': 0.3,
      },
    })
  }

  // Temporary QA markers (hidden by default — toggled from MapView)
  if (!map.getLayer(DISTRICT_DEBUG_CIRCLE_LAYER)) {
    map.addLayer({
      id: DISTRICT_DEBUG_CIRCLE_LAYER,
      type: 'circle',
      source: DISTRICT_DEBUG_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 6,
        'circle-color': '#0F172A',
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
      },
    })
  }
  if (!map.getLayer(DISTRICT_DEBUG_LABEL_LAYER)) {
    map.addLayer({
      id: DISTRICT_DEBUG_LABEL_LAYER,
      type: 'symbol',
      source: DISTRICT_DEBUG_SOURCE,
      layout: {
        visibility: 'none',
        'text-field': ['concat', ['get', 'name'], ' → ', ['get', 'expect']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': '#0F172A',
        'text-halo-color': LABEL_HALO_LIGHT,
        'text-halo-width': 2,
      },
    })
  }

  // ——— High-precision parking polygons (estonia_parking_master.geojson lots) ———
  if (!map.getSource(PRECISE_PARKING_SOURCE)) {
    map.addSource(PRECISE_PARKING_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })

    // Fill — translucent operator colors (opacity 0.35)
    map.addLayer({
      id: PRECISE_FILL_LAYER,
      type: 'fill',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.lotMin,
      layout: { visibility: 'visible' },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.48,
          0.35,
        ] as never,
      },
    })

    // Subtle hatch for underground lots
    map.addLayer({
      id: 'parking-fill-underground-hatch',
      type: 'fill',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.lotMin,
      filter: ['==', ['get', 'type'], 'underground'],
      layout: { visibility: 'visible' },
      paint: {
        'fill-pattern': 'underground-hatch',
        'fill-opacity': 0.55,
      },
    })

    // Solid curb-to-curb outline (surface + multi_storey)
    map.addLayer({
      id: PRECISE_OUTLINE_LAYER,
      type: 'line',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.lotMin,
      filter: ['!=', ['get', 'type'], 'underground'],
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 1,
      },
    })

    // Dashed outline for underground
    map.addLayer({
      id: PRECISE_OUTLINE_UNDERGROUND_LAYER,
      type: 'line',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.lotMin,
      filter: ['==', ['get', 'type'], 'underground'],
      layout: {
        visibility: 'visible',
        'line-cap': 'butt',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 1,
        'line-dasharray': [1.2, 1.6],
      },
    })

    // Lot name labels (from detail zoom; Snabb uses mapLabel "SB")
    map.addLayer({
      id: PRECISE_LABEL_LAYER,
      type: 'symbol',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.detailMin,
      layout: {
        'text-field': ['get', 'badge'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 13],
        'text-max-width': 8,
        'symbol-placement': 'point',
        // Larger lots first (area_m2); fall back to labelRank
        'symbol-sort-key': [
          'coalesce',
          ['*', -1, ['get', 'area_m2']],
          ['get', 'labelRank'],
        ],
        'text-padding': 4,
        'text-optional': true,
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F8FAFC',
        'text-halo-width': 1.8,
      },
    })

    // Floating multi-storey height badge (P+N)
    map.addLayer({
      id: PRECISE_MULTISTOREY_BADGE_LAYER,
      type: 'symbol',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.lotMin,
      filter: ['==', ['get', 'type'], 'multi_storey'],
      layout: {
        'text-field': ['get', 'floors_label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13],
        'text-offset': [0, -1.35],
        'text-anchor': 'bottom',
        'symbol-placement': 'point',
        'symbol-sort-key': 0,
        'text-padding': 2,
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': '#1C1C1E',
        'text-halo-color': '#FFFFFF',
        'text-halo-width': 2,
      },
    })
  }

  // ——— Legacy stub lot polygons (kept empty when precise GeoJSON is loaded) ———
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
        'text-padding': 4,
        'text-optional': true,
        ...noOverlapSymbol,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F8FAFC',
        'text-halo-width': 1.8,
      },
    })
  }

  // ——— Street-side parking lines from estonia_parking_master (minzoom 12) ———
  if (!map.getSource(STREET_PARKING_SOURCE)) {
    map.addSource(STREET_PARKING_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: STREET_PARKING_CASING_LAYER,
      type: 'line',
      source: STREET_PARKING_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#FFFFFF',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          3,
          15,
          5,
          18,
          10,
        ],
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          0.25,
          13,
          0.45,
          16,
          0.75,
        ],
      },
    })

    map.addLayer({
      id: STREET_PARKING_LINE_LAYER,
      type: 'line',
      source: STREET_PARKING_SOURCE,
      minzoom: ZOOM.streetMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        // Green = free, Red = paid, Blue = kellaga (from feature color)
        'line-color': ['get', 'color'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            3.5,
            2.25,
          ],
          15,
          [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            4.5,
            3,
          ],
          18,
          [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            9,
            7,
          ],
        ] as never,
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          0.7,
          14,
          0.88,
          16,
          [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            1,
            0.92,
          ],
        ] as never,
      },
    })

    map.addLayer({
      id: STREET_PARKING_HIT_LAYER,
      type: 'line',
      source: STREET_PARKING_SOURCE,
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

  // ——— Legacy viewport street lines (kept empty — GeoJSON owns curb lines) ———
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
  syncCollisionProps(map)
  applyOverlayThemePaints(map, mode)
}

/** Toggle temporary district QA reference markers. */
export function setDistrictDebugVisible(map: MapLibreMapType, visible: boolean) {
  const v = visible ? 'visible' : 'none'
  for (const id of [DISTRICT_DEBUG_CIRCLE_LAYER, DISTRICT_DEBUG_LABEL_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  }
}

/**
 * Swap district/zone polygon overlays by city.
 * Tallinn → official linnaosad; Pärnu → kesklinn/rand paid zones.
 */
export function setCityDistrictOverlays(map: MapLibreMapType, cityId: CityId) {
  const polySrc = map.getSource(DISTRICT_SOURCE) as {
    setData?: (d: unknown) => void
  } | null
  const labelSrc = map.getSource(DISTRICT_LABEL_SOURCE) as {
    setData?: (d: unknown) => void
  } | null
  if (cityId === 'parnu') {
    polySrc?.setData?.(parnuZonesToGeoJSON())
    labelSrc?.setData?.(parnuZoneLabelsToGeoJSON())
    for (const id of [
      DISTRICT_FILL_LAYER,
      DISTRICT_OUTLINE_LAYER,
      DISTRICT_SUBZONE_FILL_LAYER,
      DISTRICT_SUBZONE_OUTLINE_LAYER,
    ]) {
      try {
        if (map.getLayer(id)) map.setLayerZoomRange(id, 0, 16)
      } catch {
        /* ok */
      }
    }
    return
  }
  polySrc?.setData?.(districtsToGeoJSON())
  labelSrc?.setData?.(districtLabelsToGeoJSON())
  for (const id of [DISTRICT_FILL_LAYER, DISTRICT_OUTLINE_LAYER]) {
    try {
      if (map.getLayer(id)) map.setLayerZoomRange(id, 0, 14)
    } catch {
      /* ok */
    }
  }
}

/** Hover/active district: strengthen one feature, dim the other districts. */
export function setDistrictHover(
  map: MapLibreMapType,
  featureId: string | number | null,
) {
  const src = DISTRICT_SOURCE
  if (!map.getSource(src)) return
  const feats = map.querySourceFeatures(src)
  const ids = new Set<string | number>()
  for (const f of feats) {
    if (f.id != null) ids.add(f.id)
  }
  for (const id of ids) {
    map.setFeatureState(
      { source: src, id },
      {
        hover: featureId != null && id === featureId,
        dim: featureId != null && id !== featureId,
      },
    )
  }
}

const GEOM_LAYER_IDS = [
  PARKING_LOTS_FILL_LAYER,
  PARKING_LOTS_OUTLINE_LAYER,
  PARKING_LOTS_LABEL_LAYER,
  PRECISE_FILL_LAYER,
  'parking-fill-underground-hatch',
  PRECISE_OUTLINE_LAYER,
  PRECISE_OUTLINE_UNDERGROUND_LAYER,
  PRECISE_LABEL_LAYER,
  PRECISE_MULTISTOREY_BADGE_LAYER,
  STREET_PARKING_CASING_LAYER,
  STREET_PARKING_LINE_LAYER,
  STREET_PARKING_HIT_LAYER,
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
