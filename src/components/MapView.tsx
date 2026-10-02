import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type Map as MapLibreMapType,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
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
  filterStreetCollection,
  getLastStreetPurgeStats,
  STREET_PARKING_HIT_LAYER,
  STREET_PARKING_LINE_LAYER,
  STREET_PARKING_SOURCE,
  streetCollectionToSpots,
  streetFeatureToSpot,
  type StreetParkingCollection,
  type StreetParkingFeature,
} from '../lib/streetParkingLines'
import {
  getCachedCityPolygons,
  getCachedCityStreets,
  loadCityParking,
} from '../lib/cityParkingCache'
import { dedupeStreetAgainstPolygons } from '../lib/spatialDedupe'
import { parkingIndex } from '../lib/spatialIndex'
import {
  routeCoordsToLngLat,
  type RouteResult,
} from '../lib/routing'
import type { ThemeMode } from '../lib/theme'
import type { CityId } from '../data/cities'
import { createBasemapStyle } from '../map/createBasemapStyle'
import {
  DISTRICT_FILL_LAYER,
  DISTRICT_SUBZONE_FILL_LAYER,
  ensureParkingOverlaySources,
  ROUTE_SOURCE,
  WALK_ROUTE_CASING,
  WALK_ROUTE_LINE,
  WALK_ROUTE_SOURCE,
  setCityDistrictOverlays,
  setDistrictDebugVisible,
  setDistrictHover,
  setParkingLayerVisibility,
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
import { NAV_PITCH } from '../map/theme'
import { ZOOM } from '../map/zoom'
import {
  isClockLimitedParking,
  isUnlimitedFreeParking,
} from '../lib/parkingClassification'
import type { FilterId, ParkingLayerKey, ParkingSpot } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorker)

const SELECT_SOURCES = [
  PARKING_LINES_SOURCE,
  PARKING_LOTS_SOURCE,
  PARKING_VIEWPORT_SOURCE,
  PRECISE_PARKING_SOURCE,
  STREET_PARKING_SOURCE,
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

function makeUserEl() {
  const wrap = document.createElement('div')
  wrap.className = 'user-location-wrap'
  wrap.innerHTML = `<div class="user-pulse"></div><div class="user-dot"></div>`
  return wrap
}

function makeSearchPinEl(onClick: () => void) {
  const wrap = document.createElement('button')
  wrap.type = 'button'
  wrap.className = 'search-pin'
  wrap.setAttribute('aria-label', 'Ava asukoha info')
  wrap.innerHTML = `<span class="search-pin-dot"></span>`
  wrap.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return wrap
}

function makeFullSpotEl() {
  const wrap = document.createElement('div')
  wrap.className = 'full-spot-badge'
  wrap.setAttribute('aria-label', 'Parkla on täis')
  wrap.textContent = 'TÄIS'
  return wrap
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
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
   * Zoom out from the house → pause → zoom in to parking + house.
   * Driving route is user → parking; walking route is parking → house.
   * Opens the info sheet via onBeforeFitBounds before the zoom-in.
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
      drive: RouteResult,
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
 */
function filterToLayers(
  filter: FilterId,
): ParkingLayerKey[] | 'all' | 'verified_free' | 'clock' | 'unclassified' | 'paid' {
  if (filter === 'all') return 'all'
  if (filter === 'free_street') return 'verified_free'
  if (filter === 'timed') return 'clock'
  if (filter === 'paid') return 'paid'
  if (filter === 'other') return 'unclassified'
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
function applyDualLayerFilter(
  map: MapLibreMapType,
  filter: FilterId,
  preciseFc: PreciseParkingCollection | null,
  streetFc: StreetParkingCollection | null,
  suppressedIds: Set<string> = new Set(),
  cityId: CityId = 'tallinn',
) {
  const layers = filterToLayers(filter)

  // Pärnu RED paid-zone overlays only under Kõik / Tasuline
  if (cityId === 'parnu') {
    setCityDistrictOverlays(map, 'parnu', {
      showPaidZones: filter === 'all' || filter === 'paid',
    })
  }

  const polys: PreciseParkingCollection | null = preciseFc
    ? {
        type: 'FeatureCollection',
        features: withoutParnuEvFeatures(
          withoutSuppressed(preciseFc.features, suppressedIds),
          cityId,
        ),
      }
    : null

  let streets: StreetParkingCollection | null = streetFc
    ? {
        type: 'FeatureCollection',
        features: withoutParnuEvFeatures(
          withoutSuppressed(streetFc.features, suppressedIds),
          cityId,
        ),
      }
    : null

  // Spatial dedupe: drop curb lines that sit in / along lot polygons
  if (streets && polys) {
    const deduped = dedupeStreetAgainstPolygons(streets, polys)
    streets = deduped.collection
    if (import.meta.env.DEV && deduped.suppressed > 0) {
      console.info('[parking] spatial dedupe suppressed streets', deduped.suppressed)
    }
  }

  if (polys) {
    const src = map.getSource(PRECISE_PARKING_SOURCE) as GeoJSONSource | undefined
    src?.setData(filterPreciseCollection(polys, layers) as never)
  }
  if (streets) {
    const src = map.getSource(STREET_PARKING_SOURCE) as GeoJSONSource | undefined
    src?.setData(filterStreetCollection(streets, layers) as never)
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


/** Camera padding so the focus point sits in the free map area (not under the info panel). */
function panelCameraPadding(panelOpen: boolean): {
  top: number
  bottom: number
  left: number
  right: number
} {
  const desktop =
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 640px)').matches
  if (!panelOpen) {
    return { top: 96, bottom: 48, left: 24, right: 56 }
  }
  if (desktop) {
    return { top: 96, bottom: 48, left: 380, right: 56 }
  }
  const bottom = Math.round(window.innerHeight * 0.42)
  return { top: 80, bottom, left: 16, right: 16 }
}

export const MapView = forwardRef<
  MapViewHandle,
  {
    spots: ParkingSpot[]
    filter: FilterId
    /** Basemap + overlay theme (light | dark). */
    theme?: ThemeMode
    userLocation: [number, number]
    flyTarget: [number, number] | null
    flyKey: number
    flyZoom?: number
    /** `fly` = MapLibre flyTo (search); `ease` = easeTo (recenter). */
    flyMode?: 'fly' | 'ease'
    /** When true, use Apple Maps–style pitched 3D; when false, flat 2D. */
    pitch3d?: boolean
    selectedId?: string | null
    /** Dropped search / address pin */
    searchPin?: { lat: number; lng: number } | null
    onSearchPinClick?: () => void
    /** Driving route (user → parking) */
    route: RouteResult | null
    /** Walking route (parking → house), dashed on the map */
    walkRoute?: RouteResult | null
    navigating: boolean
    onNavigate: (spot: ParkingSpot) => void
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
    /** Crowdsourced "lot is full" marks (60 min TTL) — grey TÄIS badges. */
    fullSpotIds?: Set<string> | string[]
    /** Left/bottom info panel open — shift camera so pin stays visible. */
    infoPanelOpen?: boolean
    /** Active city layer (Tallinn default — keeps existing data path). */
    cityId?: CityId
  }
>(function MapView(
  {
    spots,
    filter,
    theme = 'light',
    userLocation,
    flyTarget,
    flyKey,
    flyZoom,
    flyMode = 'ease',
    pitch3d = true,
    selectedId = null,
    searchPin = null,
    onSearchPinClick,
    route,
    walkRoute = null,
    navigating,
    onNavigate,
    onBackgroundClick,
    onZoomChange,
    onViewportStats,
    onPreciseSpotsLoaded,
    onStreetSpotsLoaded,
    onMapReady,
    suppressedFeatureIds,
    fullSpotIds,
    infoPanelOpen = false,
    cityId = 'tallinn',
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const searchMarkerRef = useRef<Marker | null>(null)
  const fullMarkersRef = useRef<Map<string, Marker>>(new Map())
  const routeAnimatingRef = useRef(false)
  const routeIntroCancelRef = useRef({ cancelled: false })
  const routeDrawRafRef = useRef(0)
  const walkRouteRef = useRef(walkRoute)
  const onNavigateRef = useRef(onNavigate)
  const onBackgroundClickRef = useRef(onBackgroundClick)
  const onSearchPinClickRef = useRef(onSearchPinClick)
  const onPreciseSpotsLoadedRef = useRef(onPreciseSpotsLoaded)
  const onStreetSpotsLoadedRef = useRef(onStreetSpotsLoaded)
  const onMapReadyRef = useRef(onMapReady)
  const preciseFcRef = useRef<PreciseParkingCollection | null>(null)
  const streetFcRef = useRef<StreetParkingCollection | null>(null)
  /** Raw street FC before spatial dedupe (dedupe runs in applyDualLayerFilter). */
  const streetRawFcRef = useRef<StreetParkingCollection | null>(null)
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
  const loadGenRef = useRef(0)
  const [ready, setReady] = useState(false)

  onNavigateRef.current = onNavigate
  onBackgroundClickRef.current = onBackgroundClick
  onSearchPinClickRef.current = onSearchPinClick
  onPreciseSpotsLoadedRef.current = onPreciseSpotsLoaded
  onStreetSpotsLoadedRef.current = onStreetSpotsLoaded
  onMapReadyRef.current = onMapReady
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

    const map = new MapLibreMap({
      container: containerRef.current,
      style: createBasemapStyle(themeRef.current),
      center: [24.7535, 59.437],
      zoom: 14.2,
      pitch: pitch3dRef.current ? NAV_PITCH : 0,
      bearing: pitch3dRef.current ? -22 : 0,
      maxPitch: 70,
      attributionControl: { compact: true },
      canvasContextAttributes: {
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        preserveDrawingBuffer: true,
      },
    })

    mapRef.current = map
    // Dev/test hook for LOD screenshots & debugging (non-reactive).
    ;(window as unknown as { __parkMap?: typeof map }).__parkMap = map

    let setupDone = false
    const parkingHitLayers = [
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

    const bindHover = () => {
      for (const layerId of parkingHitLayers) {
        if (!map.getLayer(layerId)) continue
        map.on('mouseenter', layerId, setPointer)
        map.on('mouseleave', layerId, clearPointer)
      }
    }

    const emitZoom = (m: MapLibreMapType) => {
      const z = m.getZoom()
      const mode =
        z >= ZOOM.detailMin ? 'street' : z >= ZOOM.lotMin ? 'cluster' : 'district'
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
        layers === 'all'
          ? result.spots
          : layers === 'verified_free'
            ? result.spots.filter((s) => isUnlimitedFreeParking(s))
            : layers === 'clock'
              ? result.spots.filter((s) => isClockLimitedParking(s))
              : layers === 'unclassified'
                ? result.spots.filter((s) => s.layer === 'municipal')
                : layers === 'paid'
                  ? result.spots.filter(
                      (s) =>
                        s.layer !== 'free_street' &&
                        s.layer !== 'timed' &&
                        s.layer !== 'ev' &&
                        !isClockLimitedParking(s),
                    )
                  : Array.isArray(layers)
                    ? result.spots.filter((s) => layers.includes(s.layer))
                    : result.spots

      const empty = { type: 'FeatureCollection' as const, features: [] }
      let geo =
        result.skippedForZoom || result.skippedForExtent
          ? { points: empty, lines: empty, polygons: empty }
          : spotsToMapGeoJSON(visibleSpots)

      // LOD: zoom < 13 → empty overlays (districts only)
      //      zoom 13–15 → lot polygons only
      //      zoom ≥ 15 → pins (EV / timed / INVA) + future curb lines
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
        setParkingLayerVisibility(
          map,
          Object.fromEntries(
            PARKING_PROVIDERS.map((p) => [p, p === 'timed']),
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
      )
      applySelectionHighlight(map, selectedIdRef.current)
      setDistrictDebugVisible(map, districtDebugRef.current)

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
                properties: { kind: 'walk' },
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
      appliedThemeRef.current = themeRef.current

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
        setReady(true)
        onMapReadyRef.current?.()
        void refreshViewport(map)
        emitZoom(map)

        // Dual-layer parking (Tallinn master or Pärnu city extract).
        // Prep purges private/underground; spatial dedupe prefers polygons.
        const applyPoly = (fc: PreciseParkingCollection) => {
          preciseFcRef.current = fc
          applyDualLayerFilter(
            map,
            filterRef.current,
            fc,
            streetRawFcRef.current,
            suppressedRef.current,
            cityIdRef.current,
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

        const applyStreet = (fc: StreetParkingCollection) => {
          streetRawFcRef.current = fc
          const deduped = preciseFcRef.current
            ? dedupeStreetAgainstPolygons(
                {
                  type: 'FeatureCollection',
                  features: withoutSuppressed(fc.features, suppressedRef.current),
                },
                {
                  type: 'FeatureCollection',
                  features: withoutSuppressed(
                    preciseFcRef.current.features,
                    suppressedRef.current,
                  ),
                },
              )
            : {
                collection: {
                  type: 'FeatureCollection' as const,
                  features: withoutSuppressed(fc.features, suppressedRef.current),
                },
                suppressed: 0,
                kept: fc.features.length,
                suppressedIds: [] as string[],
              }
          streetFcRef.current = deduped.collection
          applyDualLayerFilter(
            map,
            filterRef.current,
            preciseFcRef.current,
            streetRawFcRef.current,
            suppressedRef.current,
            cityIdRef.current,
          )
          const spots = streetCollectionToSpots(deduped.collection)
          for (const s of spots) parkingIndex.insert(s)
          onStreetSpotsLoadedRef.current?.(spots)
          applySelectionHighlight(map, selectedIdRef.current)
          if (import.meta.env.DEV) {
            console.info('[parking] street purge', getLastStreetPurgeStats())
            console.info('[parking] spatial dedupe', {
              suppressed: deduped.suppressed,
              kept: deduped.kept,
            })
          }
        }

        const city = cityIdRef.current
        setCityDistrictOverlays(map, city)
        const warmPoly = getCachedCityPolygons(city)
        const warmStreet = getCachedCityStreets(city)
        if (warmPoly) applyPoly(warmPoly)
        if (warmStreet) applyStreet(warmStreet)

        void loadCityParking(city)
          .then((split) => {
            if (cityIdRef.current !== city) return
            applyPoly(split.polygons)
            applyStreet(split.streets)
          })
          .catch((err) => {
            console.warn(`[parking] ${city} master failed to load`, err)
          })
        return
      }

      // Theme / style reload — restore overlays + filters + selection + camera data
      reapplyOverlayData()
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
      const pad = 12
      const box: [[number, number], [number, number]] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ]
      const layers = parkingHitLayers.filter((id) => map.getLayer(id))
      const hits = layers.length ? map.queryRenderedFeatures(box, { layers }) : []

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
      ro.disconnect()
      userMarkerRef.current?.remove()
      searchMarkerRef.current?.remove()
      for (const m of fullMarkersRef.current.values()) m.remove()
      fullMarkersRef.current.clear()
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

    const warmPoly = getCachedCityPolygons(cityId)
    const warmStreet = getCachedCityStreets(cityId)
    if (warmPoly) {
      preciseFcRef.current = warmPoly
      applyDualLayerFilter(
        map,
        filterRef.current,
        warmPoly,
        streetRawFcRef.current,
        suppressedRef.current,
        cityIdRef.current,
      )
      const spots = preciseCollectionToSpots({
        type: 'FeatureCollection',
        features: withoutSuppressed(warmPoly.features, suppressedRef.current),
      })
      for (const s of spots) parkingIndex.insert(s)
      onPreciseSpotsLoadedRef.current?.(spots)
    }
    if (warmStreet) {
      streetRawFcRef.current = warmStreet
      applyDualLayerFilter(
        map,
        filterRef.current,
        preciseFcRef.current,
        warmStreet,
        suppressedRef.current,
        cityIdRef.current,
      )
      const spots = streetCollectionToSpots(warmStreet)
      for (const s of spots) parkingIndex.insert(s)
      onStreetSpotsLoadedRef.current?.(spots)
    }

    void loadCityParking(cityId)
      .then((split) => {
        if (cityIdRef.current !== cityId || !mapRef.current) return
        preciseFcRef.current = split.polygons
        streetRawFcRef.current = split.streets
        applyDualLayerFilter(
          mapRef.current,
          filterRef.current,
          split.polygons,
          split.streets,
          suppressedRef.current,
          cityIdRef.current,
        )
        const lots = preciseCollectionToSpots({
          type: 'FeatureCollection',
          features: withoutSuppressed(split.polygons.features, suppressedRef.current),
        })
        const streets = streetCollectionToSpots(split.streets)
        for (const s of lots) parkingIndex.insert(s)
        for (const s of streets) parkingIndex.insert(s)
        onPreciseSpotsLoadedRef.current?.(lots)
        onStreetSpotsLoadedRef.current?.(streets)
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
    } else if (layers === 'verified_free') {
      // Tasuta: unlimited free pins only; GeoJSON filtered via verified_free.
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, p === 'free_street']),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (layers === 'clock') {
      // Kellaga: clock-limited pins; GeoJSON filtered via 'clock'.
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, p === 'timed']),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else if (layers === 'unclassified') {
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
    )
    applySelectionHighlight(map, selectedIdRef.current)
    ;(map as MapLibreMapType & { __refreshViewport?: () => void }).__refreshViewport?.()
  }, [filter, ready, suppressedFeatureIds])

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

  /** Grey TÄIS badges for crowdsourced full lots. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const ids = new Set(
      fullSpotIds instanceof Set
        ? fullSpotIds
        : Array.isArray(fullSpotIds)
          ? fullSpotIds
          : [],
    )
    const byId = new Map(spots.map((s) => [s.id, s]))
    const markers = fullMarkersRef.current

    for (const [id, marker] of markers) {
      if (!ids.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }
    for (const id of ids) {
      const spot = byId.get(id) ?? parkingIndex.getById(id)
      if (!spot) continue
      const existing = markers.get(id)
      if (existing) {
        existing.setLngLat([spot.lng, spot.lat])
      } else {
        const m = new Marker({
          element: makeFullSpotEl(),
          anchor: 'center',
        })
          .setLngLat([spot.lng, spot.lat])
          .addTo(map)
        markers.set(id, m)
      }
    }
  }, [fullSpotIds, spots, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !flyTarget) return
    // Route intro owns the camera — ignore flyTarget/recenter until done
    if (routeAnimatingRef.current) return
    const center: [number, number] = [flyTarget[1], flyTarget[0]]
    const zoom = flyZoom ?? Math.max(map.getZoom(), ZOOM.detailMin + 0.4)
    const pitch = pitch3dRef.current ? NAV_PITCH : 0

    // Search flies open an info panel ~720ms later — pad now so the pin
    // lands in the free map area instead of under the forthcoming sheet.
    const padding = panelCameraPadding(
      infoPanelOpenRef.current || flyModeRef.current === 'fly',
    )
    if (flyModeRef.current === 'fly') {
      map.flyTo({
        center,
        zoom,
        pitch,
        padding,
        speed: 1.2,
        curve: 1.4,
        essential: true,
      })
    } else {
      map.easeTo({
        center,
        zoom,
        pitch,
        padding,
        duration: 900,
        essential: true,
      })
    }
  }, [flyTarget, flyKey, flyZoom, ready])

  // Keep focus clear of the left/bottom info panel when it opens/closes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (routeAnimatingRef.current) return
    map.easeTo({
      padding: panelCameraPadding(infoPanelOpen),
      duration: 280,
      essential: true,
    })
  }, [infoPanelOpen, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
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
  }, [selectedId, ready])

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

    if (!route || !navigating) {
      source.setData(empty)
      walkSource?.setData(empty)
      return
    }

    const full = routeCoordsToLngLat(route.coords)
    const walkFull =
      walkRoute && walkRoute.coords.length >= 2
        ? routeCoordsToLngLat(walkRoute.coords)
        : null

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

    const setWalkFull = () => {
      if (!walkSource) return
      if (!walkFull) {
        walkSource.setData(empty)
        return
      }
      walkSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'walk' },
            geometry: { type: 'LineString', coordinates: walkFull },
          },
        ],
      })
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
        if (map.getLayer(WALK_ROUTE_CASING)) map.moveLayer(WALK_ROUTE_CASING, beforeId)
        if (map.getLayer(WALK_ROUTE_LINE)) map.moveLayer(WALK_ROUTE_LINE, beforeId)
        if (map.getLayer('nav-walk-route-label')) {
          map.moveLayer('nav-walk-route-label', beforeId)
        }
      }
    } catch {
      /* ok */
    }

    // Show walk path immediately (short leg); animate the drive line
    setWalkFull()

    if (prefersReducedMotion() || full.length < 2) {
      setDriveSlice(full)
      return
    }

    const duration = 1400
    const started = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - t) ** 3
      const n = Math.max(2, Math.floor(1 + eased * (full.length - 1)))
      setDriveSlice(full.slice(0, n) as [number, number][])
      if (t < 1) {
        routeDrawRafRef.current = requestAnimationFrame(tick)
      } else {
        routeDrawRafRef.current = 0
      }
    }
    routeDrawRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (routeDrawRafRef.current) {
        cancelAnimationFrame(routeDrawRafRef.current)
        routeDrawRafRef.current = 0
      }
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
        const easeInOutCubic = (t: number) =>
          t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

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
          drive: RouteResult,
          walk: RouteResult | null,
        ) => {
          const bounds = new LngLatBounds()
          bounds.extend(parkingCenter)
          bounds.extend(houseCenter)
          if (walk) {
            for (const [lat, lng] of walk.coords) bounds.extend([lng, lat])
          }
          if (origin) {
            const dPark = Math.hypot(
              origin[0] - parking[0],
              origin[1] - parking[1],
            )
            // ~1.2 km in degrees ≈ 0.011 — keep start in frame when nearby
            if (dPark < 0.012) {
              bounds.extend([origin[1], origin[0]])
            }
          }
          // Nudge with the last stretch of the drive so the approach isn't clipped
          const tail = drive.coords.slice(-8)
          for (const [lat, lng] of tail) bounds.extend([lng, lat])
          return bounds
        }

        try {
          const reduced = prefersReducedMotion()
          const walkPromise = waitForWalkRoute ?? Promise.resolve(null)

          if (reduced) {
            const [drive, walk] = await Promise.all([
              Promise.race([
                waitForRoute,
                delay(routeWaitMs).then(() => null),
              ]),
              Promise.race([
                walkPromise,
                delay(routeWaitMs).then(() => null),
              ]),
            ])
            if (signal.cancelled) return 'cancelled'
            if (!drive || drive.coords.length < 2) {
              onFailed?.()
              map.jumpTo({
                center: houseCenter,
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

          // ——— Step 0: land on the house (final destination stays fixed) ———
          map.flyTo({
            center: houseCenter,
            zoom: 17.2,
            pitch: pitch3dRef.current ? NAV_PITCH : 0,
            duration: 1200,
            essential: true,
            easing: easeOutCubic,
          })
          await waitMoveEnd(map, 1800)
          if (signal.cancelled) return 'cancelled'

          // ——— Step 1: zoom OUT to reveal surrounding parking ———
          map.easeTo({
            center: houseCenter,
            zoom: 14.1,
            pitch: Math.min(40, pitch3dRef.current ? NAV_PITCH : 0),
            duration: 1400,
            essential: true,
            easing: easeInOutCubic,
          })
          await waitMoveEnd(map, 2000)
          if (signal.cancelled) return 'cancelled'

          // Brief hold so the user can scan nearby lots
          await delay(1200, signal)
          if (signal.cancelled) return 'cancelled'

          // Wait for drive (+ walk) routes
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
          if (signal.cancelled) return 'cancelled'

          if (!drive || drive.coords.length < 2) {
            onFailed?.()
            return 'failed'
          }

          // Reveal sheet + draw routes (via React state), then zoom IN
          onBeforeFitBounds?.(drive, walk)
          await delay(50, signal)
          if (signal.cancelled) return 'cancelled'

          // ——— Step 2: zoom IN to parking + house (balanced frame) ———
          map.fitBounds(buildArrivalBounds(drive, walk), {
            padding: fitPaddingForPanel(),
            maxZoom: 16.8,
            duration: 1800,
            pitch: 0,
            bearing: 0,
            essential: true,
            easing: easeOutCubic,
          })
          await waitMoveEnd(map, 2400)
          return signal.cancelled ? 'cancelled' : 'fitted'
        } finally {
          finish()
        }
      },
    }),
    [],
  )

  const [districtDebug, setDistrictDebug] = useState(false)

  useEffect(() => {
    districtDebugRef.current = districtDebug
    const map = mapRef.current
    if (!ready || !map) return
    setDistrictDebugVisible(map, districtDebug)
  }, [districtDebug, ready])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full maplibre-root" />
      {/* Temporary QA toggle for district reference markers */}
      <button
        type="button"
        onClick={() => setDistrictDebug((v) => !v)}
        className="district-qa-btn absolute bottom-28 left-3 z-20 rounded-md border border-slate-300 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white"
        title="Toggle district QA reference points"
      >
        {districtDebug ? 'District QA: ON' : 'District QA'}
      </button>
    </div>
  )
})
