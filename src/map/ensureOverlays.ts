import type { Map as MapLibreMapType } from 'maplibre-gl'
import type { ThemeMode } from '../lib/theme'
import { districtDebugRefsToGeoJSON } from '../lib/districtsGeoJSON'
import type { CityId } from '../data/cities'
import {
  parnuZoneLabelsToGeoJSON,
  parnuZonesToGeoJSON,
} from '../data/parnuZones'
import { PARKING_COLOR_PAID } from '../lib/parkingClassification'

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as never[] }

/** Tracks which city owns the district/subzone overlay so theme paints don't wipe Pärnu. */
let activeDistrictCity: CityId = 'tallinn'
/** When false, Pärnu paid-zone overlays stay hidden (e.g. Tasuta / Kellaga filter). */
let parnuPaidZonesVisible = true
/** When false, parking geom/line overlays stay hidden to avoid pre-basemap flash. */
let parkingOverlaysRevealed = false
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
/** Dashed walking leg: parking → house */
const WALK_ROUTE_SOURCE = 'nav-walk-route'
const WALK_ROUTE_LINE = 'nav-walk-route-line'
const WALK_ROUTE_CASING = 'nav-walk-route-casing'
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

  // Tallinn district fills fade by 14. Pärnu paid RED subzones stay at all zooms.
  setMax(DISTRICT_FILL_LAYER, 14)
  setMax(DISTRICT_OUTLINE_LAYER, 14)
  if (activeDistrictCity === 'parnu') {
    if (map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
      map.setLayerZoomRange(DISTRICT_SUBZONE_FILL_LAYER, 0, 24)
    }
    if (map.getLayer(DISTRICT_SUBZONE_OUTLINE_LAYER)) {
      map.setLayerZoomRange(DISTRICT_SUBZONE_OUTLINE_LAYER, 0, 24)
    }
    if (map.getLayer(DISTRICT_LABEL_LAYER)) {
      map.setLayerZoomRange(DISTRICT_LABEL_LAYER, 10, 16)
    }
  } else {
    setMax(DISTRICT_SUBZONE_FILL_LAYER, 14)
    setMax(DISTRICT_SUBZONE_OUTLINE_LAYER, 14)
    if (map.getLayer(DISTRICT_LABEL_LAYER)) {
      map.setLayerZoomRange(DISTRICT_LABEL_LAYER, 10, 13)
    }
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

  // Tallinn districts stay hidden. Pärnu paid subzones keep RED fills.
  const parnuZones =
    activeDistrictCity === 'parnu' && parnuPaidZonesVisible
  for (const id of [
    DISTRICT_FILL_LAYER,
    DISTRICT_OUTLINE_LAYER,
    DISTRICT_SUBZONE_FILL_LAYER,
    DISTRICT_SUBZONE_OUTLINE_LAYER,
    DISTRICT_LABEL_LAYER,
  ]) {
    if (!map.getLayer(id)) continue
    const showParnu =
      parnuZones &&
      (id === DISTRICT_SUBZONE_FILL_LAYER ||
        id === DISTRICT_SUBZONE_OUTLINE_LAYER ||
        id === DISTRICT_LABEL_LAYER)
    map.setLayoutProperty(id, 'visibility', showParnu ? 'visible' : 'none')
  }
  if (map.getLayer(DISTRICT_FILL_LAYER)) {
    map.setPaintProperty(DISTRICT_FILL_LAYER, 'fill-opacity', 0)
  }
  if (map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
    map.setPaintProperty(
      DISTRICT_SUBZONE_FILL_LAYER,
      'fill-opacity',
      parnuZones ? 0.28 : 0,
    )
    map.setPaintProperty(
      DISTRICT_SUBZONE_FILL_LAYER,
      'fill-color',
      ['coalesce', ['get', 'color'], PARKING_COLOR_PAID] as never,
    )
  }
  if (map.getLayer(DISTRICT_SUBZONE_OUTLINE_LAYER)) {
    map.setPaintProperty(
      DISTRICT_SUBZONE_OUTLINE_LAYER,
      'line-color',
      parnuZones
        ? (['coalesce', ['get', 'color'], PARKING_COLOR_PAID] as never)
        : dark
          ? '#c4a574'
          : (['coalesce', ['get', 'color'], '#B45309'] as never),
    )
    map.setPaintProperty(
      DISTRICT_SUBZONE_OUTLINE_LAYER,
      'line-opacity',
      parnuZones ? 0.95 : dark ? 0.7 : 0.85,
    )
    map.setPaintProperty(
      DISTRICT_SUBZONE_OUTLINE_LAYER,
      'line-width',
      parnuZones ? 2.2 : 1.5,
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

  // ——— District layers kept in style for API stability, but always empty/hidden ———
  if (!map.getSource(DISTRICT_SOURCE)) {
    map.addSource(DISTRICT_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: EMPTY_FC,
    })
  } else {
    const src = map.getSource(DISTRICT_SOURCE) as { setData?: (d: unknown) => void }
    src.setData?.(EMPTY_FC)
  }
  if (!map.getSource(DISTRICT_LABEL_SOURCE)) {
    map.addSource(DISTRICT_LABEL_SOURCE, {
      type: 'geojson',
      data: EMPTY_FC,
    })
  } else {
    const src = map.getSource(DISTRICT_LABEL_SOURCE) as {
      setData?: (d: unknown) => void
    }
    src.setData?.(EMPTY_FC)
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
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], DISTRICT_COLOR_FALLBACK],
        'fill-opacity': 0,
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
        visibility: 'none',
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
  // Paid subzones (Pärnu Kesklinn / Rand) — no maxzoom so RED areas stay at street zoom
  if (!map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
    map.addLayer({
      id: DISTRICT_SUBZONE_FILL_LAYER,
      type: 'fill',
      source: DISTRICT_SOURCE,
      filter: ['==', ['get', 'role'], 'subzone'],
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], PARKING_COLOR_PAID],
        'fill-opacity': 0,
      },
    })
  }
  if (!map.getLayer(DISTRICT_SUBZONE_OUTLINE_LAYER)) {
    map.addLayer({
      id: DISTRICT_SUBZONE_OUTLINE_LAYER,
      type: 'line',
      source: DISTRICT_SOURCE,
      filter: ['==', ['get', 'role'], 'subzone'],
      layout: {
        visibility: 'none',
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
        visibility: 'none',
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

    // Soft glow under selected lot outline (preview / detail)
    map.addLayer({
      id: 'parking-fill-outline-glow',
      type: 'line',
      source: PRECISE_PARKING_SOURCE,
      minzoom: ZOOM.lotMin,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#007AFF',
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          10,
          0,
        ] as never,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.45,
          0,
        ] as never,
        'line-blur': 3.5,
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
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          4.5,
          2,
        ] as never,
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
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          4.5,
          2,
        ] as never,
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
        visibility: 'none',
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
        visibility: 'none',
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
            5.5,
            2.25,
          ],
          15,
          [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            7,
            3,
          ],
          18,
          [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            12,
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
        visibility: 'none',
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
        visibility: 'none',
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
        visibility: 'none',
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
        visibility: 'none',
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
        visibility: 'none',
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
      lineMetrics: true,
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getSource(WALK_ROUTE_SOURCE)) {
    map.addSource(WALK_ROUTE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  const routeMain = mode === 'dark' ? '#0A84FF' : '#007AFF'
  const routeOutline = mode === 'dark' ? '#0B1220' : '#FFFFFF'
  /** Walking path — distinct teal, dashed */
  const walkMain = mode === 'dark' ? '#34D399' : '#059669'
  const walkCasing = mode === 'dark' ? '#0B1220' : '#FFFFFF'
  const routeWidthMain = [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    7,
    14,
    5.5,
    17,
    4,
  ] as never
  const routeWidthOutline = [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    12,
    14,
    9,
    17,
    7,
  ] as never
  const routeWidthGlow = [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    22,
    14,
    16,
    17,
    12,
  ] as never
  if (!map.getLayer('nav-route-glow')) {
    map.addLayer({
      id: 'nav-route-glow',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeMain,
        'line-width': routeWidthGlow,
        'line-opacity': 0.35,
        'line-blur': 8,
      },
    })
  } else {
    map.setPaintProperty('nav-route-glow', 'line-color', routeMain)
    map.setPaintProperty('nav-route-glow', 'line-width', routeWidthGlow)
    map.setPaintProperty('nav-route-glow', 'line-opacity', 0.35)
    map.setPaintProperty('nav-route-glow', 'line-blur', 8)
  }
  if (!map.getLayer('nav-route-outline')) {
    map.addLayer({
      id: 'nav-route-outline',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeOutline,
        'line-width': routeWidthOutline,
        'line-opacity': 0.95,
      },
    })
  } else {
    map.setPaintProperty('nav-route-outline', 'line-color', routeOutline)
    map.setPaintProperty('nav-route-outline', 'line-width', routeWidthOutline)
    map.setPaintProperty('nav-route-outline', 'line-opacity', 0.95)
  }
  if (!map.getLayer('nav-route-line')) {
    map.addLayer({
      id: 'nav-route-line',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeMain,
        'line-width': routeWidthMain,
        'line-opacity': 1,
      },
    })
  } else {
    map.setPaintProperty('nav-route-line', 'line-color', routeMain)
    map.setPaintProperty('nav-route-line', 'line-width', routeWidthMain)
  }

  // Walking leg — dashed teal (parking → house)
  if (!map.getLayer(WALK_ROUTE_CASING)) {
    map.addLayer({
      id: WALK_ROUTE_CASING,
      type: 'line',
      source: WALK_ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': walkCasing,
        'line-width': 7,
        'line-opacity': 0.9,
        'line-dasharray': [0.4, 1.6],
      },
    })
  } else {
    map.setPaintProperty(WALK_ROUTE_CASING, 'line-color', walkCasing)
  }
  if (!map.getLayer(WALK_ROUTE_LINE)) {
    map.addLayer({
      id: WALK_ROUTE_LINE,
      type: 'line',
      source: WALK_ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': walkMain,
        'line-width': 4,
        'line-opacity': 1,
        'line-dasharray': [0.4, 1.6],
      },
    })
  } else {
    map.setPaintProperty(WALK_ROUTE_LINE, 'line-color', walkMain)
  }
  // Soft label along the walk path
  if (!map.getLayer('nav-walk-route-label')) {
    map.addLayer({
      id: 'nav-walk-route-label',
      type: 'symbol',
      source: WALK_ROUTE_SOURCE,
      layout: {
        'symbol-placement': 'line-center',
        'text-field': 'Jalgsi',
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 4,
      },
      paint: {
        'text-color': walkMain,
        'text-halo-color': walkCasing,
        'text-halo-width': 1.6,
      },
    })
  } else {
    map.setPaintProperty('nav-walk-route-label', 'text-color', walkMain)
    map.setPaintProperty('nav-walk-route-label', 'text-halo-color', walkCasing)
  }

  syncLodZoomLimits(map)
  syncCollisionProps(map)
  applyOverlayThemePaints(map, mode)
  // Fresh style/layers start hidden — MapView reveals after basemap idle.
  parkingOverlaysRevealed = false
  setParkingOverlaysRevealed(map, false)
}

/** Toggle temporary district QA reference markers. */
export function setDistrictDebugVisible(map: MapLibreMapType, visible: boolean) {
  const v = visible ? 'visible' : 'none'
  for (const id of [DISTRICT_DEBUG_CIRCLE_LAYER, DISTRICT_DEBUG_LABEL_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  }
}

const DISTRICT_LAYER_IDS = [
  DISTRICT_FILL_LAYER,
  DISTRICT_OUTLINE_LAYER,
  DISTRICT_SUBZONE_FILL_LAYER,
  DISTRICT_SUBZONE_OUTLINE_LAYER,
  DISTRICT_LABEL_LAYER,
] as const

/**
 * Tallinn administrative districts stay hidden.
 * Pärnu shows Kesklinn / Rand paid-zone footprints (RED) as subzone overlays.
 * Pass `showPaidZones: false` under Tasuta / Kellaga so RED paid areas don't leak.
 */
export function setCityDistrictOverlays(
  map: MapLibreMapType,
  cityId: CityId,
  opts?: { showPaidZones?: boolean },
) {
  activeDistrictCity = cityId
  if (opts?.showPaidZones != null) parnuPaidZonesVisible = opts.showPaidZones

  const polySrc = map.getSource(DISTRICT_SOURCE) as {
    setData?: (d: unknown) => void
  } | null
  const labelSrc = map.getSource(DISTRICT_LABEL_SOURCE) as {
    setData?: (d: unknown) => void
  } | null

  if (cityId === 'parnu') {
    if (!map.getSource(DISTRICT_SOURCE)) return
    polySrc?.setData?.(parnuZonesToGeoJSON())
    labelSrc?.setData?.(parnuZoneLabelsToGeoJSON())
    const showIds = new Set([
      DISTRICT_SUBZONE_FILL_LAYER,
      DISTRICT_SUBZONE_OUTLINE_LAYER,
      DISTRICT_LABEL_LAYER,
    ])
    for (const id of DISTRICT_LAYER_IDS) {
      try {
        if (map.getLayer(id)) {
          map.setLayoutProperty(
            id,
            'visibility',
            parnuPaidZonesVisible && showIds.has(id) ? 'visible' : 'none',
          )
        }
      } catch {
        /* ok */
      }
    }
    // Drop legacy maxzoom so RED paid zones remain visible when zoomed in
    for (const id of [
      DISTRICT_SUBZONE_FILL_LAYER,
      DISTRICT_SUBZONE_OUTLINE_LAYER,
    ]) {
      if (map.getLayer(id)) map.setLayerZoomRange(id, 0, 24)
    }
    if (map.getLayer(DISTRICT_LABEL_LAYER)) {
      map.setLayerZoomRange(DISTRICT_LABEL_LAYER, 10, 16)
    }
    if (map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
      map.setPaintProperty(
        DISTRICT_SUBZONE_FILL_LAYER,
        'fill-opacity',
        parnuPaidZonesVisible ? 0.28 : 0,
      )
      map.setPaintProperty(
        DISTRICT_SUBZONE_FILL_LAYER,
        'fill-color',
        ['coalesce', ['get', 'color'], PARKING_COLOR_PAID] as never,
      )
    }
    if (map.getLayer(DISTRICT_SUBZONE_OUTLINE_LAYER)) {
      map.setPaintProperty(
        DISTRICT_SUBZONE_OUTLINE_LAYER,
        'line-color',
        ['coalesce', ['get', 'color'], PARKING_COLOR_PAID] as never,
      )
      map.setPaintProperty(DISTRICT_SUBZONE_OUTLINE_LAYER, 'line-opacity', 0.95)
      map.setPaintProperty(DISTRICT_SUBZONE_OUTLINE_LAYER, 'line-width', 2.2)
    }
    return
  }

  polySrc?.setData?.(EMPTY_FC)
  labelSrc?.setData?.(EMPTY_FC)
  for (const id of DISTRICT_LAYER_IDS) {
    try {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', 'none')
      }
    } catch {
      /* ok */
    }
  }
  if (map.getLayer(DISTRICT_SUBZONE_FILL_LAYER)) {
    map.setPaintProperty(DISTRICT_SUBZONE_FILL_LAYER, 'fill-opacity', 0)
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

/** When false, parking geom/line overlays stay hidden to avoid pre-basemap flash. */
const LINE_OVERLAY_LAYER_IDS = [
  STREET_PARKING_CASING_LAYER,
  STREET_PARKING_LINE_LAYER,
  STREET_PARKING_HIT_LAYER,
  PARKING_LINES_CASING_LAYER,
  PARKING_LINES_GLOW_LAYER,
  PARKING_LINES_LAYER,
  'parking-street-lines-hit',
] as const

const GEOM_LAYER_IDS = [
  PARKING_LOTS_FILL_LAYER,
  PARKING_LOTS_OUTLINE_LAYER,
  PARKING_LOTS_LABEL_LAYER,
  'parking-fill-outline-glow',
  PRECISE_FILL_LAYER,
  'parking-fill-underground-hatch',
  PRECISE_OUTLINE_LAYER,
  PRECISE_OUTLINE_UNDERGROUND_LAYER,
  PRECISE_LABEL_LAYER,
  PRECISE_MULTISTOREY_BADGE_LAYER,
  ...LINE_OVERLAY_LAYER_IDS,
] as const

/**
 * Hide parking polygons + curb lines until the basemap has finished its first
 * paint. Prevents blue/colored line flash on a blank white canvas.
 */
export function setParkingOverlaysRevealed(
  map: MapLibreMapType,
  revealed: boolean,
) {
  parkingOverlaysRevealed = revealed
  const vis = revealed ? 'visible' : 'none'
  for (const id of GEOM_LAYER_IDS) {
    if (map.getLayer(id)) {
      try {
        map.setLayoutProperty(id, 'visibility', vis)
      } catch {
        /* layer may be mid-remove during setStyle */
      }
    }
  }
}

/**
 * Stack order (bottom → top): lot polygons → curb/line overlays → pin circles
 * → symbol/label layers. Lines sit above fills but strictly below icons.
 */
export function orderParkingOverlayStack(map: MapLibreMapType) {
  const stack: string[] = [
    PARKING_LOTS_FILL_LAYER,
    PRECISE_FILL_LAYER,
    'parking-fill-underground-hatch',
    PARKING_LOTS_OUTLINE_LAYER,
    'parking-fill-outline-glow',
    PRECISE_OUTLINE_LAYER,
    PRECISE_OUTLINE_UNDERGROUND_LAYER,
    // Line overlays above polygons
    STREET_PARKING_CASING_LAYER,
    STREET_PARKING_LINE_LAYER,
    STREET_PARKING_HIT_LAYER,
    PARKING_LINES_CASING_LAYER,
    PARKING_LINES_GLOW_LAYER,
    PARKING_LINES_LAYER,
    'parking-street-lines-hit',
    // Point / circle pins above lines
    ...PARKING_PROVIDERS.map((k) => PARKING_LAYER_META[k].id),
    // Symbols / labels on top of circles
    PARKING_LOTS_LABEL_LAYER,
    PRECISE_LABEL_LAYER,
    PRECISE_MULTISTOREY_BADGE_LAYER,
    ...PARKING_PROVIDERS.map((k) => `${PARKING_LAYER_META[k].id}-label`),
  ]
  for (const id of stack) {
    if (!map.getLayer(id)) continue
    try {
      map.moveLayer(id)
    } catch {
      /* ok */
    }
  }
}

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
      map.setLayoutProperty(
        id,
        'visibility',
        parkingOverlaysRevealed ? 'visible' : 'none',
      )
    }
  }
}

export { ROUTE_SOURCE, WALK_ROUTE_SOURCE, WALK_ROUTE_LINE, WALK_ROUTE_CASING }
