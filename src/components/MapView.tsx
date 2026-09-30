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
  loadParkingPolygons,
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
  loadStreetParking,
  STREET_PARKING_HIT_LAYER,
  STREET_PARKING_LINE_LAYER,
  STREET_PARKING_SOURCE,
  streetCollectionToSpots,
  streetFeatureToSpot,
  type StreetParkingCollection,
  type StreetParkingFeature,
} from '../lib/streetParkingLines'
import { parkingIndex } from '../lib/spatialIndex'
import type { DrivingRoute } from '../lib/routing'
import { createBasemapStyle } from '../map/createBasemapStyle'
import {
  ensureParkingOverlaySources,
  ROUTE_SOURCE,
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

/** Apply top filter to both precise polygons + street curb LineStrings. */
function applyDualLayerFilter(
  map: MapLibreMapType,
  filter: FilterId,
  preciseFc: PreciseParkingCollection | null,
  streetFc: StreetParkingCollection | null,
) {
  const layers = filterToLayers(filter)
  if (preciseFc) {
    const src = map.getSource(PRECISE_PARKING_SOURCE) as GeoJSONSource | undefined
    src?.setData(filterPreciseCollection(preciseFc, layers) as never)
  }
  if (streetFc) {
    const src = map.getSource(STREET_PARKING_SOURCE) as GeoJSONSource | undefined
    src?.setData(filterStreetCollection(streetFc, layers) as never)
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

export function MapView({
  spots,
  filter,
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
}: {
  spots: ParkingSpot[]
  filter: FilterId
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
  const preciseFcRef = useRef<PreciseParkingCollection | null>(null)
  const streetFcRef = useRef<StreetParkingCollection | null>(null)
  const filterRef = useRef(filter)
  const selectedIdRef = useRef(selectedId)
  const pitch3dRef = useRef(pitch3d)
  const flyModeRef = useRef(flyMode)
  const loadGenRef = useRef(0)
  const [ready, setReady] = useState(false)

  onNavigateRef.current = onNavigate
  onBackgroundClickRef.current = onBackgroundClick
  onSearchPinClickRef.current = onSearchPinClick
  onPreciseSpotsLoadedRef.current = onPreciseSpotsLoaded
  onStreetSpotsLoadedRef.current = onStreetSpotsLoaded
  filterRef.current = filter
  selectedIdRef.current = selectedId
  pitch3dRef.current = pitch3d
  flyModeRef.current = flyMode

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: createBasemapStyle(),
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
      // Street lines come only from street_parking.geojson — never invent diagonals
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

    const finishSetup = () => {
      if (setupDone) return
      setupDone = true
      ensureParkingOverlaySources(map)
      bindHover()
      map.resize()
      map.setPitch(pitch3dRef.current ? NAV_PITCH : 0)
      try {
        map.setLight({
          anchor: 'viewport',
          color: '#ffffff',
          intensity: 0.28,
          position: [1.2, 210, 35],
        })
      } catch {
        /* older style without light support */
      }
      setReady(true)
      void refreshViewport(map)
      emitZoom(map)

      // Dual-layer: parking_polygons.geojson + street_parking.geojson
      // Click either → bottom sheet (rules + Waze/Google/Apple nav)
      void loadParkingPolygons()
        .then((fc) => {
          preciseFcRef.current = fc
          applyDualLayerFilter(map, filterRef.current, fc, streetFcRef.current)
          const spots = preciseCollectionToSpots(fc)
          for (const s of spots) parkingIndex.insert(s)
          onPreciseSpotsLoadedRef.current?.(spots)
          applySelectionHighlight(map, selectedIdRef.current)
        })
        .catch((err) => {
          console.warn('parking_polygons.geojson failed to load', err)
        })

      // Roadside curb lines — minzoom 12; green/red/blue by rules
      void loadStreetParking()
        .then((fc) => {
          streetFcRef.current = fc
          applyDualLayerFilter(map, filterRef.current, preciseFcRef.current, fc)
          const spots = streetCollectionToSpots(fc)
          for (const s of spots) parkingIndex.insert(s)
          onStreetSpotsLoadedRef.current?.(spots)
          applySelectionHighlight(map, selectedIdRef.current)
        })
        .catch((err) => {
          console.warn('street_parking.geojson failed to load', err)
        })
    }

    map.once('style.load', finishSetup)
    map.once('load', () => {
      if (map.isStyleLoaded()) finishSetup()
    })
    const readyTimer = window.setTimeout(() => {
      if (map.isStyleLoaded()) finishSetup()
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
            padding: { top: 80, bottom: 220, left: 48, right: 48 },
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

    ;(map as MapLibreMapType & { __refreshViewport?: () => void }).__refreshViewport = () => {
      void refreshViewport(map)
    }

    return () => {
      window.clearTimeout(readyTimer)
      window.clearTimeout(moveTimer)
      ro.disconnect()
      userMarkerRef.current?.remove()
      searchMarkerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // Filter lot polygons + street curb lines together
    applyDualLayerFilter(map, filter, preciseFcRef.current, streetFcRef.current)
    applySelectionHighlight(map, selectedIdRef.current)
    ;(map as MapLibreMapType & { __refreshViewport?: () => void }).__refreshViewport?.()
  }, [filter, ready])

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

    if (flyModeRef.current === 'fly') {
      map.flyTo({
        center,
        zoom,
        pitch,
        speed: 1.2,
        curve: 1.4,
        essential: true,
      })
    } else {
      map.easeTo({
        center,
        zoom,
        pitch,
        duration: 900,
        essential: true,
      })
    }
  }, [flyTarget, flyKey, flyZoom, ready])

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

  return <div ref={containerRef} className="h-full w-full maplibre-root" />
}
