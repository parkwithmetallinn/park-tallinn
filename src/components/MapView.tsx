import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type Map as MapLibreMapType,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'
import { spotsToMapGeoJSON } from '../lib/geojson'
import { queryParkingInViewport } from '../lib/parkingRepository'
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

function makeUserEl() {
  const wrap = document.createElement('div')
  wrap.className = 'user-location-wrap'
  wrap.innerHTML = `<div class="user-pulse"></div><div class="user-dot"></div>`
  return wrap
}

function filterToLayers(filter: FilterId): ParkingLayerKey[] | 'all' {
  if (filter === 'all') return 'all'
  if ((PARKING_PROVIDERS as string[]).includes(filter)) return [filter as ParkingLayerKey]
  return 'all'
}

export function MapView({
  spots,
  filter,
  userLocation,
  flyTarget,
  flyKey,
  flyZoom,
  route,
  navigating,
  onNavigate,
  onZoomChange,
  onViewportStats,
}: {
  spots: ParkingSpot[]
  filter: FilterId
  userLocation: [number, number]
  flyTarget: [number, number] | null
  flyKey: number
  flyZoom?: number
  route: DrivingRoute | null
  navigating: boolean
  onNavigate: (spot: ParkingSpot) => void
  onZoomChange?: (zoom: number, mode: 'district' | 'cluster' | 'street') => void
  onViewportStats?: (stats: { rendered: number; skipped: boolean }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const onNavigateRef = useRef(onNavigate)
  const filterRef = useRef(filter)
  const loadGenRef = useRef(0)
  const [ready, setReady] = useState(false)

  onNavigateRef.current = onNavigate
  filterRef.current = filter

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: createBasemapStyle(),
      center: [24.7535, 59.437],
      zoom: 14.2,
      pitch: NAV_PITCH,
      bearing: -22,
      maxPitch: 70,
      attributionControl: { compact: true },
      canvasContextAttributes: {
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        preserveDrawingBuffer: true,
      },
    })

    map.addControl(
      new NavigationControl({ visualizePitch: true, showCompass: true }),
      'bottom-right',
    )
    mapRef.current = map

    let setupDone = false
    const parkingHitLayers = [
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
        z >= ZOOM.streetMin ? 'street' : z >= ZOOM.districtMax ? 'cluster' : 'district'
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
          : result.spots.filter((s) => layers.includes(s.layer))

      const empty = { type: 'FeatureCollection' as const, features: [] }
      const geo =
        result.skippedForZoom || result.skippedForExtent
          ? { points: empty, lines: empty, polygons: empty }
          : spotsToMapGeoJSON(visibleSpots)

      ;(m.getSource(PARKING_VIEWPORT_SOURCE) as GeoJSONSource | undefined)?.setData(geo.points)
      ;(m.getSource(PARKING_LINES_SOURCE) as GeoJSONSource | undefined)?.setData(geo.lines)
      ;(m.getSource(PARKING_LOTS_SOURCE) as GeoJSONSource | undefined)?.setData(geo.polygons)

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
      map.setPitch(NAV_PITCH)
      setReady(true)
      void refreshViewport(map)
      emitZoom(map)
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
      const hit = hits.find((f) => f.properties?.id)
      if (!hit?.properties?.id) return
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
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep index in sync — App also bulkLoads; spots prop used for filter refresh only
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
    } else {
      const vis = Object.fromEntries(
        PARKING_PROVIDERS.map((p) => [p, layers.includes(p)]),
      ) as Partial<Record<ParkingLayerKey, boolean>>
      setParkingLayerVisibility(map, vis)
    }
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
    if (!map || !ready || !flyTarget) return
    map.easeTo({
      center: [flyTarget[1], flyTarget[0]],
      zoom: flyZoom ?? Math.max(map.getZoom(), ZOOM.streetMin + 0.8),
      pitch: NAV_PITCH,
      duration: 1200,
    })
  }, [flyTarget, flyKey, flyZoom, ready])

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
