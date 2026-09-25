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
import { countSpotsInDistrict, spotsToMapGeoJSON } from '../lib/geojson'
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
  streetLineColor,
} from '../map/streetLineTheme'
import { NAV_PITCH } from '../map/theme'
import { ZOOM } from '../map/zoom'
import type { FilterId, ParkingLayerKey, PaidZone, ParkingSpot } from '../types'
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

function filterToLayers(filter: FilterId): ParkingLayerKey[] | 'all' {
  if (filter === 'all') return 'all'
  if ((PARKING_PROVIDERS as string[]).includes(filter)) return [filter as ParkingLayerKey]
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
}: {
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
  onViewportStats?: (stats: { rendered: number; skipped: boolean }) => void
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
      for (const layerId of [...parkingHitLayers, 'district-fill', 'paid-zones-fill']) {
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

      const pointSrc = m.getSource(PARKING_VIEWPORT_SOURCE) as GeoJSONSource | undefined
      const lineSrc = m.getSource(PARKING_LINES_SOURCE) as GeoJSONSource | undefined
      const lotSrc = m.getSource(PARKING_LOTS_SOURCE) as GeoJSONSource | undefined
      pointSrc?.setData(geo.points)
      lineSrc?.setData(geo.lines)
      lotSrc?.setData(geo.polygons)

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

    const openSpotPopup = (spot: ParkingSpot, lngLat: [number, number]) => {
      popupRef.current?.remove()
      const color =
        spot.line || spot.featureType === 'on-street-line' || spot.kind === 'street'
          ? streetLineColor(spot)
          : (PARKING_LAYER_META[spot.layer]?.color ?? '#64748B')
      const dist = formatDistance(
        distanceMeters(
          distanceFromRef.current[0],
          distanceFromRef.current[1],
          spot.lat,
          spot.lng,
        ),
      )
      const price =
        spot.price_per_hour > 0 ? `${spot.price_per_hour.toFixed(2)} €/h` : 'tasuta'
      const free =
        spot.free_minutes > 0 ? `${spot.free_minutes} min tasuta` : null
      const shape =
        spot.polygon || spot.featureType === 'off-street-lot'
          ? 'Parkla ala'
          : spot.line || spot.featureType === 'on-street-line'
            ? 'Tänavaäärne lõik'
            : spot.featureType
      const html = `
        <div class="ml-popup">
          <div class="ml-popup-top">
            <span class="ml-badge" style="background:${color}">${spot.badge}</span>
            <span class="ml-dist">${dist}</span>
          </div>
          <h4>${spot.name}</h4>
          <p class="ml-addr">${spot.address}</p>
          <p class="ml-meta">${spot.operator} · ${spot.zone_code} · ${price}${free ? ` · ${free}` : ''}</p>
          <p class="ml-meta">${shape} · ${spot.timeLimit}</p>
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

    /** Prefer parking features over large paid-zone fills (which would steal the click). */
    const onMapClick = (e: MapLayerMouseEvent) => {
      // Fat hit box — thin curb lines are hard to hit under 3D pitch
      const pad = 10
      const box: [[number, number], [number, number]] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ]
      const layers = parkingHitLayers.filter((id) => map.getLayer(id))
      const parkingHits =
        layers.length > 0 ? map.queryRenderedFeatures(box, { layers }) : []
      const parking = parkingHits.find((f) => f.properties?.id)
      if (parking?.properties?.id) {
        const spot = parkingIndex.getById(String(parking.properties.id))
        if (spot) {
          openSpotPopup(spot, [e.lngLat.lng, e.lngLat.lat])
          return
        }
      }

      const districtHits = map.queryRenderedFeatures(e.point, {
        layers: map.getLayer('district-fill') ? ['district-fill'] : [],
      })
      const district = districtHits[0]
      if (district && district.geometry.type === 'Polygon') {
        const ring = district.geometry.coordinates[0]
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
        return
      }

      const zoneHits = map.queryRenderedFeatures(e.point, {
        layers: map.getLayer('paid-zones-fill') ? ['paid-zones-fill'] : [],
      })
      const zone = zoneHits[0]
      if (zone) {
        popupRef.current?.remove()
        const zoneCode = zone.properties?.zone_code ? ` · ${zone.properties.zone_code}` : ''
        popupRef.current = new Popup({ offset: 8, className: 'park-popup', maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="ml-popup"><h4>${zone.properties?.name ?? ''}${zoneCode}</h4><p class="ml-desc">${zone.properties?.note ?? ''}</p></div>`,
          )
          .addTo(map)
      }
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
      calloutMarkersRef.current.forEach((m) => m.remove())
      userMarkerRef.current?.remove()
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(PAID_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        properties: {
          name: z.name,
          color: z.color,
          note: z.note,
          zone_code: z.zone_code ?? z.name.toUpperCase(),
          free_minutes: z.free_minutes ?? 15,
          price_per_hour: z.price_per_hour ?? 0,
          operator: z.operator ?? 'Tallinna Linn',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [z.coords.map(([lat, lng]) => [lng, lat])],
        },
      })),
    })
  }, [zones, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(DISTRICT_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData(buildDistrictGeoJSON(spots))
  }, [spots, ready])

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
    const refresh = (map as MapLibreMapType & { __refreshViewport?: () => void })
      .__refreshViewport
    refresh?.()
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
