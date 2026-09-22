import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type Map as MapLibreMapType,
} from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'
import { distanceMeters, formatDistance } from '../lib/geo'
import { TYPE_COLORS } from '../lib/parking'
import type { DrivingRoute } from '../lib/routing'
import {
  applyWazeTheme,
  FALLBACK_STYLE,
  NAV_PITCH,
  ROUTE_COLOR,
  ROUTE_OUTLINE,
} from '../map/wazeTheme'
import type { PaidZone, ParkingSpot } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorker)

const ROUTE_SOURCE = 'nav-route'
const ZONES_SOURCE = 'paid-zones'

function makePinEl(color: string, label: string) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'marker-pin'
  el.style.backgroundColor = color
  el.textContent = label
  return el
}

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

function ensureOverlaySources(map: MapLibreMapType) {
  if (!map.getSource(ZONES_SOURCE)) {
    map.addSource(ZONES_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'paid-zones-fill',
      type: 'fill',
      source: ZONES_SOURCE,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 },
    })
    map.addLayer({
      id: 'paid-zones-line',
      type: 'line',
      source: ZONES_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
    })
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
        'line-color': ROUTE_OUTLINE,
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
        'line-color': ROUTE_COLOR,
        'line-width': 8,
        'line-opacity': 1,
      },
    })
  }
}

export function MapView({
  spots,
  zones,
  userLocation,
  flyTarget,
  flyKey,
  route,
  navigating,
  onNavigate,
  distanceFrom,
}: {
  spots: ParkingSpot[]
  zones: PaidZone[]
  userLocation: [number, number]
  flyTarget: [number, number] | null
  flyKey: number
  route: DrivingRoute | null
  navigating: boolean
  onNavigate: (spot: ParkingSpot) => void
  distanceFrom: [number, number]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const spotMarkersRef = useRef<Marker[]>([])
  const userMarkerRef = useRef<Marker | null>(null)
  const calloutMarkersRef = useRef<Marker[]>([])
  const popupRef = useRef<Popup | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: FALLBACK_STYLE,
      center: [24.7535, 59.437],
      zoom: 13.5,
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
      // FALLBACK_STYLE is already Waze-colored; only tweak if remote liberty was used
      const layerIds = map.getStyle().layers?.map((l) => l.id) ?? []
      if (layerIds.some((id) => id.includes('highway') || id.includes('park'))) {
        try {
          applyWazeTheme(map)
        } catch (e) {
          console.warn('Waze theme apply failed', e)
        }
      }
      ensureOverlaySources(map)
      map.resize()
      map.setPitch(NAV_PITCH)
      map.triggerRepaint()
      setReady(true)
      console.info('[map] ready', {
        layers: map.getStyle().layers?.length,
        pitch: map.getPitch(),
      })
    }

    map.once('style.load', finishSetup)
    map.once('load', () => {
      if (map.isStyleLoaded()) finishSetup()
    })
    const readyTimer = window.setTimeout(() => {
      if (map.isStyleLoaded()) finishSetup()
    }, 2500)

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    return () => {
      window.clearTimeout(readyTimer)
      ro.disconnect()
      spotMarkersRef.current.forEach((m) => m.remove())
      calloutMarkersRef.current.forEach((m) => m.remove())
      userMarkerRef.current?.remove()
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(ZONES_SOURCE) as GeoJSONSource | undefined
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    spotMarkersRef.current.forEach((m) => m.remove())
    spotMarkersRef.current = []
    popupRef.current?.remove()

    for (const spot of spots) {
      const color = TYPE_COLORS[spot.type]
      const el = makePinEl(color, spot.badge)
      const dist = formatDistance(
        distanceMeters(distanceFrom[0], distanceFrom[1], spot.lat, spot.lng),
      )

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        popupRef.current?.remove()
        const html = `
          <div class="ml-popup">
            <div class="ml-popup-top">
              <span class="ml-badge" style="background:${color}">${spot.badge}</span>
              <span class="ml-dist">${dist}</span>
            </div>
            <h4>${spot.name}</h4>
            <p class="ml-addr">${spot.address}</p>
            <p class="ml-meta">${spot.kind === 'street' ? 'Tänavaäärne' : 'Avalik parkla'} · ${spot.timeLimit}</p>
            <p class="ml-desc">${spot.desc}</p>
            <button type="button" class="ml-nav-btn" data-spot="${spot.id}">Navigeeri</button>
          </div>
        `
        const popup = new Popup({
          offset: 18,
          closeButton: true,
          maxWidth: '280px',
          className: 'park-popup',
        })
          .setLngLat([spot.lng, spot.lat])
          .setHTML(html)
          .addTo(map)

        popupRef.current = popup
        requestAnimationFrame(() => {
          const btn = document.querySelector(`.ml-nav-btn[data-spot="${spot.id}"]`)
          btn?.addEventListener('click', () => {
            popup.remove()
            onNavigate(spot)
          })
        })
      })

      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map)
      spotMarkersRef.current.push(marker)
    }
  }, [spots, distanceFrom, onNavigate, ready])

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
      zoom: Math.max(map.getZoom(), 15.5),
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

    // Raise route above buildings
    if (map.getLayer('nav-route-outline') && map.getLayer('building-3d-waze')) {
      try {
        map.moveLayer('nav-route-outline')
        map.moveLayer('nav-route-line')
      } catch {
        /* ok */
      }
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
