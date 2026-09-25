import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type Map as MapLibreMapType,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'
import { DISTRICT_ZONES } from '../data/districts'
import { distanceMeters, formatDistance } from '../lib/geo'
import { countSpotsInDistrict, spotsToGeoJSON } from '../lib/geojson'
import { cellToPolygon, parseCellKey } from '../lib/grid'
import { queryParkingInViewport } from '../lib/parkingRepository'
import { parkingIndex } from '../lib/spatialIndex'
import type { DrivingRoute } from '../lib/routing'
import { createBasemapStyle } from '../map/createBasemapStyle'
import {
  DISTRICT_SOURCE,
  ensureParkingOverlaySources,
  PAID_SOURCE,
  ROUTE_SOURCE,
  setParkingLayerVisibility,
} from '../map/ensureOverlays'
import {
  GRID_DEBUG_SOURCE,
  PARKING_LAYER_META,
  PARKING_PROVIDERS,
  PARKING_VIEWPORT_SOURCE,
} from '../map/parkingLayers'
import { NAV_PITCH } from '../map/theme'
import { ZOOM } from '../map/zoom'
import type { FilterId, PaidZone, ParkingProvider, ParkingSpot } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorker)

function makeUserEl() {
  const wrap = document.createElement('div')
  wrap.className = 'user-location-wrap'
  wrap.innerHTML = `<div class="user-pulse"></div><div class="user-dot"></div>`
  return wrap
}

function makeCalloutEl(name: string) {
  const el = document.createElement('div')
  el.className = 'route-callout'
  el.textContent = name
  return el
}

function filterToProviders(filter: FilterId): ParkingProvider[] | 'all' {
  if (filter === 'all') return 'all'
  if (filter === 'free' || filter === 'street') return ['free_street', 'municipal']
  if (filter === 'timed') return ['timed']
  if (filter === 'lot') return ['municipal', 'europark', 'snabb']
  if (filter === 'pr') return ['park_ride']
  if (filter === 'paid') return ['europark', 'snabb']
  if ((PARKING_PROVIDERS as string[]).includes(filter)) return [filter as ParkingProvider]
  return 'all'
}

function buildDistrictGeoJSON(spots: ParkingSpot[]) {
  return {
    type: 'FeatureCollection' as const,
    features: DISTRICT_ZONES.map((d) => {
      const approx = countSpotsInDistrict(spots, d)
      const countLabel =
        approx.total > 0
          ? `${approx.total} kohta${approx.free ? ` · ${approx.free} tasuta` : ''}`
          : d.summary
      return {
        type: 'Feature' as const,
        properties: {
          id: d.id,
          name: d.name,
          color: d.color,
          kind: d.kind,
          summary: d.summary,
          count: approx.total,
          countLabel,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [d.coords.map(([lat, lng]) => [lng, lat])],
        },
      }
    }),
  }
}

export function MapView({
  spots,
  zones,
  filter,
  userLocation,
  flyTarget,
  flyKey,
  route,
  navigating,
  onNavigate,
  distanceFrom,
  onZoomChange,
  onViewportStats,
  showGridDebug = false,
}: {
  /** Full dataset for district aggregates + index is already bulk-loaded in App. */
  spots: ParkingSpot[]
  zones: PaidZone[]
  filter: FilterId
  userLocation: [number, number]
  flyTarget: [number, number] | null
  flyKey: number
  route: DrivingRoute | null
  navigating: boolean
  onNavigate: (spot: ParkingSpot) => void
  distanceFrom: [number, number]
  onZoomChange?: (zoom: number, mode: 'district' | 'cluster' | 'street') => void
  onViewportStats?: (stats: { cells: number; rendered: number }) => void
  showGridDebug?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const calloutMarkersRef = useRef<Marker[]>([])
  const popupRef = useRef<Popup | null>(null)
  const distanceFromRef = useRef(distanceFrom)
  const onNavigateRef = useRef(onNavigate)
  const filterRef = useRef(filter)
  const loadGenRef = useRef(0)
  const [ready, setReady] = useState(false)

  distanceFromRef.current = distanceFrom
  onNavigateRef.current = onNavigate
  filterRef.current = filter

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: createBasemapStyle(),
      center: [24.7535, 59.437],
      zoom: 11.8,
      pitch: NAV_PITCH,
      bearing: -28,
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
      'top-right',
    )
    mapRef.current = map

    let setupDone = false
    const finishSetup = () => {
      if (setupDone) return
      setupDone = true
      ensureParkingOverlaySources(map)
      map.resize()
      map.setPitch(NAV_PITCH)
      setReady(true)
      void refreshViewport(map)
      emitZoom(map)
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

      const providers = filterToProviders(filterRef.current)
      const visibleSpots =
        providers === 'all'
          ? result.spots
          : result.spots.filter((s) => providers.includes(s.provider))

      const source = m.getSource(PARKING_VIEWPORT_SOURCE) as GeoJSONSource | undefined
      if (source) {
        // Street zoom only — empty FeatureCollection when skipped
        source.setData(
          result.skippedForZoom || result.skippedForExtent
            ? { type: 'FeatureCollection', features: [] }
            : spotsToGeoJSON(visibleSpots),
        )
      }

      const gridSrc = m.getSource(GRID_DEBUG_SOURCE) as GeoJSONSource | undefined
      if (gridSrc) {
        gridSrc.setData({
          type: 'FeatureCollection',
          features: result.cellKeys.map((key) => ({
            type: 'Feature' as const,
            properties: { key },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [cellToPolygon(parseCellKey(key))],
            },
          })),
        })
      }

      onViewportStats?.({
        cells: result.cellKeys.length,
        rendered: visibleSpots.length,
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

    map.on('click', 'district-fill', (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature || feature.geometry.type !== 'Polygon') return
      const ring = feature.geometry.coordinates[0]
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const [x, y] of ring) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 48, duration: 900, pitch: NAV_PITCH, maxZoom: ZOOM.streetMin + 0.6 },
      )
    })

    const openSpotPopup = (spot: ParkingSpot, lngLat: [number, number]) => {
      popupRef.current?.remove()
      const color = PARKING_LAYER_META[spot.provider]?.color ?? '#64748B'
      const dist = formatDistance(
        distanceMeters(
          distanceFromRef.current[0],
          distanceFromRef.current[1],
          spot.lat,
          spot.lng,
        ),
      )
      const html = `
        <div class="ml-popup">
          <div class="ml-popup-top">
            <span class="ml-badge" style="background:${color}">${spot.badge}</span>
            <span class="ml-dist">${dist}</span>
          </div>
          <h4>${spot.name}</h4>
          <p class="ml-addr">${spot.address}</p>
          <p class="ml-meta">${spot.provider} · ${spot.timeLimit}</p>
          <p class="ml-desc">${spot.desc}</p>
          <button type="button" class="ml-nav-btn" data-spot="${spot.id}">Navigeeri</button>
        </div>
      `
      const popup = new Popup({
        offset: 14,
        closeButton: true,
        maxWidth: '280px',
        className: 'park-popup',
      })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map)
      popupRef.current = popup
      requestAnimationFrame(() => {
        document
          .querySelector(`.ml-nav-btn[data-spot="${spot.id}"]`)
          ?.addEventListener('click', () => {
            popup.remove()
            onNavigateRef.current(spot)
          })
      })
    }

    const onPointClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      const id = f?.properties?.id as string | undefined
      if (!id || !f || f.geometry.type !== 'Point') return
      const spot = parkingIndex.getById(id)
      if (!spot) return
      const [lng, lat] = f.geometry.coordinates as [number, number]
      openSpotPopup(spot, [lng, lat])
    }

    for (const provider of PARKING_PROVIDERS) {
      const layerId = PARKING_LAYER_META[provider].id
      map.on('click', layerId, onPointClick)
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    map.on('mouseenter', 'district-fill', () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'district-fill', () => {
      map.getCanvas().style.cursor = ''
    })

    map.on('click', 'paid-zones-fill', (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      popupRef.current?.remove()
      popupRef.current = new Popup({ offset: 8, className: 'park-popup', maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="ml-popup"><h4>${f.properties?.name ?? ''}</h4><p class="ml-desc">${f.properties?.note ?? ''}</p></div>`,
        )
        .addTo(map)
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    // stash refresh on map for filter updates
    ;(map as MapLibreMapType & { __refreshViewport?: () => void }).__refreshViewport = () => {
      void refreshViewport(map)
    }

    return () => {
      window.clearTimeout(readyTimer)
      window.clearTimeout(moveTimer)
      ro.disconnect()
      calloutMarkersRef.current.forEach((m) => m.remove())
      userMarkerRef.current?.remove()
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Paid zones
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(PAID_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        properties: { name: z.name, color: z.color, note: z.note },
        geometry: {
          type: 'Polygon',
          coordinates: [z.coords.map(([lat, lng]) => [lng, lat])],
        },
      })),
    })
  }, [zones, ready])

  // District polygons (overview) — uses full spot list once when it changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(DISTRICT_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData(buildDistrictGeoJSON(spots))
  }, [spots, ready])

  // Filter → layer visibility + re-query viewport subset
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const providers = filterToProviders(filter)
    if (providers === 'all') {
      setParkingLayerVisibility(
        map,
        Object.fromEntries(PARKING_PROVIDERS.map((p) => [p, true])),
      )
    } else {
      const vis = Object.fromEntries(
        PARKING_PROVIDERS.map((p) => [p, providers.includes(p)]),
      ) as Partial<Record<ParkingProvider, boolean>>
      setParkingLayerVisibility(map, vis)
    }
    const refresh = (map as MapLibreMapType & { __refreshViewport?: () => void })
      .__refreshViewport
    refresh?.()
  }, [filter, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (map.getLayer('grid-debug-line')) {
      map.setLayoutProperty(
        'grid-debug-line',
        'visibility',
        showGridDebug ? 'visible' : 'none',
      )
    }
  }, [showGridDebug, ready])

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
      zoom: Math.max(map.getZoom(), ZOOM.streetMin + 0.3),
      pitch: NAV_PITCH,
      duration: 1100,
    })
  }, [flyTarget, flyKey, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    if (!source) return

    calloutMarkersRef.current.forEach((m) => m.remove())
    calloutMarkersRef.current = []

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
          geometry: {
            type: 'LineString',
            coordinates: route.coordinates,
          },
        },
      ],
    })

    try {
      map.moveLayer('nav-route-outline')
      map.moveLayer('nav-route-line')
    } catch {
      /* ok */
    }

    for (const c of route.callouts) {
      const marker = new Marker({
        element: makeCalloutEl(c.name),
        anchor: 'bottom',
        offset: [0, -8],
      })
        .setLngLat([c.lng, c.lat])
        .addTo(map)
      calloutMarkersRef.current.push(marker)
    }

    const start = route.coordinates[0]
    map.easeTo({
      center: start,
      zoom: 16.4,
      pitch: NAV_PITCH,
      bearing: route.bearing,
      duration: 1400,
    })
  }, [route, navigating, ready])

  return <div ref={containerRef} className="h-full w-full maplibre-root" />
}
