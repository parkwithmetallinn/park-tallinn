import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type Map as MapLibreMapType,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { spotsToMapGeoJSON } from '../lib/geojson'
import { queryParkingInViewport } from '../lib/parkingRepository'
import {
  featureBounds,
  filterPreciseCollection,
  getLastPolygonPurgeStats,
  PRECISE_FILL_LAYER,
  PRECISE_LABEL_LAYER,
  PRECISE_MULTISTOREY_BADGE_LAYER,
  PRECISE_OUTLINE_LAYER,
  PRECISE_OUTLINE_UNDERGROUND_LAYER,
  PRECISE_PARKING_SOURCE,
  preciseCollectionToSpots,
  preciseFeatureToSpot,
  type PreciseParkingCollection,
  type PreciseParkingFeature,
} from '../lib/preciseParkingPolygons'
import {
  applyVerifiedTypeToProps,
  type ProposedParkingType,
  type TypeVoteVerification,
} from '../lib/typeVotes'
import {
  STREET_PARKING_HIT_LAYER,
  STREET_PARKING_LINE_LAYER,
  STREET_PARKING_SOURCE,
  streetFeatureToSpot,
  type StreetParkingCollection,
  type StreetParkingFeature,
} from '../lib/streetParkingLines'
import {
  getCachedCityPolygons,
  loadCityParking,
} from '../lib/cityParkingCache'
import { parkingIndex } from '../lib/spatialIndex'
import {
  routeCoordsToLngLat,
  type RouteResult,
} from '../lib/routing'
import { distanceMeters } from '../lib/geo'
import type { ThemeMode } from '../lib/theme'
import type { CityId } from '../data/cities'
import {
  MY_PIN_COLORS,
  type MyPin,
  type MyPinColor,
} from '../lib/myPins'
import {
  ESTONIA_MAP_MAX_BOUNDS,
  ESTONIA_MAP_MIN_ZOOM,
} from '../data/cities'
import { createBasemapStyle } from '../map/createBasemapStyle'
import {
  DISTRICT_FILL_LAYER,
  DISTRICT_SUBZONE_FILL_LAYER,
  ensureParkingOverlaySources,
  orderParkingOverlayStack,
  ROUTE_SOURCE,
  WALK_ROUTE_CASING,
  WALK_ROUTE_GLOW,
  WALK_ROUTE_LINE,
  WALK_ROUTE_SOURCE,
  setCityDistrictOverlays,
  setDistrictDebugVisible,
  setDistrictHover,
  setParkingLayerVisibility,
  setParkingOverlaysRevealed,
  setParkingTextLabelsVisible,
} from '../map/ensureOverlays'
import {
  PARKING_LAYER_META,
  PARKING_PROVIDERS,
  PARKING_VIEWPORT_SOURCE,
} from '../map/parkingLayers'
import {
  PARKING_LINES_LAYER,
  PARKING_LINES_SOURCE,
  PARKING_LOTS_FILL_LAYER,
  PARKING_LOTS_LABEL_LAYER,
  PARKING_LOTS_SOURCE,
} from '../map/streetLineTheme'
import {
  disableSymbolLayerFades,
  SYMBOL_NO_FADE_PAINT,
} from '../map/symbolFade'
import { NAV_PITCH } from '../map/theme'
import {
  DETAIL_FADE,
  DETAIL_FADE_START_ZOOM,
  getParkingOpacity,
  isParkingInteractiveAtZoom,
  PARKING_FADE,
  PARKING_FADE_START_ZOOM,
  STREET_FADE,
} from '../map/parkingFade'
import { ZOOM } from '../map/zoom'
import {
  getParkingFilterCategory,
  isUnclassifiedParking,
} from '../lib/parkingClassification'
import { tKey } from '../i18n'
import {
  ensureEvChargerLayers,
  EV_CHARGERS_CIRCLE_LAYER,
  EV_CHARGERS_GLOW_LAYER,
  EV_CHARGERS_HIT_LAYER,
  EV_CHARGERS_SOURCE,
  EV_CHARGERS_SYMBOL_LAYER,
  evFeatureToSpot,
  filterEvCollection,
  loadEvChargers,
  setEvChargerData,
  setEvChargerVisibility,
  type EvChargerCollection,
  type EvChargerFeature,
} from '../lib/evChargers'
import type { FilterId, ParkingLayerKey, ParkingSpot } from '../types'
import {
  applyCommunityStatusToElement,
  createCommunityStatusElement,
  type CommunityMarkerStatus,
} from '../lib/fullIndicatorDom'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`)

const SELECT_SOURCES = [
  PARKING_LINES_SOURCE,
  PARKING_LOTS_SOURCE,
  PARKING_VIEWPORT_SOURCE,
  PRECISE_PARKING_SOURCE,
  STREET_PARKING_SOURCE,
  EV_CHARGERS_SOURCE,
] as const

const PRECISE_HIT_LAYERS = [
  PRECISE_FILL_LAYER,
  PRECISE_OUTLINE_LAYER,
  PRECISE_OUTLINE_UNDERGROUND_LAYER,
  PRECISE_LABEL_LAYER,
  PRECISE_MULTISTOREY_BADGE_LAYER,
  'parking-fill-underground-hatch',
] as const

const STREET_HIT_LAYERS = [STREET_PARKING_LINE_LAYER, STREET_PARKING_HIT_LAYER] as const

const EV_HIT_LAYERS = [
  EV_CHARGERS_HIT_LAYER,
  EV_CHARGERS_CIRCLE_LAYER,
  EV_CHARGERS_SYMBOL_LAYER,
] as const

export type NearestMapPill = {
  id: string
  lat: number
  lng: number
  label: string
  tone: 'free' | 'clock' | 'paid' | 'other'
}

/** Native GL price pills — glued to coords (no HTML Marker jitter). */
export const NEAREST_PILLS_SOURCE = 'nearest-price-pills'
export const NEAREST_PILLS_BG_LAYER = 'nearest-price-pills-bg'
export const NEAREST_PILLS_TEXT_LAYER = 'nearest-price-pills-text'
export const NEAREST_PILLS_HIT_LAYER = 'nearest-price-pills-hit'
const NEAREST_PILL_HIT_LAYERS = [
  NEAREST_PILLS_HIT_LAYER,
  NEAREST_PILLS_TEXT_LAYER,
  NEAREST_PILLS_BG_LAYER,
] as const

/** Dashed preview link: destination ↔ selected nearest parking. */
export const PREVIEW_LINK_SOURCE = 'preview-dest-link'
export const PREVIEW_LINK_LAYER = 'preview-dest-link-line'
export const PREVIEW_LINK_HALO = 'preview-dest-link-halo'

function ensureNearestPricePillLayers(map: MapLibreMapType) {
  if (!map.getSource(NEAREST_PILLS_SOURCE)) {
    map.addSource(NEAREST_PILLS_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(NEAREST_PILLS_BG_LAYER)) {
    map.addLayer({
      id: NEAREST_PILLS_BG_LAYER,
      type: 'circle',
      source: NEAREST_PILLS_SOURCE,
      paint: {
        'circle-radius': [
          'case',
          ['boolean', ['get', 'active'], false],
          26,
          18,
        ],
        'circle-color': [
          'case',
          ['boolean', ['get', 'active'], false],
          '#FFF6BF',
          [
            'match',
            ['get', 'tone'],
            'free',
            '#ECFDF5',
            'clock',
            '#FFFBEB',
            'paid',
            '#FEF2F2',
            '#F8FAFC',
          ],
        ],
        'circle-stroke-width': [
          'case',
          ['boolean', ['get', 'active'], false],
          4,
          2,
        ],
        'circle-stroke-color': [
          'case',
          ['boolean', ['get', 'active'], false],
          '#007AFF',
          [
            'match',
            ['get', 'tone'],
            'free',
            '#22C55E',
            'clock',
            '#FFD60A',
            'paid',
            '#FF3B30',
            '#C7C7CC',
          ],
        ],
        'circle-opacity': 0.96,
        'circle-pitch-alignment': 'viewport',
        'circle-pitch-scale': 'viewport',
      },
    })
  }

  if (!map.getLayer(NEAREST_PILLS_TEXT_LAYER)) {
    map.addLayer({
      id: NEAREST_PILLS_TEXT_LAYER,
      type: 'symbol',
      source: NEAREST_PILLS_SOURCE,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': [
          'case',
          ['boolean', ['get', 'active'], false],
          12,
          11,
        ],
        // Collision-safe — prevents "KI" + "15 MIN" merging into "KI15 MINN"
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'text-padding': 6,
        'text-optional': false,
        'text-anchor': 'center',
        'text-pitch-alignment': 'viewport',
        'text-rotation-alignment': 'viewport',
        'symbol-sort-key': [
          'case',
          ['boolean', ['get', 'active'], false],
          0,
          1,
        ],
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'tone'],
          'free',
          '#15803D',
          'clock',
          '#8A6D00',
          'paid',
          '#D70015',
          '#636366',
        ],
        'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.2,
        ...SYMBOL_NO_FADE_PAINT,
      },
    })
  }

  if (!map.getLayer(NEAREST_PILLS_HIT_LAYER)) {
    map.addLayer({
      id: NEAREST_PILLS_HIT_LAYER,
      type: 'circle',
      source: NEAREST_PILLS_SOURCE,
      paint: {
        'circle-radius': 26,
        'circle-opacity': 0.01,
        'circle-color': '#000000',
        'circle-pitch-alignment': 'viewport',
      },
    })
  }

  // Keep pills above parking overlays
  for (const id of [
    NEAREST_PILLS_BG_LAYER,
    NEAREST_PILLS_TEXT_LAYER,
    NEAREST_PILLS_HIT_LAYER,
  ]) {
    if (map.getLayer(id)) {
      try {
        map.moveLayer(id)
      } catch {
        /* ok */
      }
    }
  }
}

/** Drop pills that sit on top of each other (keeps active + first of each cluster). */
function dedupePillsByProximity(
  pills: NearestMapPill[],
  activeId: string | null,
  minMeters = 28,
): NearestMapPill[] {
  if (pills.length <= 1) return pills
  const ranked = [...pills].sort((a, b) => {
    if (a.id === activeId) return -1
    if (b.id === activeId) return 1
    return 0
  })
  const kept: NearestMapPill[] = []
  const mPerDegLat = 111_320
  for (const p of ranked) {
    const clash = kept.some((k) => {
      const dLat = (p.lat - k.lat) * mPerDegLat
      const dLng =
        (p.lng - k.lng) * mPerDegLat * Math.cos((p.lat * Math.PI) / 180)
      return Math.hypot(dLat, dLng) < minMeters
    })
    if (!clash) kept.push(p)
  }
  return kept
}

function setNearestPricePillData(
  map: MapLibreMapType,
  pills: NearestMapPill[],
  activeId: string | null,
) {
  ensureNearestPricePillLayers(map)
  const src = map.getSource(NEAREST_PILLS_SOURCE)
  if (!src || !('setData' in src) || typeof src.setData !== 'function') return
  const visible = dedupePillsByProximity(pills, activeId)
  src.setData({
    type: 'FeatureCollection',
    features: visible.map((p) => ({
      type: 'Feature',
      id: p.id,
      properties: {
        id: p.id,
        // Normalize whitespace so "15 MIN" never glues to a neighbor glyph
        label: String(p.label || '').replace(/\s+/g, ' ').trim(),
        tone: p.tone,
        active: p.id === activeId,
      },
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat],
      },
    })),
  })
}

function ensurePreviewLinkLayers(map: MapLibreMapType) {
  if (!map.getSource(PREVIEW_LINK_SOURCE)) {
    map.addSource(PREVIEW_LINK_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer(PREVIEW_LINK_HALO)) {
    map.addLayer({
      id: PREVIEW_LINK_HALO,
      type: 'line',
      source: PREVIEW_LINK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#007AFF',
        'line-width': 7,
        'line-opacity': 0.22,
        // Dotted = pedestrian preview (distinct from solid drive route)
        'line-dasharray': [0.15, 1.8],
      },
    })
  }
  if (!map.getLayer(PREVIEW_LINK_LAYER)) {
    map.addLayer({
      id: PREVIEW_LINK_LAYER,
      type: 'line',
      source: PREVIEW_LINK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#007AFF',
        'line-width': 2.75,
        'line-opacity': 0.92,
        // Dotted = pedestrian preview (distinct from solid drive route)
        'line-dasharray': [0.15, 1.8],
      },
    })
  }
}

/** Pedestrian preview path — [lng, lat][] from OSRM foot (never a building chord). */
function setPreviewLinkData(
  map: MapLibreMapType,
  coordinates: [number, number][] | null,
) {
  ensurePreviewLinkLayers(map)
  const src = map.getSource(PREVIEW_LINK_SOURCE) as GeoJSONSource | undefined
  if (!src) return
  if (!coordinates || coordinates.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  src.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    ],
  })
}

/** Pulsating blue GPS marker for the device's current position. */
function makeUserEl(): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'user-location-wrap'
  wrap.setAttribute('aria-hidden', 'true')
  wrap.innerHTML = `<div class="user-pulse"></div><div class="user-dot"></div>`
  return wrap
}

function makeSearchPinEl(onClick: () => void) {
  const wrap = document.createElement('button')
  wrap.type = 'button'
  wrap.className = 'search-pin'
  wrap.setAttribute('aria-label', tKey('pins.openInfo'))
  wrap.innerHTML = `<span class="search-pin-dot"></span>`
  wrap.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return wrap
}

/**
 * Personal pins use HTML Markers (same pattern as search / user markers)
 * so we get a custom teardrop, name label, drag, and click without mixing
 * into parking GeoJSON symbol layers.
 */
function makeMyPinEl(opts: {
  color: string
  name: string
  compact: boolean
  selected: boolean
  draft?: boolean
  dark: boolean
  onClick?: () => void
}): HTMLButtonElement {
  const wrap = document.createElement('button')
  wrap.type = 'button'
  wrap.className = [
    'my-pin-marker',
    opts.compact ? 'is-compact' : '',
    opts.selected ? 'is-selected' : '',
    opts.draft ? 'my-pin-draft' : '',
  ]
    .filter(Boolean)
    .join(' ')
  wrap.setAttribute('aria-label', opts.name || tKey('pins.myPin'))
  wrap.innerHTML = `
    <span class="my-pin-shadow" aria-hidden="true"></span>
    <span class="my-pin-teardrop" style="background:${opts.color}">
      <span class="my-pin-inner"></span>
    </span>
    <span class="my-pin-label" ${opts.compact ? 'hidden' : ''}>${escapeHtml(opts.name)}</span>
  `
  if (opts.dark) wrap.dataset.dark = '1'
  wrap.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    opts.onClick?.()
  })
  // Long-press on a pin should not start a new draft on the map canvas
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation())
  return wrap
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function updateMyPinEl(
  el: HTMLElement,
  opts: {
    color: string
    name: string
    compact: boolean
    selected: boolean
    dark: boolean
  },
) {
  el.classList.toggle('is-compact', opts.compact)
  el.classList.toggle('is-selected', opts.selected)
  el.setAttribute('aria-label', opts.name || tKey('pins.myPin'))
  const tear = el.querySelector('.my-pin-teardrop') as HTMLElement | null
  if (tear) tear.style.background = opts.color
  const label = el.querySelector('.my-pin-label') as HTMLElement | null
  if (label) {
    label.textContent = opts.name
    label.hidden = opts.compact
  }
}


/** Stable marker payloads — memoized so pan/zoom does not rebuild HTML markers. */
type CommunityStatusMarker = {
  id: string
  lat: number
  lng: number
  status: CommunityMarkerStatus
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  try {
    if (document.documentElement.dataset.animations === 'off') return true
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function waitMoveEnd(map: MapLibreMapType, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      resolve()
    }
    map.once('moveend', finish)
    const timer = window.setTimeout(finish, timeoutMs)
  })
}

function delay(ms: number, signal?: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(), ms)
    if (signal) {
      const iv = window.setInterval(() => {
        if (signal.cancelled) {
          window.clearTimeout(t)
          window.clearInterval(iv)
          resolve()
        }
      }, 40)
    }
  })
}

/** Imperative camera API for the auto-route intro (avoids fighting flyTarget). */
export type MapViewHandle = {
  /**
   * Zoom in on parking → pause → fitBounds over both legs.
   * Driving route is user → parking; walking route is parking → destination.
   * Opens the info sheet via onBeforeFitBounds before the zoom-out.
   */
  playRouteIntro: (args: {
    /** Final destination (house / address) [lat, lng] */
    house: [number, number]
    /** Selected parking [lat, lng] — drive target */
    parking: [number, number]
    /** User start [lat, lng] — included in final fit when nearby */
    origin?: [number, number]
    waitForRoute: Promise<RouteResult | null>
    waitForWalkRoute?: Promise<RouteResult | null>
    routeWaitMs?: number
    onBeforeFitBounds?: (
      drive: RouteResult | null,
      walk: RouteResult | null,
    ) => void
    onFailed?: () => void
  }) => Promise<'fitted' | 'near' | 'failed' | 'cancelled'>
  cancelRouteIntro: () => void
}

/**
 * Map top filter chip → layer filter mode.
 * "Tasuta" → unlimited free only (verified_free / free_street, no clock).
 * "Kellaga" → clock-limited free (timed layer + free_minutes windows).
 * "Elektriautolaadijad" → hide parking geometry; EV source shown separately.
 */
function filterToLayers(
  filter: FilterId,
):
  | ParkingLayerKey[]
  | 'all'
  | 'verified_free'
  | 'clock'
  | 'unclassified'
  | 'paid'
  | 'ev'
  | 'alerts' {
  if (filter === 'all') return 'all'
  if (filter === 'free_street') return 'verified_free'
  if (filter === 'timed') return 'clock'
  if (filter === 'paid') return 'paid'
  if (filter === 'other') return 'unclassified'
  if (filter === 'ev') return 'ev'
  if (filter === 'alerts') return 'alerts'
  return 'all'
}

function withoutSuppressed<T extends { properties: { id: string } }>(
  features: T[],
  suppressed: Set<string>,
): T[] {
  if (suppressed.size === 0) return features
  return features.filter((f) => !suppressed.has(f.properties.id))
}

/** Pärnu EV charger polygons are not rendered on the map. */
function withoutParnuEvFeatures<
  T extends { properties: { layer?: string; badge?: string } },
>(features: T[], cityId: CityId): T[] {
  if (cityId !== 'parnu') return features
  return features.filter(
    (f) => f.properties.layer !== 'ev' && f.properties.badge !== 'EV',
  )
}

/**
 * Apply moderation suppress list, spatial dedupe (polygon > street), then
 * top filter chips — both GeoJSON sources update together.
 */
function patchFeaturesWithTypeVotes<
  T extends { properties: { id: string } & Record<string, unknown> },
>(
  features: T[],
  typeVotes: Map<string, TypeVoteVerification>,
): T[] {
  if (typeVotes.size === 0) return features
  return features.map((f) => {
    const v = typeVotes.get(f.properties.id)
    if (!v) return f
    return {
      ...f,
      properties: applyVerifiedTypeToProps(
        f.properties,
        v.verifiedType as ProposedParkingType,
      ),
    }
  })
}

function applyDualLayerFilter(
  map: MapLibreMapType,
  filter: FilterId,
  preciseFc: PreciseParkingCollection | null,
  streetFc: StreetParkingCollection | null,
  suppressedIds: Set<string> = new Set(),
  cityId: CityId = 'tallinn',
  alertIds: Set<string> = new Set(),
  typeVotes: Map<string, TypeVoteVerification> = new Map(),
) {
  const layers = filterToLayers(filter)

  // Pärnu RED paid-zone overlays only under Kõik / Tasuline
  if (cityId === 'parnu') {
    setCityDistrictOverlays(map, 'parnu', {
      showPaidZones: filter === 'all' || filter === 'paid',
    })
  }

  // EV-only filter: clear parking geometry so cyan chargers stand alone
  if (layers === 'ev') {
    const empty = { type: 'FeatureCollection' as const, features: [] }
    ;(map.getSource(PRECISE_PARKING_SOURCE) as GeoJSONSource | undefined)?.setData(
      empty,
    )
    ;(map.getSource(STREET_PARKING_SOURCE) as GeoJSONSource | undefined)?.setData(
      empty,
    )
    return
  }

  // Community alerts only — keep lots/streets that have an active isFull report
  if (layers === 'alerts') {
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const keep = (id: string) => alertIds.has(id)
    const polysAlerts: PreciseParkingCollection = preciseFc
      ? {
          type: 'FeatureCollection',
          features: patchFeaturesWithTypeVotes(
            withoutParnuEvFeatures(
              withoutSuppressed(preciseFc.features, suppressedIds).filter((f) =>
                keep(f.properties.id),
              ),
              cityId,
            ),
            typeVotes,
          ),
        }
      : empty
    const streetsAlerts: StreetParkingCollection = streetFc
      ? {
          type: 'FeatureCollection',
          features: patchFeaturesWithTypeVotes(
            withoutParnuEvFeatures(
              withoutSuppressed(streetFc.features, suppressedIds).filter((f) =>
                keep(f.properties.id),
              ),
              cityId,
            ),
            typeVotes,
          ),
        }
      : empty
    ;(map.getSource(PRECISE_PARKING_SOURCE) as GeoJSONSource | undefined)?.setData(
      polysAlerts as never,
    )
    ;(map.getSource(STREET_PARKING_SOURCE) as GeoJSONSource | undefined)?.setData(
      streetsAlerts as never,
    )
    return
  }

  const polys: PreciseParkingCollection | null = preciseFc
    ? {
        type: 'FeatureCollection',
        features: patchFeaturesWithTypeVotes(
          withoutParnuEvFeatures(
            withoutSuppressed(preciseFc.features, suppressedIds),
            cityId,
          ),
          typeVotes,
        ),
      }
    : null

  let streets: StreetParkingCollection | null = streetFc
    ? {
        type: 'FeatureCollection',
        features: patchFeaturesWithTypeVotes(
          withoutParnuEvFeatures(
            withoutSuppressed(streetFc.features, suppressedIds),
            cityId,
          ),
          typeVotes,
        ),
      }
    : null

  // Absolute ban: never render street-network / curb polyline overlays
  streets = { type: 'FeatureCollection', features: [] }

  if (polys) {
    const src = map.getSource(PRECISE_PARKING_SOURCE) as GeoJSONSource | undefined
    src?.setData(filterPreciseCollection(polys, layers) as never)
  }
  if (streets) {
    const src = map.getSource(STREET_PARKING_SOURCE) as GeoJSONSource | undefined
    src?.setData(streets as never)
  }
}

function applySelectionHighlight(map: MapLibreMapType, selectedId: string | null) {
  const prev = (map as MapLibreMapType & { __selectedId?: string | null }).__selectedId
  if (prev) {
    for (const source of SELECT_SOURCES) {
      if (!map.getSource(source)) continue
      try {
        map.setFeatureState({ source, id: prev }, { selected: false })
      } catch {
        /* feature may be gone after data refresh */
      }
    }
  }
  ;(map as MapLibreMapType & { __selectedId?: string | null }).__selectedId = selectedId
  if (!selectedId) return
  for (const source of SELECT_SOURCES) {
    if (!map.getSource(source)) continue
    try {
      map.setFeatureState({ source, id: selectedId }, { selected: true })
    } catch {
      /* ok — feature not in this source */
    }
  }
}

/** Tap/click preview highlight (nearest-parking picker — no hover). */
function applyHoverHighlight(map: MapLibreMapType, hoverId: string | null) {
  const prev = (map as MapLibreMapType & { __hoverId?: string | null }).__hoverId
  const selected = (map as MapLibreMapType & { __selectedId?: string | null })
    .__selectedId
  if (prev && prev !== selected) {
    for (const source of SELECT_SOURCES) {
      if (!map.getSource(source)) continue
      try {
        map.setFeatureState({ source, id: prev }, { selected: false })
      } catch {
        /* ok */
      }
    }
  }
  ;(map as MapLibreMapType & { __hoverId?: string | null }).__hoverId = hoverId
  if (!hoverId || hoverId === selected) return
  for (const source of SELECT_SOURCES) {
    if (!map.getSource(source)) continue
    try {
      map.setFeatureState({ source, id: hoverId }, { selected: true })
    } catch {
      /* ok */
    }
  }
}


type CameraPadMode = 'closed' | 'detail' | 'nearest'

/**
 * Camera padding so the focus point sits in the free map area.
 * Top chrome is search + filter pills only — route/distance summary lives
 * inside the detail panel (never a floating banner over the filters).
 */
function panelCameraPadding(
  panelOpen: boolean,
  mode: CameraPadMode = 'detail',
): {
  top: number
  bottom: number
  left: number
  right: number
} {
  const desktop =
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 640px)').matches
  if (!panelOpen) {
    return { top: 104, bottom: 48, left: 24, right: 56 }
  }
  if (desktop) {
    // Left rail panel (~22rem) + search/filters along the top
    return { top: 104, bottom: 48, left: 380, right: 56 }
  }
  // Mobile sheets are max-h-[45dvh] — keep the focus in the visible upper ~55%
  const bottom = Math.max(280, Math.round(window.innerHeight * 0.45))
  if (mode === 'nearest') {
    return { top: 80, bottom, left: 40, right: 40 }
  }
  return { top: 80, bottom, left: 24, right: 24 }
}

export const MapView = memo(forwardRef<
  MapViewHandle,
  {
    spots: ParkingSpot[]
    filter: FilterId
    /** Basemap + overlay theme (light | dark). */
    theme?: ThemeMode
    userLocation: [number, number]
    /** When true, ease the camera to each live GPS update (follow me). */
    followUser?: boolean
    /** Fired on user pan/zoom/rotate — parent should disable follow. */
    onUserMapGesture?: () => void
    flyTarget: [number, number] | null
    flyKey: number
    flyZoom?: number
    /** `fly` = MapLibre flyTo (search); `ease` = easeTo (recenter). */
    flyMode?: 'fly' | 'ease'
    /** When true, use Apple Maps–style pitched 3D; when false, flat 2D. */
    pitch3d?: boolean
    selectedId?: string | null
    /**
     * Parking feature id for map pin/polygon highlight (selected / preview).
     * Must match GeoJSON feature ids — not nearest optionKey.
     */
    highlightId?: string | null
    /**
     * Active nearest-pill optionKey (price pill halo). Separate from
     * highlightId because optionKey may differ from spot.id.
     */
    nearestActivePillId?: string | null
    /** Glass price pills above nearest parking options (no numeric ranks).
     * Parent supplies already-clustered / category-diverse optionKeys from
     * collectNearestAround — MapView does not re-expand street segments. */
    nearestPills?: NearestMapPill[]
    /** Frame destination + all nearest pills (fit once when fitAll). */
    previewFocus?: {
      target: { lat: number; lng: number }
      parking?: { lat: number; lng: number }
      /** When true, fit all nearestPills + target (picker open). */
      fitAll?: boolean
      /**
       * Pedestrian OSRM geometry parking→destination as [lng, lat][].
       * Dashed preview link; omit/empty while loading (no straight-line fallback).
       */
      walkPath?: [number, number][] | null
    } | null
    /** Map pill tap → preview selection (parent must not confirm/route). */
    onNearestPillClick?: (id: string) => void
    /** Dropped search / address pin */
    searchPin?: { lat: number; lng: number } | null
    onSearchPinClick?: () => void
    /** Driving route (user → parking) */
    route: RouteResult | null
    /** Walking route (parking → house), dashed on the map */
    walkRoute?: RouteResult | null
    navigating: boolean
    onNavigate: (spot: ParkingSpot) => void
    /** EV charger marker tap — open glass preview (not parking detail). */
    onEvChargerSelect?: (feature: EvChargerFeature) => void
    /** Empty map tap — close sheets / search popup. */
    onBackgroundClick?: () => void
    onZoomChange?: (zoom: number, mode: 'district' | 'cluster' | 'street') => void
    onViewportStats?: (stats: { rendered: number; skipped: boolean }) => void
    /** Precise GeoJSON lots registered into the app index. */
    onPreciseSpotsLoaded?: (spots: ParkingSpot[]) => void
    /** Street LineString parking from GeoJSON. */
    onStreetSpotsLoaded?: (spots: ParkingSpot[]) => void
    /** Fired once when basemap style is ready (for skeleton fade-out). */
    onMapReady?: () => void
    /** Admin-approved REPORT_INVALID suppressions (never mutates production GeoJSON). */
    suppressedFeatureIds?: Set<string> | string[]
    /** Crowdsourced "lot is full" marks (60 min TTL) — compact pulse indicators. */
    fullSpotIds?: Set<string> | string[]
    /** Community "vabu kohti" report ids (green markers). */
    freeSpotIds?: Set<string> | string[]
    /** Community-verified parking types (unknown → FREE/TIMED/PAID). */
    typeVerifications?: Map<string, TypeVoteVerification>
    /** Left/bottom info panel open — shift camera so pin stays visible. */
    infoPanelOpen?: boolean
    /** Active city layer (Tallinn default — keeps existing data path). */
    cityId?: CityId
    /** Personal pins (local-only). */
    myPins?: MyPin[]
    /** Draft pin while naming sheet is open (create flow). */
    draftPin?: { lat: number; lng: number; color?: MyPinColor } | null
    /** Currently edited pin id (highlight + optional drag). */
    editingPinId?: string | null
    /** Enable drag on the editing pin marker. */
    pinDragEnabled?: boolean
    onLongPress?: (coords: { lat: number; lng: number }) => void
    onMyPinClick?: (pin: MyPin) => void
    onMyPinDragEnd?: (pinId: string, coords: { lat: number; lng: number }) => void
  }
>(function MapView(
  {
    spots,
    filter,
    theme = 'light',
    userLocation,
    followUser = false,
    onUserMapGesture,
    flyTarget,
    flyKey,
    flyZoom,
    flyMode = 'ease',
    pitch3d = true,
    selectedId = null,
    highlightId = null,
    nearestActivePillId = null,
    nearestPills = [],
    previewFocus = null,
    onNearestPillClick,
    searchPin = null,
    onSearchPinClick,
    route,
    walkRoute = null,
    navigating,
    onNavigate,
    onEvChargerSelect,
    onBackgroundClick,
    onZoomChange,
    onViewportStats,
    onPreciseSpotsLoaded,
    onStreetSpotsLoaded,
    onMapReady,
    suppressedFeatureIds,
    fullSpotIds,
    freeSpotIds,
    typeVerifications,
    infoPanelOpen = false,
    cityId = 'tallinn',
    myPins = [],
    draftPin = null,
    editingPinId = null,
    pinDragEnabled = false,
    onLongPress,
    onMyPinClick,
    onMyPinDragEnd,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const searchMarkerRef = useRef<Marker | null>(null)
  const parkHandoverMarkerRef = useRef<Marker | null>(null)
  const walkMidMarkerRef = useRef<Marker | null>(null)
  const fullMarkersRef = useRef<Map<string, Marker>>(new Map())
  /** Personal pin HTML markers — incremental by id (not rebuilt each render). */
  const myPinMarkersRef = useRef<Map<string, Marker>>(new Map())
  const draftPinMarkerRef = useRef<Marker | null>(null)
  const longPressRingRef = useRef<HTMLDivElement | null>(null)
  const suppressNextClickRef = useRef(false)
  const myPinsRef = useRef(myPins)
  const onLongPressRef = useRef(onLongPress)
  const onMyPinClickRef = useRef(onMyPinClick)
  const onMyPinDragEndRef = useRef(onMyPinDragEnd)
  const onUserMapGestureRef = useRef(onUserMapGesture)
  const followUserRef = useRef(followUser)
  const editingPinIdRef = useRef(editingPinId)
  const pinDragEnabledRef = useRef(pinDragEnabled)
  const routeAnimatingRef = useRef(false)
  const routeIntroCancelRef = useRef({ cancelled: false })
  const routeDrawRafRef = useRef(0)
  const walkRouteRef = useRef(walkRoute)
  const onNearestPillClickRef = useRef(onNearestPillClick)
  const nearestPillsFitKeyRef = useRef('')
  const nearestPillsRef = useRef(nearestPills)
  const highlightIdRef = useRef(highlightId)
  const nearestActivePillIdRef = useRef(nearestActivePillId)
  const onNavigateRef = useRef(onNavigate)
  const onEvChargerSelectRef = useRef(onEvChargerSelect)
  const onBackgroundClickRef = useRef(onBackgroundClick)
  const onSearchPinClickRef = useRef(onSearchPinClick)
  const onPreciseSpotsLoadedRef = useRef(onPreciseSpotsLoaded)
  const onStreetSpotsLoadedRef = useRef(onStreetSpotsLoaded)
  const onMapReadyRef = useRef(onMapReady)
  const preciseFcRef = useRef<PreciseParkingCollection | null>(null)
  const streetFcRef = useRef<StreetParkingCollection | null>(null)
  /** Raw street FC before spatial dedupe (dedupe runs in applyDualLayerFilter). */
  const streetRawFcRef = useRef<StreetParkingCollection | null>(null)
  const evFcRef = useRef<EvChargerCollection | null>(null)
  const filterRef = useRef(filter)
  const selectedIdRef = useRef(selectedId)
  const pitch3dRef = useRef(pitch3d)
  const flyModeRef = useRef(flyMode)
  const themeRef = useRef(theme)
  const infoPanelOpenRef = useRef(infoPanelOpen)
  const cityIdRef = useRef<CityId>(cityId)
  const appliedThemeRef = useRef<ThemeMode>(theme)
  const districtDebugRef = useRef(false)
  const routeRef = useRef(route)
  const navigatingRef = useRef(navigating)
  const suppressedRef = useRef<Set<string>>(new Set())
  /** Active community isFull alert ids (for Hoiatusega filter + markers). */
  const alertIdsRef = useRef<Set<string>>(new Set())
  /** Community-verified parking types for map paint overrides. */
  const typeVotesRef = useRef<Map<string, TypeVoteVerification>>(new Map())
  const loadGenRef = useRef(0)
  const [ready, setReady] = useState(false)

  typeVotesRef.current = typeVerifications ?? new Map()

  const alertMarkerSpecs = useMemo((): CommunityStatusMarker[] => {
    const fullIds = new Set(
      fullSpotIds instanceof Set
        ? fullSpotIds
        : Array.isArray(fullSpotIds)
          ? fullSpotIds
          : [],
    )
    const freeIds = new Set(
      freeSpotIds instanceof Set
        ? freeSpotIds
        : Array.isArray(freeSpotIds)
          ? freeSpotIds
          : [],
    )
    alertIdsRef.current = fullIds
    if (fullIds.size === 0 && freeIds.size === 0) return []
    const byId = new Map(spots.map((s) => [s.id, s]))
    const out: CommunityStatusMarker[] = []
    const seen = new Set<string>()
    for (const id of fullIds) {
      const spot = byId.get(id) ?? parkingIndex.getById(id)
      if (!spot) continue
      seen.add(id)
      out.push({ id, lat: spot.lat, lng: spot.lng, status: 'full' })
    }
    for (const id of freeIds) {
      if (seen.has(id)) continue
      const spot = byId.get(id) ?? parkingIndex.getById(id)
      if (!spot) continue
      out.push({ id, lat: spot.lat, lng: spot.lng, status: 'free' })
    }
    return out
  }, [fullSpotIds, freeSpotIds, spots])

  onNavigateRef.current = onNavigate
  onEvChargerSelectRef.current = onEvChargerSelect
  onBackgroundClickRef.current = onBackgroundClick
  onSearchPinClickRef.current = onSearchPinClick
  onNearestPillClickRef.current = onNearestPillClick
  nearestPillsRef.current = nearestPills
  highlightIdRef.current = highlightId
  nearestActivePillIdRef.current = nearestActivePillId
  onPreciseSpotsLoadedRef.current = onPreciseSpotsLoaded
  onStreetSpotsLoadedRef.current = onStreetSpotsLoaded
  onMapReadyRef.current = onMapReady
  onLongPressRef.current = onLongPress
  onMyPinClickRef.current = onMyPinClick
  onMyPinDragEndRef.current = onMyPinDragEnd
  onUserMapGestureRef.current = onUserMapGesture
  followUserRef.current = followUser
  myPinsRef.current = myPins
  editingPinIdRef.current = editingPinId
  pinDragEnabledRef.current = pinDragEnabled
  filterRef.current = filter
  selectedIdRef.current = selectedId
  pitch3dRef.current = pitch3d
  flyModeRef.current = flyMode
  themeRef.current = theme
  infoPanelOpenRef.current = infoPanelOpen
  cityIdRef.current = cityId
  routeRef.current = route
  walkRouteRef.current = walkRoute
  navigatingRef.current = navigating
  suppressedRef.current = new Set(
    suppressedFeatureIds instanceof Set
      ? suppressedFeatureIds
      : (suppressedFeatureIds ?? []),
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const coarsePointer =
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches
    const map = new MapLibreMap({
      container: containerRef.current,
      style: createBasemapStyle(themeRef.current),
      // Default Tallinn center — camera may pan anywhere in Estonia
      center: [24.7535, 59.437],
      zoom: 14.2,
      minZoom: ESTONIA_MAP_MIN_ZOOM,
      maxBounds: ESTONIA_MAP_MAX_BOUNDS,
      pitch: pitch3dRef.current ? NAV_PITCH : 0,
      bearing: pitch3dRef.current ? -22 : 0,
      maxPitch: 70,
      // Zero label fade — removes opacity animation stutter on mobile pan
      fadeDuration: 0,
      // Cap DPR on phones — full 3x canvases tank pan FPS
      pixelRatio: Math.min(
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        coarsePointer ? 2 : 2.5,
      ),
      attributionControl: { compact: true },
      canvasContextAttributes: {
        // MSAA is expensive on mobile GPUs during pan
        antialias: !coarsePointer,
        failIfMajorPerformanceCaveat: false,
        // preserveDrawingBuffer forces a full buffer copy every frame — stutter
        preserveDrawingBuffer: false,
      },
    })

    mapRef.current = map
    // Dev/test hook for LOD screenshots — never expose on production builds.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __parkMap?: typeof map }).__parkMap = map
    }

    // ——— Long-press → personal pin (550 ms, ≤8 px move) ———
    const HOLD_MS = 550
    const MOVE_PX = 8
    const RING_DELAY_MS = 150
    type PressState = {
      startX: number
      startY: number
      pointerId: number
      timer: number
      ringTimer: number
      lngLat: { lng: number; lat: number }
    }
    let press: PressState | null = null

    const removeRing = () => {
      longPressRingRef.current?.remove()
      longPressRingRef.current = null
    }

    const cancelPress = () => {
      if (!press) return
      window.clearTimeout(press.timer)
      window.clearTimeout(press.ringTimer)
      press = null
      removeRing()
    }

    const showRingAt = (clientX: number, clientY: number) => {
      removeRing()
      const canvas = map.getCanvasContainer()
      const rect = canvas.getBoundingClientRect()
      const el = document.createElement('div')
      el.className = 'my-pin-longpress-ring'
      el.style.left = `${clientX - rect.left}px`
      el.style.top = `${clientY - rect.top}px`
      el.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle class="track" cx="22" cy="22" r="18"/>
        <circle class="progress" cx="22" cy="22" r="18" style="animation-duration:${HOLD_MS - RING_DELAY_MS}ms"/>
      </svg>`
      canvas.appendChild(el)
      longPressRingRef.current = el
    }

    const completePress = () => {
      if (!press) return
      const { lngLat } = press
      press = null
      removeRing()
      try {
        navigator.vibrate?.(15)
      } catch {
        /* ok */
      }
      suppressNextClickRef.current = true
      window.setTimeout(() => {
        suppressNextClickRef.current = false
      }, 350)
      onLongPressRef.current?.({ lat: lngLat.lat, lng: lngLat.lng })
    }

    const onPointerDown = (ev: PointerEvent) => {
      if (routeAnimatingRef.current) return
      if (ev.pointerType === 'mouse' && ev.button !== 0) return
      const t = ev.target as HTMLElement | null
      if (!t) return
      if (
        t.closest(
          '.my-pin-marker, .search-pin, .user-location-wrap, .maplibregl-ctrl, button, a, input, textarea',
        )
      ) {
        return
      }
      const canvas = map.getCanvas()
      if (t !== canvas && !canvas.contains(t)) return

      const rect = canvas.getBoundingClientRect()
      const lngLat = map.unproject([
        ev.clientX - rect.left,
        ev.clientY - rect.top,
      ])

      cancelPress()
      const state: PressState = {
        startX: ev.clientX,
        startY: ev.clientY,
        pointerId: ev.pointerId,
        lngLat: { lng: lngLat.lng, lat: lngLat.lat },
        ringTimer: window.setTimeout(() => {
          if (!press || press.pointerId !== state.pointerId) return
          showRingAt(ev.clientX, ev.clientY)
        }, RING_DELAY_MS),
        timer: window.setTimeout(() => {
          if (!press || press.pointerId !== state.pointerId) return
          completePress()
        }, HOLD_MS),
      }
      press = state
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (!press || press.pointerId !== ev.pointerId) return
      const dx = ev.clientX - press.startX
      const dy = ev.clientY - press.startY
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) cancelPress()
    }

    const onPointerUp = (ev: PointerEvent) => {
      if (!press || press.pointerId !== ev.pointerId) return
      cancelPress()
    }

    const onTouchStartExtra = (ev: TouchEvent) => {
      if (ev.touches.length > 1) cancelPress()
    }

    const canvasContainer = map.getCanvasContainer()
    canvasContainer.style.userSelect = 'none'
    ;(
      canvasContainer.style as CSSStyleDeclaration & {
        webkitUserSelect?: string
        webkitTouchCallout?: string
      }
    ).webkitUserSelect = 'none'
    ;(
      canvasContainer.style as CSSStyleDeclaration & {
        webkitTouchCallout?: string
      }
    ).webkitTouchCallout = 'none'

    canvasContainer.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    canvasContainer.addEventListener('touchstart', onTouchStartExtra, {
      passive: true,
    })
    const onContextMenu = (e: Event) => e.preventDefault()
    canvasContainer.addEventListener('contextmenu', onContextMenu)

    map.on('dragstart', cancelPress)
    map.on('zoomstart', cancelPress)
    map.on('rotatestart', cancelPress)
    map.on('pitchstart', cancelPress)

    const cleanupLongPress = () => {
      cancelPress()
      canvasContainer.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      canvasContainer.removeEventListener('touchstart', onTouchStartExtra)
      canvasContainer.removeEventListener('contextmenu', onContextMenu)
      map.off('dragstart', cancelPress)
      map.off('zoomstart', cancelPress)
      map.off('rotatestart', cancelPress)
      map.off('pitchstart', cancelPress)
    }

    let setupDone = false
    const parkingHitLayers = [
      ...NEAREST_PILL_HIT_LAYERS,
      ...EV_HIT_LAYERS,
      ...PRECISE_HIT_LAYERS,
      ...STREET_HIT_LAYERS,
      PARKING_LOTS_FILL_LAYER,
      PARKING_LOTS_LABEL_LAYER,
      PARKING_LINES_LAYER,
      'parking-street-lines-hit',
      ...PARKING_PROVIDERS.map((k) => PARKING_LAYER_META[k].id),
    ]

    const setPointer = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const clearPointer = () => {
      map.getCanvas().style.cursor = ''
    }

    /** Nearly-transparent fade band must not steal hover / clicks. */
    const isLayerInteractiveAtZoom = (layerId: string, z: number) => {
      if (
        (PRECISE_HIT_LAYERS as readonly string[]).includes(layerId) ||
        layerId === PARKING_LOTS_FILL_LAYER ||
        layerId === PARKING_LOTS_LABEL_LAYER
      ) {
        return isParkingInteractiveAtZoom(z, PARKING_FADE)
      }
      if ((STREET_HIT_LAYERS as readonly string[]).includes(layerId)) {
        return isParkingInteractiveAtZoom(z, STREET_FADE)
      }
      if (
        layerId === PARKING_LINES_LAYER ||
        layerId === 'parking-street-lines-hit' ||
        PARKING_PROVIDERS.some((k) => PARKING_LAYER_META[k].id === layerId)
      ) {
        return isParkingInteractiveAtZoom(z, DETAIL_FADE)
      }
      // Nearest pills / EV — keep existing behavior
      return true
    }

    const bindHover = () => {
      for (const layerId of parkingHitLayers) {
        if (!map.getLayer(layerId)) continue
        map.on('mouseenter', layerId, (e) => {
          const z = map.getZoom()
          const id = e.features?.[0]?.properties?.id
          const selected =
            id != null && String(id) === selectedIdRef.current
          if (!selected && !isLayerInteractiveAtZoom(layerId, z)) {
            clearPointer()
            return
          }
          setPointer()
        })
        map.on('mouseleave', layerId, clearPointer)
      }
    }

    const emitZoom = (m: MapLibreMapType) => {
      const z = m.getZoom()
      const mode =
        z >= DETAIL_FADE_START_ZOOM
          ? 'street'
          : z >= PARKING_FADE_START_ZOOM
            ? 'cluster'
            : 'district'
      onZoomChange?.(z, mode)
    }

    const refreshViewport = async (m: MapLibreMapType) => {
      const gen = ++loadGenRef.current
      const b = m.getBounds()
      const zoom = m.getZoom()
      const result = await queryParkingInViewport(
        {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
        zoom,
      )
      if (gen !== loadGenRef.current || !mapRef.current) return

      const layers = filterToLayers(filterRef.current)
      const visibleSpots =
        layers === 'ev'
          ? []
          : layers === 'alerts'
            ? result.spots.filter((s) => alertIdsRef.current.has(s.id))
            : layers === 'all'
              ? result.spots
              : layers === 'verified_free'
                ? result.spots.filter(
                    (s) => getParkingFilterCategory(s) === 'free',
                  )
                : layers === 'clock'
                  ? result.spots.filter(
                      (s) => getParkingFilterCategory(s) === 'timed',
                    )
                  : layers === 'unclassified'
                    ? result.spots.filter((s) =>
                        isUnclassifiedParking({
                          layer: s.layer,
                          price_per_hour: s.price_per_hour,
                          free_minutes: s.free_minutes,
                          zone_code: s.zone_code,
                          operator: s.operator,
                          verified_free: s.layer === 'free_street',
                          type: s.type,
                          timeLimit: s.timeLimit,
                          name: s.name,
                          desc: s.desc,
                          badge: s.badge,
                        }),
                      )
                    : layers === 'paid'
                      ? result.spots.filter(
                          (s) =>
                            s.layer !== 'ev' &&
                            getParkingFilterCategory(s) === 'paid',
                        )
                      : Array.isArray(layers)
                        ? result.spots.filter((s) => layers.includes(s.layer))
                        : result.spots

      const empty = { type: 'FeatureCollection' as const, features: [] }
      let geo =
        result.skippedForZoom || result.skippedForExtent
          ? { points: empty, lines: empty, polygons: empty }
          : spotsToMapGeoJSON(visibleSpots)

      // LOD: below lot fade start → districts only
      //      lot→detail fade → lot polygons only
      //      detail fade+ → pins (EV / timed / INVA)
      if (result.lod !== 'detail') {
        geo = { ...geo, points: empty, lines: empty }
      }
      if (result.lod === 'district') {
        geo = { points: empty, lines: empty, polygons: empty }
      }

      ;(m.getSource(PARKING_VIEWPORT_SOURCE) as GeoJSONSource | undefined)?.setData(geo.points)
      // Street lines come only from master street_side/lane features — never invent diagonals
      ;(m.getSource(PARKING_LINES_SOURCE) as GeoJSONSource | undefined)?.setData(empty)
      // Stub lot polygons stay empty — precise GeoJSON owns lot boundaries
      ;(m.getSource(PARKING_LOTS_SOURCE) as GeoJSONSource | undefined)?.setData(empty)

      // setData clears feature-state — re-apply selection highlight
      applySelectionHighlight(m, selectedIdRef.current)

      onViewportStats?.({
        rendered: visibleSpots.length,
        skipped: result.skippedForZoom || result.skippedForExtent,
      })
    }

    ;(map as MapLibreMapType & { __refreshViewport?: () => void }).__refreshViewport = () => {
      void refreshViewport(map)
    }

    const reapplyFilterVisibility = () => {
      const layers = filterToLayers(filterRef.current)
      if (layers === 'all') {
        setParkingLayerVisibility(
          map,
          Object.fromEntries(PARKING_PROVIDERS.map((p) => [p, true])),
        )
      } else if (layers === 'verified_free') {
        setParkingLayerVisibility(
          map,
          Object.fromEntries(
            PARKING_PROVIDERS.map((p) => [p, p === 'free_street']),
          ) as Partial<Record<ParkingLayerKey, boolean>>,
        )
      } else if (layers === 'clock') {
        // Same as filter effect — municipal Tallinn clock zones must stay visible
        setParkingLayerVisibility(
          map,
          Object.fromEntries(
            PARKING_PROVIDERS.map((p) => [p, true]),
          ) as Partial<Record<ParkingLayerKey, boolean>>,
        )
      } else if (Array.isArray(layers)) {
        setParkingLayerVisibility(
          map,
          Object.fromEntries(
            PARKING_PROVIDERS.map((p) => [p, layers.includes(p)]),
          ) as Partial<Record<ParkingLayerKey, boolean>>,
        )
      }
    }

    const reapplyOverlayData = () => {
      reapplyFilterVisibility()
      setCityDistrictOverlays(map, cityIdRef.current)
      applyDualLayerFilter(
        map,
        filterRef.current,
        preciseFcRef.current,
        streetRawFcRef.current ?? streetFcRef.current,
        suppressedRef.current,
        cityIdRef.current,
        alertIdsRef.current,
        typeVotesRef.current,
      )
      disableSymbolLayerFades(map)
      applySelectionHighlight(map, selectedIdRef.current)
      setDistrictDebugVisible(map, districtDebugRef.current)
      setNearestPricePillData(
        map,
        nearestPillsRef.current,
        nearestActivePillIdRef.current ?? null,
      )

      const routeSrc = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
      if (routeSrc) {
        const r = routeRef.current
        if (!r || !navigatingRef.current) {
          routeSrc.setData({ type: 'FeatureCollection', features: [] })
        } else {
          routeSrc.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: routeCoordsToLngLat(r.coords),
                },
              },
            ],
          })
        }
      }
      const walkSrc = map.getSource(WALK_ROUTE_SOURCE) as GeoJSONSource | undefined
      if (walkSrc) {
        const w = walkRouteRef.current
        if (!w || !navigatingRef.current || w.coords.length < 2) {
          walkSrc.setData({ type: 'FeatureCollection', features: [] })
        } else {
          walkSrc.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  kind: 'walk',
                  fallback: Boolean(w.isFallback),
                },
                geometry: {
                  type: 'LineString',
                  coordinates: routeCoordsToLngLat(w.coords),
                },
              },
            ],
          })
        }
      }
      void refreshViewport(map)
    }

    const onStyleLoad = () => {
      ensureParkingOverlaySources(map, themeRef.current)
      ensureEvChargerLayers(map)
      ensureNearestPricePillLayers(map)
      // Polygons → lines → pins/symbols; EV markers sit above parking pins
      orderParkingOverlayStack(map)
      for (const id of [
        EV_CHARGERS_GLOW_LAYER,
        EV_CHARGERS_CIRCLE_LAYER,
        EV_CHARGERS_SYMBOL_LAYER,
        EV_CHARGERS_HIT_LAYER,
      ]) {
        if (map.getLayer(id)) {
          try {
            map.moveLayer(id)
          } catch {
            /* ok */
          }
        }
      }
      // Keep overlays hidden until the basemap finishes its first paint
      setParkingOverlaysRevealed(map, false)
      setEvChargerVisibility(map, false)
      appliedThemeRef.current = themeRef.current

      const revealOverlaysAfterBasemap = (then: () => void) => {
        let done = false
        const reveal = () => {
          if (done || !mapRef.current) return
          done = true
          map.off('idle', reveal)
          setParkingOverlaysRevealed(map, true)
          orderParkingOverlayStack(map)
          for (const id of [
            EV_CHARGERS_GLOW_LAYER,
            EV_CHARGERS_CIRCLE_LAYER,
            EV_CHARGERS_SYMBOL_LAYER,
            EV_CHARGERS_HIT_LAYER,
          ]) {
            if (map.getLayer(id)) {
              try {
                map.moveLayer(id)
              } catch {
                /* ok */
              }
            }
          }
          then()
        }
        // Wait for style + vector tiles so lines don't flash on blank white.
        map.once('idle', reveal)
        // Safety: if idle already fired before we subscribed, reveal shortly.
        window.setTimeout(() => {
          if (!done && map.isStyleLoaded()) reveal()
        }, 400)
      }

      if (!setupDone) {
        setupDone = true
        bindHover()
        // District hover → feature-state (does not affect parking hit targets)
        const districtLayers = [DISTRICT_FILL_LAYER, DISTRICT_SUBZONE_FILL_LAYER]
        let hoveredDistrict: string | number | null = null
        const onDistrictMove = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          const id = f?.id ?? f?.properties?.id ?? null
          if (id === hoveredDistrict) return
          hoveredDistrict = id
          setDistrictHover(map, id)
        }
        const onDistrictLeave = () => {
          hoveredDistrict = null
          setDistrictHover(map, null)
        }
        for (const layerId of districtLayers) {
          if (!map.getLayer(layerId)) continue
          map.on('mousemove', layerId, onDistrictMove)
          map.on('mouseleave', layerId, onDistrictLeave)
        }
        map.resize()
        map.setPitch(pitch3dRef.current ? NAV_PITCH : 0)
        emitZoom(map)

        // Dual-layer parking (Tallinn master or Pärnu city extract).
        // Street/road polyline overlays are globally disabled — lots only.
        const applyPoly = (fc: PreciseParkingCollection) => {
          preciseFcRef.current = fc
          applyDualLayerFilter(
            map,
            filterRef.current,
            fc,
            streetRawFcRef.current,
            suppressedRef.current,
            cityIdRef.current,
            alertIdsRef.current,
            typeVotesRef.current,
          )
          const spots = preciseCollectionToSpots({
            type: 'FeatureCollection',
            features: withoutSuppressed(fc.features, suppressedRef.current),
          })
          for (const s of spots) parkingIndex.insert(s)
          onPreciseSpotsLoadedRef.current?.(spots)
          applySelectionHighlight(map, selectedIdRef.current)
          if (import.meta.env.DEV) {
            console.info('[parking] polygon purge', getLastPolygonPurgeStats())
          }
        }

        // Absolute ban: street/road polyline overlays are never applied
        const applyStreetDisabled = () => {
          const empty: StreetParkingCollection = {
            type: 'FeatureCollection',
            features: [],
          }
          streetRawFcRef.current = empty
          streetFcRef.current = empty
          applyDualLayerFilter(
            map,
            filterRef.current,
            preciseFcRef.current,
            empty,
            suppressedRef.current,
            cityIdRef.current,
            alertIdsRef.current,
            typeVotesRef.current,
          )
          onStreetSpotsLoadedRef.current?.([])
          applySelectionHighlight(map, selectedIdRef.current)
          if (import.meta.env.DEV) {
            console.info('[parking] street overlays disabled (lots only)')
          }
        }

        const city = cityIdRef.current
        setCityDistrictOverlays(map, city)

        // Defer parking GeoJSON + EV until basemap tiles have painted —
        // prevents colored overlays flashing on a blank white canvas.
        revealOverlaysAfterBasemap(() => {
          if (!mapRef.current) return
          setReady(true)
          onMapReadyRef.current?.()
          void refreshViewport(map)

          const warmPoly = getCachedCityPolygons(city)
          if (warmPoly) applyPoly(warmPoly)
          applyStreetDisabled()

          void loadCityParking(city)
            .then((split) => {
              if (cityIdRef.current !== city) return
              applyPoly(split.polygons)
              applyStreetDisabled()
            })
            .catch((err) => {
              console.warn(`[parking] ${city} master failed to load`, err)
            })

          // Public EV chargers — only under Kõik / Elektriautolaadijad
          void loadEvChargers().then((fc) => {
            if (!mapRef.current) return
            evFcRef.current = fc
            const show =
              filterRef.current === 'all' || filterRef.current === 'ev'
            setEvChargerData(
              mapRef.current,
              filterEvCollection(
                fc,
                show ? (filterRef.current === 'ev' ? 'ev' : 'all') : 'hide',
              ),
            )
            setEvChargerVisibility(mapRef.current, show)
            for (const f of fc.features) {
              const spot = evFeatureToSpot(f)
              if (!parkingIndex.getById(spot.id)) parkingIndex.insert(spot)
            }
          })
        })
        return
      }

      // Theme / style reload — reveal after basemap idle, then restore data
      revealOverlaysAfterBasemap(() => {
        reapplyOverlayData()
        if (evFcRef.current) {
          const show =
            filterRef.current === 'all' || filterRef.current === 'ev'
          setEvChargerData(
            map,
            filterEvCollection(
              evFcRef.current,
              show ? (filterRef.current === 'ev' ? 'ev' : 'all') : 'hide',
            ),
          )
          setEvChargerVisibility(map, show)
        }
      })
    }

    map.on('style.load', onStyleLoad)
    map.once('load', () => {
      if (map.isStyleLoaded() && !setupDone) onStyleLoad()
    })
    const readyTimer = window.setTimeout(() => {
      if (map.isStyleLoaded() && !setupDone) onStyleLoad()
    }, 2500)

    let moveTimer: number | undefined
    const scheduleRefresh = () => {
      window.clearTimeout(moveTimer)
      moveTimer = window.setTimeout(() => {
        emitZoom(map)
        void refreshViewport(map)
      }, 120)
    }
    map.on('moveend', scheduleRefresh)
    map.on('zoomend', scheduleRefresh)

    const onMapClick = (e: MapLayerMouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      const pad = 12
      const box: [[number, number], [number, number]] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ]
      const layers = parkingHitLayers.filter((id) => map.getLayer(id))
      const rawHits = layers.length
        ? map.queryRenderedFeatures(box, { layers })
        : []
      const zClick = map.getZoom()
      // Drop nearly-invisible parking hits; keep selected / pills / EV
      const hits = rawHits.filter((f) => {
        const layerId = f.layer?.id ?? ''
        const id = f.properties?.id
        if (id != null && String(id) === selectedIdRef.current) return true
        return isLayerInteractiveAtZoom(layerId, zClick)
      })

      // Nearest-parking price pills (preview only)
      const pillHit = hits.find((f) =>
        (NEAREST_PILL_HIT_LAYERS as readonly string[]).includes(f.layer?.id ?? ''),
      )
      if (pillHit?.properties?.id) {
        onNearestPillClickRef.current?.(String(pillHit.properties.id))
        return
      }

      // EV charger cyan markers — glass preview (not parking detail)
      const evHit = hits.find((f) =>
        (EV_HIT_LAYERS as readonly string[]).includes(f.layer?.id ?? ''),
      )
      if (evHit?.properties?.id) {
        const id = String(evHit.properties.id)
        const fromFc = evFcRef.current?.features.find((f) => f.properties.id === id)
        if (fromFc) {
          const [lng, lat] = fromFc.geometry.coordinates
          map.easeTo({
            center: [lng, lat],
            zoom: Math.max(map.getZoom(), 15.5),
            pitch: pitch3dRef.current ? NAV_PITCH : 0,
            duration: 700,
            essential: true,
          })
          const spot = evFeatureToSpot(fromFc)
          if (!parkingIndex.getById(spot.id)) parkingIndex.insert(spot)
          if (onEvChargerSelectRef.current) {
            onEvChargerSelectRef.current(fromFc)
          } else {
            onNavigateRef.current(spot)
          }
          return
        }
      }

      // Prefer precise parking polygons — fit bounds then open sheet
      const preciseHit = hits.find((f) =>
        (PRECISE_HIT_LAYERS as readonly string[]).includes(f.layer?.id ?? ''),
      )
      if (preciseHit?.properties?.id) {
        const id = String(preciseHit.properties.id)
        const fromFc = preciseFcRef.current?.features.find((f) => f.properties.id === id)
        const spot =
          parkingIndex.getById(id) ??
          (fromFc ? preciseFeatureToSpot(fromFc as PreciseParkingFeature) : undefined)
        if (fromFc?.geometry) {
          const [[west, south], [east, north]] = featureBounds(fromFc.geometry)
          const bounds = new LngLatBounds([west, south], [east, north])
          map.fitBounds(bounds, {
            padding: panelCameraPadding(infoPanelOpenRef.current || true),
            maxZoom: 17.2,
            duration: 900,
            pitch: pitch3dRef.current ? NAV_PITCH : 0,
            essential: true,
          })
        }
        if (spot) {
          if (!parkingIndex.getById(spot.id)) parkingIndex.insert(spot)
          onNavigateRef.current(spot)
        }
        return
      }

      // Street-side curb LineStrings
      const streetHit = hits.find((f) =>
        (STREET_HIT_LAYERS as readonly string[]).includes(f.layer?.id ?? ''),
      )
      if (streetHit?.properties?.id) {
        const id = String(streetHit.properties.id)
        const fromFc = streetFcRef.current?.features.find((f) => f.properties.id === id)
        const spot =
          parkingIndex.getById(id) ??
          (fromFc ? streetFeatureToSpot(fromFc as StreetParkingFeature) : undefined)
        if (fromFc?.geometry?.coordinates?.length) {
          const coords = fromFc.geometry.coordinates
          const mid = coords[Math.floor(coords.length / 2)]
          map.easeTo({
            center: [mid[0], mid[1]],
            zoom: Math.max(map.getZoom(), 16.5),
            pitch: pitch3dRef.current ? NAV_PITCH : 0,
            duration: 850,
            essential: true,
          })
        }
        if (spot) {
          if (!parkingIndex.getById(spot.id)) parkingIndex.insert(spot)
          onNavigateRef.current(spot)
        }
        return
      }

      const hit = hits.find((f) => f.properties?.id)
      if (!hit?.properties?.id) {
        onBackgroundClickRef.current?.()
        return
      }
      const spot = parkingIndex.getById(String(hit.properties.id))
      if (spot) onNavigateRef.current(spot)
    }
    map.on('click', onMapClick)

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    return () => {
      window.clearTimeout(readyTimer)
      window.clearTimeout(moveTimer)
      cleanupLongPress()
      ro.disconnect()
      userMarkerRef.current?.remove()
      searchMarkerRef.current?.remove()
      draftPinMarkerRef.current?.remove()
      draftPinMarkerRef.current = null
      for (const m of fullMarkersRef.current.values()) m.remove()
      fullMarkersRef.current.clear()
      for (const m of myPinMarkersRef.current.values()) m.remove()
      myPinMarkersRef.current.clear()
      map.off('style.load', onStyleLoad)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Swap basemap style on theme toggle; style.load re-adds all custom layers. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (appliedThemeRef.current === theme) return

    const center = map.getCenter()
    const zoom = map.getZoom()
    const pitch = map.getPitch()
    const bearing = map.getBearing()

    themeRef.current = theme
    map.setStyle(createBasemapStyle(theme))
    // Camera is preserved by MapLibre across setStyle; jumpTo guards edge cases
    map.once('style.load', () => {
      map.jumpTo({ center, zoom, pitch, bearing })
    })
  }, [theme, ready])

  /** Reload parking + district overlays when the city layer changes. */
  // City parking lots/streets: ee_parking_max.geojson via loadCityParking(cityId)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    cityIdRef.current = cityId
    setCityDistrictOverlays(map, cityId)
    preciseFcRef.current = null
    streetRawFcRef.current = null
    streetFcRef.current = null
    onPreciseSpotsLoadedRef.current?.([])
    onStreetSpotsLoadedRef.current?.([])

    const emptyStreets: StreetParkingCollection = {
      type: 'FeatureCollection',
      features: [],
    }
    streetRawFcRef.current = emptyStreets
    streetFcRef.current = emptyStreets

    const warmPoly = getCachedCityPolygons(cityId)
    if (warmPoly) {
      preciseFcRef.current = warmPoly
      applyDualLayerFilter(
        map,
        filterRef.current,
        warmPoly,
        emptyStreets,
        suppressedRef.current,
        cityIdRef.current,
        alertIdsRef.current,
        typeVotesRef.current,
      )
      const spots = preciseCollectionToSpots({
        type: 'FeatureCollection',
        features: withoutSuppressed(warmPoly.features, suppressedRef.current),
      })
      for (const s of spots) parkingIndex.insert(s)
      onPreciseSpotsLoadedRef.current?.(spots)
    }
    onStreetSpotsLoadedRef.current?.([])

    void loadCityParking(cityId)
      .then((split) => {
        if (cityIdRef.current !== cityId || !mapRef.current) return
        preciseFcRef.current = split.polygons
        streetRawFcRef.current = emptyStreets
        streetFcRef.current = emptyStreets
        applyDualLayerFilter(
          mapRef.current,
          filterRef.current,
          split.polygons,
          emptyStreets,
          suppressedRef.current,
          cityIdRef.current,
          alertIdsRef.current,
          typeVotesRef.current,
        )
        const lots = preciseCollectionToSpots({
          type: 'FeatureCollection',
          features: withoutSuppressed(split.polygons.features, suppressedRef.current),
        })
        for (const s of lots) parkingIndex.insert(s)
        onPreciseSpotsLoadedRef.current?.(lots)
        onStreetSpotsLoadedRef.current?.([])
        applySelectionHighlight(mapRef.current, selectedIdRef.current)
      })
      .catch((err) => {
        console.warn(`[parking] city ${cityId} reload failed`, err)
      })
  }, [cityId, ready])

  useEffect(() => {
    void spots
  }, [spots])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const layers = filterToLayers(filter)
    if (layers === 'all') {
      setParkingLayerVisibility(
        map,
        Object.fromEntries(PARKING_PROVIDERS.map((p) => [p, true])),
      )
    } else if (layers === 'ev' || layers === 'alerts') {
      // Elektriautolaadijad / Hoiatusega — hide pin layers; lots/alerts own the view
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, false]),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (layers === 'verified_free') {
      // Tasuta: unlimited free pins only; GeoJSON filtered via verified_free.
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, p === 'free_street']),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (layers === 'clock') {
      // Kellaga: keep ALL pin layers visible — Tallinn municipal zones
      // (Kesklinn / Vanalinn / …) live under municipal/europark, not only
      // layer=timed. GeoJSON is filtered with getParkingFilterCategory.
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, true]),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (layers === 'unclassified') {
      // Muud / Era — grey unclassified only (not all municipal / city Kellaga)
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, p === 'municipal']),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (layers === 'paid') {
      const paidPins = new Set([
        'europark',
        'snabb',
        'citypark',
        'uhisteenused',
        'parkit',
        'park_ride',
        'loading',
        'municipal',
      ])
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, paidPins.has(p)]),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (Array.isArray(layers)) {
      const vis = Object.fromEntries(
        PARKING_PROVIDERS.map((p) => [p, layers.includes(p)]),
      ) as Partial<Record<ParkingLayerKey, boolean>>
      setParkingLayerVisibility(map, vis)
    }
    // Filter lot polygons + street curb lines together (incl. dedupe)
    applyDualLayerFilter(
      map,
      filter,
      preciseFcRef.current,
      streetRawFcRef.current ?? streetFcRef.current,
      suppressedRef.current,
      cityIdRef.current,
      alertIdsRef.current,
      typeVotesRef.current,
    )
    // EV chargers: show under Kõik + Elektriautolaadijad
    if (evFcRef.current) {
      const show = filter === 'all' || filter === 'ev'
      setEvChargerData(
        map,
        filterEvCollection(evFcRef.current, show ? (filter === 'ev' ? 'ev' : 'all') : 'hide'),
      )
      setEvChargerVisibility(map, show)
    }
    applySelectionHighlight(map, selectedIdRef.current)
    ;(map as MapLibreMapType & { __refreshViewport?: () => void }).__refreshViewport?.()
  }, [filter, ready, suppressedFeatureIds])

  // Re-paint lots when community type verifications arrive / change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    applyDualLayerFilter(
      map,
      filterRef.current,
      preciseFcRef.current,
      streetRawFcRef.current ?? streetFcRef.current,
      suppressedRef.current,
      cityIdRef.current,
      alertIdsRef.current,
      typeVotesRef.current,
    )
    applySelectionHighlight(map, selectedIdRef.current)
  }, [typeVerifications, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!userMarkerRef.current) {
      userMarkerRef.current = new Marker({
        element: makeUserEl(),
        anchor: 'center',
      })
        .setLngLat([userLocation[1], userLocation[0]])
        .addTo(map)
    } else {
      userMarkerRef.current.setLngLat([userLocation[1], userLocation[0]])
    }
  }, [userLocation, ready])

  // Live GPS follow — ease camera to blue-dot without changing zoom
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !followUser) return
    if (routeAnimatingRef.current) return
    if (nearestPillsRef.current.length > 0) return
    map.easeTo({
      center: [userLocation[1], userLocation[0]],
      duration: prefersReducedMotion() ? 0 : 350,
      essential: true,
    })
  }, [userLocation, followUser, ready])

  // User pan/zoom/rotate breaks follow-me until they tap re-center
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const notify = () => onUserMapGestureRef.current?.()
    const onDragStart = () => notify()
    const onZoomStart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) notify()
    }
    const onRotateStart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) notify()
    }
    const onPitchStart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) notify()
    }
    map.on('dragstart', onDragStart)
    map.on('zoomstart', onZoomStart)
    map.on('rotatestart', onRotateStart)
    map.on('pitchstart', onPitchStart)
    return () => {
      map.off('dragstart', onDragStart)
      map.off('zoomstart', onZoomStart)
      map.off('rotatestart', onRotateStart)
      map.off('pitchstart', onPitchStart)
    }
  }, [ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (!searchPin) {
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = null
      return
    }

    if (!searchMarkerRef.current) {
      searchMarkerRef.current = new Marker({
        element: makeSearchPinEl(() => onSearchPinClickRef.current?.()),
        anchor: 'bottom',
      })
        .setLngLat([searchPin.lng, searchPin.lat])
        .addTo(map)
    } else {
      searchMarkerRef.current.setLngLat([searchPin.lng, searchPin.lat])
    }
  }, [searchPin, ready])

  /**
   * Personal pins as HTML Markers (incremental by id).
   * Kept above parking geometry visually via Marker DOM stacking; search/user
   * markers are separate and stay independently managed.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const markers = myPinMarkersRef.current
    const dark = theme === 'dark'
    const compact = map.getZoom() < 12
    const showLabel = map.getZoom() >= 15
    const ids = new Set(myPins.map((p) => p.id))

    for (const [id, marker] of markers) {
      if (!ids.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }

    // Oldest first → newest addTo stacks on top for overlapping pins
    const ordered = [...myPins].sort((a, b) => a.updatedAt - b.updatedAt)
    for (const pin of ordered) {
      const selected = pin.id === editingPinId
      const color = MY_PIN_COLORS[pin.color]
      const existing = markers.get(pin.id)
      if (existing) {
        existing.setLngLat([pin.lng, pin.lat])
        const el = existing.getElement()
        el.dataset.pinId = pin.id
        updateMyPinEl(el, {
          color,
          name: pin.name,
          compact: compact || !showLabel,
          selected,
          dark,
        })
        existing.setDraggable(Boolean(pinDragEnabled && selected))
      } else {
        const el = makeMyPinEl({
          color,
          name: pin.name,
          compact: compact || !showLabel,
          selected,
          dark,
          onClick: () => {
            const id = el.dataset.pinId
            const hit = myPinsRef.current.find((p) => p.id === id)
            if (hit) onMyPinClickRef.current?.(hit)
          },
        })
        el.dataset.pinId = pin.id
        const m = new Marker({ element: el, anchor: 'bottom', draggable: false })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map)
        m.setDraggable(Boolean(pinDragEnabled && selected))
        m.on('dragend', () => {
          const id = el.dataset.pinId
          if (!id) return
          const ll = m.getLngLat()
          onMyPinDragEndRef.current?.(id, { lat: ll.lat, lng: ll.lng })
        })
        markers.set(pin.id, m)
      }
    }

    const onZoom = () => {
      const z = map.getZoom()
      const c = z < 12
      const label = z >= 15
      for (const pin of myPinsRef.current) {
        const marker = markers.get(pin.id)
        if (!marker) continue
        updateMyPinEl(marker.getElement(), {
          color: MY_PIN_COLORS[pin.color],
          name: pin.name,
          compact: c || !label,
          selected: pin.id === editingPinIdRef.current,
          dark: themeRef.current === 'dark',
        })
      }
    }
    map.on('zoom', onZoom)
    return () => {
      map.off('zoom', onZoom)
    }
  }, [myPins, ready, theme, editingPinId, pinDragEnabled])

  /** Draft pin while naming sheet is open — drop animation on first place. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (!draftPin) {
      const existing = draftPinMarkerRef.current
      if (existing) {
        const el = existing.getElement()
        el.classList.add('my-pin-draft-fade')
        window.setTimeout(() => {
          existing.remove()
          if (draftPinMarkerRef.current === existing) {
            draftPinMarkerRef.current = null
          }
        }, 180)
      }
      return
    }

    const color = MY_PIN_COLORS[draftPin.color ?? 'red']
    const existing = draftPinMarkerRef.current
    if (existing) {
      existing.setLngLat([draftPin.lng, draftPin.lat])
      updateMyPinEl(existing.getElement(), {
        color,
        name: 'Uus pin',
        compact: false,
        selected: true,
        dark: theme === 'dark',
      })
      return
    }

    const el = makeMyPinEl({
      color,
      name: 'Uus pin',
      compact: false,
      selected: true,
      draft: true,
      dark: theme === 'dark',
    })
    const m = new Marker({ element: el, anchor: 'bottom' })
      .setLngLat([draftPin.lng, draftPin.lat])
      .addTo(map)
    draftPinMarkerRef.current = m

    if (!routeAnimatingRef.current) {
      const z = map.getZoom()
      map.easeTo({
        center: [draftPin.lng, draftPin.lat],
        zoom: z < 14 ? 16 : z,
        padding: panelCameraPadding(true),
        duration: 450,
        essential: true,
      })
    }
  }, [draftPin, ready, theme])

  /** Compact pulsating "täis" markers — driven by memoized specs (not pan/zoom). */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const markers = fullMarkersRef.current
    const nextIds = new Set(alertMarkerSpecs.map((m) => m.id))

    for (const [id, marker] of markers) {
      if (!nextIds.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }
    for (const spec of alertMarkerSpecs) {
      const existing = markers.get(spec.id)
      if (existing) {
        existing.setLngLat([spec.lng, spec.lat])
        applyCommunityStatusToElement(existing.getElement(), spec.status)
      } else {
        const m = new Marker({
          element: createCommunityStatusElement(spec.status),
          anchor: 'center',
        })
          .setLngLat([spec.lng, spec.lat])
          .addTo(map)
        markers.set(spec.id, m)
      }
    }

    const syncFullMarkerFade = () => {
      const z = map.getZoom()
      const op = getParkingOpacity(z, PARKING_FADE)
      const selected = selectedIdRef.current
      for (const [id, marker] of markers) {
        const el = marker.getElement()
        const keep = id === selected
        const next = keep ? 1 : op
        el.style.opacity = String(next)
        el.style.visibility = keep || next > 0.02 ? 'visible' : 'hidden'
      }
    }
    syncFullMarkerFade()
    map.on('zoom', syncFullMarkerFade)
    map.on('zoomend', syncFullMarkerFade)

    // Re-apply alerts-only geometry when the remote set changes
    if (filterRef.current === 'alerts') {
      applyDualLayerFilter(
        map,
        'alerts',
        preciseFcRef.current,
        streetRawFcRef.current ?? streetFcRef.current,
        suppressedRef.current,
        cityIdRef.current,
        alertIdsRef.current,
        typeVotesRef.current,
      )
      void (
        map as MapLibreMapType & { __refreshViewport?: () => void }
      ).__refreshViewport?.()
    }

    return () => {
      map.off('zoom', syncFullMarkerFade)
      map.off('zoomend', syncFullMarkerFade)
    }
  }, [alertMarkerSpecs, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !flyTarget) return
    // Route intro / nearest fitBounds own the camera
    if (routeAnimatingRef.current) return
    if (nearestPillsRef.current.length > 0) return
    const center: [number, number] = [flyTarget[1], flyTarget[0]]
    const zoom = flyZoom ?? Math.max(map.getZoom(), ZOOM.detailMin + 0.4)
    // Detail / locate focus: gentle pitch so the pin sits above the sheet
    const pitch = zoom >= 15.5 ? 30 : pitch3dRef.current ? NAV_PITCH : 0

    const padding = panelCameraPadding(
      infoPanelOpenRef.current || flyModeRef.current === 'fly',
      'detail',
    )
    if (flyModeRef.current === 'fly') {
      map.flyTo({
        center,
        zoom,
        pitch,
        padding,
        duration: prefersReducedMotion() ? 0 : 1500,
        essential: true,
      })
    } else {
      map.easeTo({
        center,
        zoom,
        pitch,
        padding,
        duration: prefersReducedMotion() ? 0 : 900,
        essential: true,
      })
    }
  }, [flyTarget, flyKey, flyZoom, ready])

  // Keep focus clear of the left/bottom info panel when it opens/closes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (routeAnimatingRef.current) return
    // Nearest picker fitBounds owns padding while pills are visible
    if (nearestPills.length > 0) return
    map.easeTo({
      padding: panelCameraPadding(infoPanelOpen, 'detail'),
      duration: 280,
      essential: true,
    })
  }, [infoPanelOpen, ready, nearestPills.length])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // Don't fight detail flyTo pitch:30
    if (selectedIdRef.current) return
    map.easeTo({
      pitch: pitch3d ? NAV_PITCH : 0,
      bearing: pitch3d ? map.getBearing() || -22 : 0,
      duration: 750,
      essential: true,
    })
  }, [pitch3d, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    applySelectionHighlight(map, selectedId)
    // Re-apply hover after selection clears feature-state on other ids
    if (highlightId) applyHoverHighlight(map, highlightId)
  }, [selectedId, highlightId, ready])

  /**
   * Detail selection → smooth flyTo (zoom 16, 1500ms).
   * Covers marker clicks, favorites, deep links — not nearest-picker fitBounds.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selectedId) return
    if (routeAnimatingRef.current) return
    if (nearestPills.length > 0) return
    const spot =
      spots.find((s) => s.id === selectedId) ??
      parkingIndex.getById(selectedId)
    if (!spot || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return
    const c = map.getCenter()
    const z = map.getZoom()
    const alreadyFocused =
      Math.abs(c.lat - spot.lat) < 0.00035 &&
      Math.abs(c.lng - spot.lng) < 0.00035 &&
      z >= 15.8
    if (alreadyFocused) {
      if (map.getPitch() < 20) {
        map.easeTo({ pitch: 30, duration: 400, essential: true })
      }
      return
    }
    map.flyTo({
      center: [spot.lng, spot.lat],
      zoom: 16,
      pitch: 30,
      duration: prefersReducedMotion() ? 0 : 1500,
      padding: panelCameraPadding(true, 'detail'),
      essential: true,
    })
  }, [selectedId, ready, nearestPills.length, spots])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    applyHoverHighlight(map, highlightId)
  }, [highlightId, ready])

  /** Native GL price pills — stay glued during pan/zoom (no HTML Marker jitter). */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (nearestPills.length === 0) {
      nearestPillsFitKeyRef.current = ''
      setPreviewLinkData(map, null)
      // Restore zone/badge labels when the nearest picker closes
      setParkingTextLabelsVisible(map, true)
    } else {
      // Hide underlying "KI"/zone badges so they don't glue onto "15 MIN" pills
      setParkingTextLabelsVisible(map, false)
    }
    setNearestPricePillData(map, nearestPills, nearestActivePillId)
  }, [nearestPills, nearestActivePillId, ready])

  /** Dashed pedestrian path: parking → destination (OSRM foot / sidewalk snap). */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!previewFocus?.target || !previewFocus.parking) {
      setPreviewLinkData(map, null)
      return
    }
    const path = previewFocus.walkPath
    if (path && path.length >= 2) {
      setPreviewLinkData(map, path)
      return
    }
    // Loading / no route yet — do not draw a building-crossing chord
    setPreviewLinkData(map, null)
  }, [previewFocus, ready])

  /** Frame searched target + all nearest pills (Lähimad parklad). */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !previewFocus || routeAnimatingRef.current) return
    const { target, parking, fitAll } = previewFocus
    const bounds = new LngLatBounds()
    bounds.extend([target.lng, target.lat])

    if (fitAll && nearestPills.length > 0) {
      for (const p of nearestPills) {
        bounds.extend([p.lng, p.lat])
      }
      const key = `${target.lat},${target.lng}|${nearestPills.map((p) => p.id).join(',')}`
      // Fit the full cluster once per picker open / option set
      if (nearestPillsFitKeyRef.current === key) return
      nearestPillsFitKeyRef.current = key
      try {
        map.fitBounds(bounds, {
          padding: panelCameraPadding(true, 'nearest'),
          maxZoom: 17,
          duration: prefersReducedMotion() ? 0 : 1000,
          pitch: 0,
          bearing: 0,
          essential: true,
        })
      } catch {
        /* ok */
      }
      return
    }

    if (!fitAll) {
      nearestPillsFitKeyRef.current = ''
    }

    if (parking) {
      bounds.extend([parking.lng, parking.lat])
      const pad = 0.00035
      bounds.extend([parking.lng - pad, parking.lat - pad])
      bounds.extend([parking.lng + pad, parking.lat + pad])
      try {
        map.fitBounds(bounds, {
          padding: panelCameraPadding(true, 'nearest'),
          maxZoom: 17,
          duration: prefersReducedMotion() ? 0 : 650,
          pitch: 0,
          bearing: 0,
          essential: true,
        })
      } catch {
        /* ok */
      }
    }
  }, [previewFocus, nearestPills, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    const walkSource = map.getSource(WALK_ROUTE_SOURCE) as GeoJSONSource | undefined
    if (!source) return

    if (routeDrawRafRef.current) {
      cancelAnimationFrame(routeDrawRafRef.current)
      routeDrawRafRef.current = 0
    }

    const empty = { type: 'FeatureCollection' as const, features: [] as never[] }

    const clearHandoverMarkers = () => {
      parkHandoverMarkerRef.current?.remove()
      parkHandoverMarkerRef.current = null
      walkMidMarkerRef.current?.remove()
      walkMidMarkerRef.current = null
    }

    if ((!route && !walkRoute) || !navigating) {
      source.setData(empty)
      walkSource?.setData(empty)
      clearHandoverMarkers()
      return
    }

    const full = route && route.coords.length >= 2 ? routeCoordsToLngLat(route.coords) : null
    const walkFull =
      walkRoute && walkRoute.coords.length >= 2
        ? routeCoordsToLngLat(walkRoute.coords)
        : null
    const walkFallback = Boolean(walkRoute?.isFallback)

    const setDriveSlice = (coords: [number, number][]) => {
      source.setData({
        type: 'FeatureCollection',
        features:
          coords.length >= 2
            ? [
                {
                  type: 'Feature',
                  properties: { kind: 'drive' },
                  geometry: { type: 'LineString', coordinates: coords },
                },
              ]
            : [],
      })
    }

    const setWalkSlice = (coords: [number, number][] | null) => {
      if (!walkSource) return
      if (!coords || coords.length < 2) {
        walkSource.setData(empty)
        return
      }
      walkSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'walk', fallback: walkFallback },
            geometry: { type: 'LineString', coordinates: coords },
          },
        ],
      })
    }

    // Parking "P" handover + mid-walk footprints (zoom ≥ 15)
    clearHandoverMarkers()
    if (walkFull && walkFull.length >= 2) {
      const parkLngLat = walkFull[0]
      const pEl = document.createElement('div')
      pEl.className = 'park-handover-marker'
      pEl.setAttribute('aria-hidden', 'true')
      pEl.innerHTML =
        '<div style="width:28px;height:28px;border-radius:9999px;background:#FF9500;color:#fff;font:700 13px/28px system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.28);border:2px solid #fff">P</div>'
      parkHandoverMarkerRef.current = new Marker({ element: pEl, anchor: 'center' })
        .setLngLat(parkLngLat as [number, number])
        .addTo(map)

      const midIdx = Math.floor(walkFull.length / 2)
      const mid = walkFull[midIdx] ?? walkFull[0]
      const midEl = document.createElement('div')
      midEl.className = 'walk-mid-marker'
      midEl.setAttribute('aria-hidden', 'true')
      midEl.style.display = map.getZoom() >= 15 ? 'block' : 'none'
      midEl.innerHTML =
        '<div style="width:26px;height:26px;border-radius:9999px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.22);border:1.5px solid #FF9500"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/></svg></div>'
      walkMidMarkerRef.current = new Marker({ element: midEl, anchor: 'center' })
        .setLngLat(mid as [number, number])
        .addTo(map)

      const onZoom = () => {
        if (walkMidMarkerRef.current) {
          const el = walkMidMarkerRef.current.getElement()
          el.style.display = map.getZoom() >= 15 ? 'block' : 'none'
        }
      }
      map.on('zoom', onZoom)
      // cleanup via effect return below — stash on element
      ;(midEl as HTMLElement & { __onZoom?: () => void }).__onZoom = onZoom
    }

    try {
      const beforeId = [
        PRECISE_FILL_LAYER,
        PARKING_LOTS_FILL_LAYER,
        PARKING_LINES_LAYER,
      ].find((id) => map.getLayer(id))
      if (beforeId) {
        if (map.getLayer('nav-route-glow')) map.moveLayer('nav-route-glow', beforeId)
        if (map.getLayer('nav-route-outline')) {
          map.moveLayer('nav-route-outline', beforeId)
        }
        if (map.getLayer('nav-route-line')) map.moveLayer('nav-route-line', beforeId)
        if (map.getLayer(WALK_ROUTE_GLOW)) map.moveLayer(WALK_ROUTE_GLOW, beforeId)
        if (map.getLayer(WALK_ROUTE_CASING)) map.moveLayer(WALK_ROUTE_CASING, beforeId)
        if (map.getLayer(WALK_ROUTE_LINE)) map.moveLayer(WALK_ROUTE_LINE, beforeId)
        if (map.getLayer('nav-walk-route-label')) {
          map.moveLayer('nav-walk-route-label', beforeId)
        }
      }
    } catch {
      /* ok */
    }

    if (prefersReducedMotion()) {
      if (full) setDriveSlice(full)
      else setDriveSlice([])
      setWalkSlice(walkFull)
      return () => {
        clearHandoverMarkers()
      }
    }

    // Animate drive first, then walk (~1.6–2 s total)
    setWalkSlice(null)
    if (full) setDriveSlice([full[0], full[0]])
    else setDriveSlice([])

    const driveMs = full ? 1100 : 0
    const walkMs = walkFull ? 700 : 0
    const started = performance.now()

    const tick = (now: number) => {
      const elapsed = now - started
      if (full && elapsed < driveMs) {
        const t = Math.min(1, elapsed / driveMs)
        const eased = 1 - (1 - t) ** 3
        const n = Math.max(2, Math.floor(1 + eased * (full.length - 1)))
        setDriveSlice(full.slice(0, n) as [number, number][])
        setWalkSlice(null)
      } else {
        if (full) setDriveSlice(full)
        if (walkFull) {
          const tw = Math.min(1, Math.max(0, (elapsed - driveMs) / Math.max(1, walkMs)))
          const eased = 1 - (1 - tw) ** 3
          const n = Math.max(2, Math.floor(1 + eased * (walkFull.length - 1)))
          setWalkSlice(walkFull.slice(0, n) as [number, number][])
        } else {
          setWalkSlice(null)
        }
      }
      if (elapsed < driveMs + walkMs) {
        routeDrawRafRef.current = requestAnimationFrame(tick)
      } else {
        if (full) setDriveSlice(full)
        setWalkSlice(walkFull)
        routeDrawRafRef.current = 0
      }
    }
    routeDrawRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (routeDrawRafRef.current) {
        cancelAnimationFrame(routeDrawRafRef.current)
        routeDrawRafRef.current = 0
      }
      const midEl = walkMidMarkerRef.current?.getElement() as
        | (HTMLElement & { __onZoom?: () => void })
        | undefined
      if (midEl?.__onZoom) map.off('zoom', midEl.__onZoom)
      clearHandoverMarkers()
    }
  }, [route, walkRoute, navigating, ready])

  useImperativeHandle(
    ref,
    () => ({
      cancelRouteIntro() {
        routeIntroCancelRef.current.cancelled = true
        routeAnimatingRef.current = false
        const map = mapRef.current
        if (map) {
          try {
            map.stop()
          } catch {
            /* ok */
          }
        }
      },
      async playRouteIntro({
        house,
        parking,
        origin,
        waitForRoute,
        waitForWalkRoute,
        routeWaitMs = 3000,
        onBeforeFitBounds,
        onFailed,
      }) {
        const map = mapRef.current
        if (!map) return 'failed'

        routeIntroCancelRef.current.cancelled = true
        const signal = { cancelled: false }
        routeIntroCancelRef.current = signal
        routeAnimatingRef.current = true

        const onUserGesture = () => {
          signal.cancelled = true
          routeAnimatingRef.current = false
          try {
            map.stop()
          } catch {
            /* ok */
          }
        }
        map.once('mousedown', onUserGesture)
        map.once('touchstart', onUserGesture)
        map.once('wheel', onUserGesture)

        const finish = () => {
          map.off('mousedown', onUserGesture)
          map.off('touchstart', onUserGesture)
          map.off('wheel', onUserGesture)
          routeAnimatingRef.current = false
        }

        const houseCenter: [number, number] = [house[1], house[0]]
        const parkingCenter: [number, number] = [parking[1], parking[0]]
        const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

        const fitPaddingForPanel = () => {
          const panelOpen = infoPanelOpenRef.current
          const desktop =
            typeof window !== 'undefined' &&
            window.matchMedia('(min-width: 640px)').matches
          const h =
            typeof window !== 'undefined' ? window.innerHeight : 800
          return {
            top: 150,
            bottom: panelOpen && !desktop ? Math.round(h * 0.4) : 120,
            left: panelOpen && desktop ? 380 : 70,
            right: 70,
          }
        }

        /** Final camera: parking + house (+ origin when not far away). */
        const buildArrivalBounds = (
          drive: RouteResult | null,
          walk: RouteResult | null,
        ) => {
          const bounds = new LngLatBounds()
          bounds.extend(parkingCenter)
          bounds.extend(houseCenter)
          if (walk) {
            for (const [lat, lng] of walk.coords) bounds.extend([lng, lat])
          }
          if (drive) {
            for (const [lat, lng] of drive.coords) bounds.extend([lng, lat])
          }
          if (origin) {
            const dPark = distanceMeters(
              origin[0],
              origin[1],
              parking[0],
              parking[1],
            )
            if (dPark < 1200) {
              bounds.extend([origin[1], origin[0]])
            }
          }
          return bounds
        }

        try {
          const reduced = prefersReducedMotion()
          const walkPromise = waitForWalkRoute ?? Promise.resolve(null)

          const awaitLegs = async () => {
            const [drive, walk] = await Promise.all([
              Promise.race([
                waitForRoute,
                delay(routeWaitMs, signal).then(() => null),
              ]),
              Promise.race([
                walkPromise,
                delay(routeWaitMs, signal).then(() => null),
              ]),
            ])
            return { drive, walk }
          }

          if (reduced) {
            const { drive, walk } = await awaitLegs()
            if (signal.cancelled) return 'cancelled'
            if (
              (!drive || drive.coords.length < 2) &&
              (!walk || walk.coords.length < 2)
            ) {
              onFailed?.()
              map.jumpTo({
                center: parkingCenter,
                zoom: 16.5,
                pitch: pitch3dRef.current ? NAV_PITCH : 0,
              })
              return 'failed'
            }
            onBeforeFitBounds?.(drive, walk)
            map.fitBounds(buildArrivalBounds(drive, walk), {
              padding: fitPaddingForPanel(),
              maxZoom: 16.5,
              pitch: 0,
              bearing: 0,
              animate: false,
              essential: true,
            })
            return 'fitted'
          }

          // ——— Step 1: zoom in on the parking spot (drive target) ———
          map.flyTo({
            center: parkingCenter,
            zoom: 17.0,
            pitch: pitch3dRef.current ? NAV_PITCH : 0,
            duration: 1100,
            essential: true,
            easing: easeOutCubic,
          })
          await waitMoveEnd(map, 1600)
          if (signal.cancelled) return 'cancelled'

          // ——— Step 2: short pause ———
          await delay(700, signal)
          if (signal.cancelled) return 'cancelled'

          const { drive, walk } = await awaitLegs()
          if (signal.cancelled) return 'cancelled'

          if (
            (!drive || drive.coords.length < 2) &&
            (!walk || walk.coords.length < 2)
          ) {
            onFailed?.()
            return 'failed'
          }

          // Reveal sheet + draw routes (via React state), then fit both legs
          onBeforeFitBounds?.(drive, walk)
          await delay(50, signal)
          if (signal.cancelled) return 'cancelled'

          // ——— Step 3: zoom out fitting both legs ———
          map.fitBounds(buildArrivalBounds(drive, walk), {
            padding: fitPaddingForPanel(),
            maxZoom: 16.8,
            duration: 1600,
            pitch: 0,
            bearing: 0,
            essential: true,
            easing: easeOutCubic,
          })
          await waitMoveEnd(map, 2200)
          return signal.cancelled ? 'cancelled' : 'fitted'
        } finally {
          finish()
        }
      },
    }),
    [],
  )

  return (
    <div className="relative z-0 h-full w-full" data-testid="map-view-root">
      {/* Map canvas — z-0; marker/data updates go through refs, not React re-renders of this wrapper */}
      <div ref={containerRef} className="h-full w-full maplibre-root" />
    </div>
  )
}))

MapView.displayName = 'MapView'
