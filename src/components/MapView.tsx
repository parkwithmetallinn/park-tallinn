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
import type { DrivingRoute } from '../lib/routing'
import {
  applyWazeTheme,
  FALLBACK_STYLE,
  NAV_PITCH,
  ROUTE_COLOR,
  ROUTE_OUTLINE,
} from '../map/wazeTheme'
import { ZOOM } from '../map/zoom'
import type { DistrictZone, PaidZone, ParkingSpot } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorker)

const ROUTE_SOURCE = 'nav-route'
const PAID_SOURCE = 'paid-zones'
const DISTRICT_SOURCE = 'district-zones'
const SPOTS_SOURCE = 'parking-spots'

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
  if (!map.getSource(PAID_SOURCE)) {
    map.addSource(PAID_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'paid-zones-fill',
      type: 'fill',
      source: PAID_SOURCE,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.22,
      },
    })
    map.addLayer({
      id: 'paid-zones-line',
      type: 'line',
      source: PAID_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2.5,
        'line-opacity': 0.95,
      },
    })
    map.addLayer({
      id: 'paid-zones-label',
      type: 'symbol',
      source: PAID_SOURCE,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-font': ['Noto Sans Bold'],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.04,
        'text-max-width': 10,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F1F5F9',
        'text-halo-width': 2,
      },
    })
  }

  if (!map.getSource(DISTRICT_SOURCE)) {
    map.addSource(DISTRICT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    // District fills — city overview only
    map.addLayer({
      id: 'district-fill',
      type: 'fill',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.streetMin,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.28,
          ZOOM.districtMax,
          0.18,
          ZOOM.streetMin,
          0.06,
        ],
      },
    })
    map.addLayer({
      id: 'district-outline',
      type: 'line',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.streetMin + 0.4,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          2,
          13,
          3,
          15,
          1.5,
        ],
        'line-opacity': 0.9,
      },
    })
    map.addLayer({
      id: 'district-label',
      type: 'symbol',
      source: DISTRICT_SOURCE,
      maxzoom: ZOOM.streetMin,
      layout: {
        'text-field': [
          'format',
          ['get', 'name'],
          { 'font-scale': 1.05 },
          '\n',
          {},
          ['get', 'countLabel'],
          { 'font-scale': 0.9 },
        ],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          11,
          13,
          14,
        ],
        'text-font': ['Noto Sans Bold'],
        'text-max-width': 12,
        'text-line-height': 1.15,
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#F1F5F9',
        'text-halo-width': 2.2,
      },
    })
  }

  if (!map.getSource(SPOTS_SOURCE)) {
    map.addSource(SPOTS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: ZOOM.clusterMax - 0.01,
      clusterRadius: 56,
      clusterProperties: {
        free: ['+', ['case', ['==', ['get', 'type'], 'free'], 1, 0]],
        timed: ['+', ['case', ['==', ['get', 'type'], 'timed'], 1, 0]],
        pr: ['+', ['case', ['==', ['get', 'type'], 'pr'], 1, 0]],
      },
    })

    // Cluster bubbles — mid zoom
    map.addLayer({
      id: 'spot-clusters',
      type: 'circle',
      source: SPOTS_SOURCE,
      filter: ['has', 'point_count'],
      maxzoom: ZOOM.streetMin,
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#0B6E4F',
          25,
          '#0E7490',
          80,
          '#1D4E89',
          200,
          '#6B21A8',
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          16,
          25,
          20,
          80,
          26,
          200,
          32,
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.92,
      },
    })
    map.addLayer({
      id: 'spot-cluster-count',
      type: 'symbol',
      source: SPOTS_SOURCE,
      filter: ['has', 'point_count'],
      maxzoom: ZOOM.streetMin,
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
      },
      paint: {
        'text-color': '#ffffff',
      },
    })

    // Landmark lots slightly earlier than dense street pins
    map.addLayer({
      id: 'spot-landmarks',
      type: 'circle',
      source: SPOTS_SOURCE,
      filter: [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['get', 'landmark'], 1],
      ],
      minzoom: ZOOM.landmarkMin,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          7,
          16,
          10,
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    map.addLayer({
      id: 'spot-landmark-labels',
      type: 'symbol',
      source: SPOTS_SOURCE,
      filter: [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['get', 'landmark'], 1],
      ],
      minzoom: ZOOM.landmarkMin,
      layout: {
        'text-field': ['get', 'badge'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10,
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#F1F5F9',
        'text-halo-width': 1.5,
      },
    })

    // Dense street / timed pins — only at street level
    map.addLayer({
      id: 'spot-points',
      type: 'circle',
      source: SPOTS_SOURCE,
      filter: [
        'all',
        ['!', ['has', 'point_count']],
        ['!=', ['get', 'landmark'], 1],
      ],
      minzoom: ZOOM.streetMin,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          5,
          17,
          8,
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.95,
      },
    })
    map.addLayer({
      id: 'spot-point-labels',
      type: 'symbol',
      source: SPOTS_SOURCE,
      filter: [
        'all',
        ['!', ['has', 'point_count']],
        ['!=', ['get', 'landmark'], 1],
      ],
      minzoom: ZOOM.streetMin + 0.4,
      layout: {
        'text-field': ['get', 'badge'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 9,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#334155',
        'text-halo-color': '#F1F5F9',
        'text-halo-width': 1.2,
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

function buildDistrictGeoJSON(spots: ParkingSpot[], districts: DistrictZone[]) {
  return {
    type: 'FeatureCollection' as const,
    features: districts.map((d) => {
      const c = countSpotsInDistrict(spots, d)
      const countLabel =
        c.total > 0
          ? `${c.total} kohta${c.free ? ` · ${c.free} tasuta` : ''}`
          : d.summary
      return {
        type: 'Feature' as const,
        properties: {
          id: d.id,
          name: d.name,
          color: d.color,
          kind: d.kind,
          summary: d.summary,
          count: c.total,
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
  userLocation,
  flyTarget,
  flyKey,
  route,
  navigating,
  onNavigate,
  distanceFrom,
  onZoomChange,
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
  onZoomChange?: (zoom: number, mode: 'district' | 'cluster' | 'street') => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapType | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const calloutMarkersRef = useRef<Marker[]>([])
  const popupRef = useRef<Popup | null>(null)
  const spotsByIdRef = useRef<Map<string, ParkingSpot>>(new Map())
  const distanceFromRef = useRef(distanceFrom)
  const onNavigateRef = useRef(onNavigate)
  const [ready, setReady] = useState(false)

  distanceFromRef.current = distanceFrom
  onNavigateRef.current = onNavigate

  useEffect(() => {
    spotsByIdRef.current = new Map(spots.map((s) => [s.id, s]))
  }, [spots])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: FALLBACK_STYLE,
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
      emitZoom(map)
    }

    const emitZoom = (m: MapLibreMapType) => {
      const z = m.getZoom()
      const mode =
        z >= ZOOM.streetMin ? 'street' : z >= ZOOM.districtMax ? 'cluster' : 'district'
      onZoomChange?.(z, mode)
    }

    map.once('style.load', finishSetup)
    map.once('load', () => {
      if (map.isStyleLoaded()) finishSetup()
    })
    const readyTimer = window.setTimeout(() => {
      if (map.isStyleLoaded()) finishSetup()
    }, 2500)

    map.on('zoomend', () => emitZoom(map))
    map.on('moveend', () => emitZoom(map))

    // Cluster click → zoom in
    map.on('click', 'spot-clusters', (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature || feature.geometry.type !== 'Point') return
      const clusterId = feature.properties?.cluster_id as number | undefined
      const source = map.getSource(SPOTS_SOURCE) as GeoJSONSource
      if (clusterId == null) return
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const coords = feature.geometry.coordinates as [number, number]
        map.easeTo({
          center: coords,
          zoom: Math.min(zoom + 0.4, 16.5),
          duration: 600,
        })
      })
    })

    // District click → fly into street level of that area
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
      const color =
        spot.type === 'free'
          ? '#0B6E4F'
          : spot.type === 'timed'
            ? '#0E7490'
            : spot.type === 'pr'
              ? '#1D4E89'
              : '#C45C26'
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
          <p class="ml-meta">${spot.kind === 'street' ? 'Tänavaäärne' : 'Avalik parkla'} · ${spot.timeLimit}</p>
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
      const spot = spotsByIdRef.current.get(id)
      if (!spot) return
      const [lng, lat] = f.geometry.coordinates as [number, number]
      openSpotPopup(spot, [lng, lat])
    }

    map.on('click', 'spot-points', onPointClick)
    map.on('click', 'spot-landmarks', onPointClick)

    for (const layer of [
      'spot-clusters',
      'district-fill',
      'spot-points',
      'spot-landmarks',
    ]) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    // Paid zone tooltip
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

    return () => {
      window.clearTimeout(readyTimer)
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

  // District polygons with live counts
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(DISTRICT_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData(buildDistrictGeoJSON(spots, DISTRICT_ZONES))
  }, [spots, ready])

  // Clustered spots GeoJSON
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(SPOTS_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData(spotsToGeoJSON(spots))
  }, [spots, ready])

  // User location
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
