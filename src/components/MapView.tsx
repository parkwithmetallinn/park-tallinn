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
import { useEffect, useRef, useState } from 'react'
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
import type { DrivingRoute } from '../lib/routing'
import type { ThemeMode } from '../lib/theme'
import type { CityId } from '../data/cities'
import { createBasemapStyle } from '../map/createBasemapStyle'
import {
  DISTRICT_FILL_LAYER,
  DISTRICT_SUBZONE_FILL_LAYER,
  ensureParkingOverlaySources,
  ROUTE_SOURCE,
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

/**
 * Map top filter chip → layer filter mode.
 * "Tasuta" uses verified_free so green features match the filter 1:1
 * (layer=free_street OR verified_free property on polygon/street features).
 */
function filterToLayers(
  filter: FilterId,
): ParkingLayerKey[] | 'all' | 'verified_free' {
  if (filter === 'all') return 'all'
  if (filter === 'free_street') return 'verified_free'
  if ((PARKING_PROVIDERS as string[]).includes(filter)) return [filter as ParkingLayerKey]
  return 'all'
}

function withoutSuppressed<T extends { properties: { id: string } }>(
  features: T[],
  suppressed: Set<string>,
): T[] {
  if (suppressed.size === 0) return features
  return features.filter((f) => !suppressed.has(f.properties.id))
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
) {
  const layers = filterToLayers(filter)

  const polys: PreciseParkingCollection | null = preciseFc
    ? {
        type: 'FeatureCollection',
        features: withoutSuppressed(preciseFc.features, suppressedIds),
      }
    : null

  let streets: StreetParkingCollection | null = streetFc
    ? {
        type: 'FeatureCollection',
        features: withoutSuppressed(streetFc.features, suppressedIds),
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

  const filterEvExempt = (feats: PreciseParkingCollection['features']) =>
    feats.filter(
      (f) =>
        f.properties.layer === 'ev' ||
        (Array.isArray((f.properties as { exemptions?: string[] }).exemptions) &&
          (f.properties as { exemptions?: string[] }).exemptions!.includes('ev_m1')),
    )

  if (polys) {
    const src = map.getSource(PRECISE_PARKING_SOURCE) as GeoJSONSource | undefined
    if (filter === 'ev') {
      src?.setData({
        type: 'FeatureCollection',
        features: filterEvExempt(polys.features),
      } as never)
    } else {
      src?.setData(filterPreciseCollection(polys, layers) as never)
    }
  }
  if (streets) {
    const src = map.getSource(STREET_PARKING_SOURCE) as GeoJSONSource | undefined
    if (filter === 'ev') {
      src?.setData({
        type: 'FeatureCollection',
        features: streets.features.filter(
          (f) =>
            f.properties.layer === 'ev' ||
            (Array.isArray((f.properties as { exemptions?: string[] }).exemptions) &&
              (f.properties as { exemptions?: string[] }).exemptions!.includes(
                'ev_m1',
              )),
        ),
      } as never)
    } else {
      src?.setData(filterStreetCollection(streets, layers) as never)
    }
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

export function MapView({
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
  navigating,
  onNavigate,
  onBackgroundClick,
  onZoomChange,
  onViewportStats,
  onPreciseSpotsLoaded,
  onStreetSpotsLoaded,
  onMapReady,
  suppressedFeatureIds,
  infoPanelOpen = false,
  cityId = 'tallinn',
}: {
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
  route: DrivingRoute | null
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
  /** Left/bottom info panel open — shift camera so pin stays visible. */
  infoPanelOpen?: boolean
  /** Active city layer (Tallinn default — keeps existing data path). */
  cityId?: CityId
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const searchMarkerRef = useRef<Marker | null>(null)
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
            ? result.spots.filter(
                (s) => s.layer === 'free_street' || s.zone_code === 'FREE' || s.type === 'free',
              )
            : filterRef.current === 'ev'
              ? result.spots.filter(
                  (s) => s.layer === 'ev' || s.exemptions?.includes('ev_m1'),
                )
              : result.spots.filter((s) => layers.includes(s.layer))

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
      } else {
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
                geometry: { type: 'LineString', coordinates: r.coordinates },
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
      // Tasuta: show only free_street pin layers; polygon/street GeoJSON
      // are filtered separately via verified_free.
      setParkingLayerVisibility(
        map,
        Object.fromEntries(
          PARKING_PROVIDERS.map((p) => [p, p === 'free_street']),
        ) as Partial<Record<ParkingLayerKey, boolean>>,
      )
    } else {
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !flyTarget) return
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
    if (!source) return
    if (!route || !navigating) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route.coordinates },
        },
      ],
    })
    try {
      map.moveLayer('nav-route-outline')
      map.moveLayer('nav-route-line')
    } catch {
      /* ok */
    }
  }, [route, navigating, ready])

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
}
