import {
  Box,
  CircleHelp,
  Clock3,
  LocateFixed,
  Map as MapIcon,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActiveSessionsModal } from './components/ActiveSessionsModal'
import { MapErrorBoundary } from './components/MapErrorBoundary'
import { MapView, type MapViewHandle } from './components/MapView'
import { ModalShell } from './components/ModalShell'
import { LocationInfoSheet } from './components/LocationInfoSheet'
import { ParkingBottomSheet } from './components/ParkingBottomSheet'
import { OfflineBanner } from './components/OfflineBanner'
import { ReportModal, type ReportModalContext } from './components/ReportModal'
import {
  SearchDropdown,
  splitPlaceLabel,
  type SearchSuggestion,
} from './components/SearchDropdown'
import { Toast } from './components/Toast'
import { MapChromeSkeleton } from './components/ui/Skeleton'
import {
  loadApprovedOverlays,
  loadSuppressedFeatureIds,
} from './lib/parkingRequests'
import { parkingQueryKeys, queryClient } from './lib/queryClient'
import { prefetchParkingLayers } from './lib/parkingDataCache'
import {
  CITIES,
  cityFromCoords,
  getInitialCity,
  persistCity,
  type CityId,
} from './data/cities'
import { MOCK_KESKLINN_SPOTS } from './data/mockKesklinn'
import { PARKING_SPOTS } from './data/parking'
import { PARNU_ZONE_LIST } from './data/parnuZones'
import {
  canStartParkingSession,
  sessionStartDisabledHint,
  ZONE_RATE_LIST,
} from './data/zones'
import { distanceMeters, formatDistance } from './lib/geo'
import { isUnclassifiedParking, PARKING_COLOR_UNKNOWN } from './lib/parkingClassification'
import {
  fetchRoute,
  formatDuration,
  type RouteResult,
} from './lib/routing'
import {
  ESTONIA_VIEWBOX,
  geocodeToSearchLocation,
  searchAddress,
  type GeocodeResult,
  type SearchLocation,
} from './lib/geocode'
import { normalizeSpot } from './lib/geojson'
import { formatHMS } from './lib/parking'
import {
  listActiveParkingSessions,
  outcomeToResponse,
} from './lib/parkingSession'
import { useParkingSession } from './hooks/useParkingSession'

import { parkingIndex } from './lib/spatialIndex'
import { loadCustomSpots } from './lib/storage'
import {
  applyDocumentTheme,
  getInitialTheme,
  persistTheme,
  toggleTheme,
  type ThemeMode,
} from './lib/theme'
import { PARKING_LAYER_META } from './map/parkingLayers'
import type { FilterId, ParkingSpot } from './types'

const TIME_EXTEND_OPTIONS = [
  { minutes: 15, label: '+15m' },
  { minutes: 30, label: '+30m' },
  { minutes: 60, label: '+1h' },
  { minutes: 120, label: '+2h' },
] as const

/** Compact 5-pill parking filters — paid operators merged under Tasuline */
const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'free_street', label: 'Tasuta', color: '#22C55E' },
  { id: 'timed', label: 'Kellaga', color: PARKING_LAYER_META.timed.color },
  { id: 'paid', label: 'Tasuline', color: '#FF3B30' },
  { id: 'other', label: 'Muud / Era', color: PARKING_COLOR_UNKNOWN },
]

/** Marker click does not auto-start a route (search selection does). */
const AUTO_ROUTE_ON_MARKER_CLICK = false

const glass =
  'rounded-2xl border border-white/55 bg-white/72 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur-md'
const glassDark =
  'rounded-2xl border border-white/10 bg-[#1C1C1E]/78 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-md'

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme())
  const dark = theme === 'dark'
  const [cityId, setCityId] = useState<CityId>(() => getInitialCity())
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<[number, number]>(() => {
    const id = getInitialCity()
    return CITIES[id].center
  })
  const [hasGps, setHasGps] = useState(false)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)
  const [flyZoom, setFlyZoom] = useState<number | undefined>(undefined)
  const [flyKey, setFlyKey] = useState(0)
  const [flyMode, setFlyMode] = useState<'fly' | 'ease'>('ease')
  const searchSheetTimer = useRef<number | null>(null)
  const [customSpots, setCustomSpots] = useState<ParkingSpot[]>([])
  const [selected, setSelected] = useState<ParkingSpot | null>(null)
  const [searchLocation, setSearchLocation] = useState<SearchLocation | null>(null)
  const [searchSheetOpen, setSearchSheetOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [reportContext, setReportContext] = useState<ReportModalContext | null>(null)
  const [approvedOverlays, setApprovedOverlays] = useState<ParkingSpot[]>([])
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(() => new Set())
  const [pitch3d, setPitch3d] = useState(true)
  const [preciseSpots, setPreciseSpots] = useState<ParkingSpot[]>([])
  const [streetSpots, setStreetSpots] = useState<ParkingSpot[]>([])
  const [mapReady, setMapReady] = useState(false)
  const geoAbort = useRef<AbortController | null>(null)
  const mapApiRef = useRef<MapViewHandle | null>(null)
  const routeAbort = useRef<AbortController | null>(null)
  const routeRunId = useRef(0)
  const gpsRouteToastShown = useRef(false)
  const [routeData, setRouteData] = useState<
    (RouteResult & { destination: [number, number]; label: string }) | null
  >(null)
  const [routeSummaryReady, setRouteSummaryReady] = useState(false)
  const [, setRouteLoading] = useState(false)
  const [, setRouteError] = useState<string | null>(null)

  const {
    carNumber,
    handleCarNumberChange,
    timerSeconds,
    timerMode,
    timerLabel,
    timerOpen,
    setTimerOpen,
    sessionLoading,
    sessionAction,
    activeSession,
    sessionNotice,
    sessionsOverviewOpen,
    setSessionsOverviewOpen,
    activeSessionsList,
    activeSessionsCount,
    activeSessionsMessage,
    toast,
    setToast,
    dismissToast,
    connectionNotice,
    beginParkingSession,
    endParkingSession,
    refreshParkingStatus,
    loadActiveSessionsOverview,
    addPrepaidMinutes,
    adoptListedSession,
    formatHourlyRate,
    formatSessionInstant,
  } = useParkingSession(selected)

  useEffect(() => {
    prefetchParkingLayers()
    setCustomSpots(loadCustomSpots())
    setApprovedOverlays(loadApprovedOverlays())
    setSuppressedIds(loadSuppressedFeatureIds())
    return () => {
      if (searchSheetTimer.current) window.clearTimeout(searchSheetTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation([pos.coords.latitude, pos.coords.longitude])
        setHasGps(true)
      },
      () => setHasGps(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // Nominatim geocoding — Estonia-wide (no city toggle)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setGeoResults([])
      setGeoError(null)
      setGeoLoading(false)
      return
    }
    setGeoLoading(true)
    setGeoError(null)
    geoAbort.current?.abort()
    const ac = new AbortController()
    geoAbort.current = ac
    const t = window.setTimeout(async () => {
      try {
        const results = await searchAddress(q, ac.signal, ESTONIA_VIEWBOX)
        if (!ac.signal.aborted) setGeoResults(results)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setGeoError('Aadressi otsing ebaõnnestus')
        setGeoResults([])
      } finally {
        if (!ac.signal.aborted) setGeoLoading(false)
      }
    }, 400)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [query])

  const clearRoute = useCallback(() => {
    routeRunId.current += 1
    routeAbort.current?.abort()
    routeAbort.current = null
    mapApiRef.current?.cancelRouteIntro()
    setRouteData(null)
    setRouteError(null)
    setRouteLoading(false)
    setRouteSummaryReady(false)
  }, [])

  /** Soft-switch parking layer when a destination falls in another city. */
  const ensureCityForCoords = useCallback(
    (lat: number, lng: number) => {
      const next = cityFromCoords(lat, lng)
      if (next === cityId) return
      setCityId(next)
      persistCity(next)
      setPreciseSpots([])
      setStreetSpots([])
    },
    [cityId],
  )

  const allSpots = useMemo(() => {
    const filteredPrecise = preciseSpots.filter((s) => !suppressedIds.has(s.id))
    const filteredStreet = streetSpots.filter((s) => !suppressedIds.has(s.id))

    if (cityId === 'parnu') {
      // Pärnu EV charger polygons/pins are not shown on the map
      const noEv = (s: ParkingSpot) => s.layer !== 'ev' && s.badge !== 'EV'
      const custom = customSpots
        .map((s) => normalizeSpot(s))
        .filter((s) => !suppressedIds.has(s.id) && s.cityId !== 'tallinn' && noEv(s))
      const overlays = approvedOverlays
        .map((s) => normalizeSpot(s))
        .filter((s) => !suppressedIds.has(s.id) && noEv(s))
      return [
        ...filteredPrecise.filter(noEv),
        ...filteredStreet.filter(noEv),
        ...custom,
        ...overlays,
      ]
    }

    const curated = PARKING_SPOTS.map((s) =>
      normalizeSpot({
        ...s,
        landmark: s.kind === 'lot' || s.type === 'pr' || s.id.startsWith('timed-'),
        layer:
          s.type === 'pr'
            ? 'park_ride'
            : s.type === 'timed'
              ? 'timed'
              : s.type === 'free' || s.zone_code === 'FREE'
                ? 'free_street'
                : 'municipal',
      }),
    )
    const mocks = MOCK_KESKLINN_SPOTS.map((s) => normalizeSpot(s))
    const custom = customSpots.map((s) => normalizeSpot(s))
    const overlays = approvedOverlays.map((s) => normalizeSpot(s))
    // Precise GeoJSON lots / street lines take precedence over stub mocks
    const mockWithoutDupes = mocks.filter((m) => {
      if (suppressedIds.has(m.id)) return false
      if (m.polygon) {
        return !preciseSpots.some(
          (p) =>
            p.layer === m.layer &&
            Math.abs(p.lat - m.lat) < 0.001 &&
            Math.abs(p.lng - m.lng) < 0.001,
        )
      }
      if (m.featureType === 'on-street-line' || m.kind === 'street') {
        return !streetSpots.some(
          (s) =>
            Math.abs(s.lat - m.lat) < 0.0015 && Math.abs(s.lng - m.lng) < 0.0015,
        )
      }
      return true
    })
    return [
      ...filteredPrecise,
      ...filteredStreet,
      ...mockWithoutDupes,
      ...curated.filter((s) => !suppressedIds.has(s.id)),
      ...custom,
      ...overlays,
    ]
  }, [
    cityId,
    customSpots,
    preciseSpots,
    streetSpots,
    approvedOverlays,
    suppressedIds,
  ])

  const visibleSpots = useMemo(() => {
    if (filter === 'free_street') {
      return allSpots.filter((s) => s.layer === 'free_street')
    }
    if (filter === 'timed') {
      return allSpots.filter((s) => s.layer === 'timed')
    }
    if (filter === 'paid') {
      // All paid operators + municipal paid zones under one "Tasuline" pill
      const paidLayers = new Set([
        'europark',
        'snabb',
        'citypark',
        'uhisteenused',
        'parkit',
        'park_ride',
        'loading',
        'municipal',
      ])
      return allSpots.filter((s) => {
        if (
          isUnclassifiedParking({
            layer: s.layer,
            price_per_hour: s.price_per_hour,
            zone_code: s.zone_code,
            operator: s.operator,
            verified_free: s.layer === 'free_street',
          })
        ) {
          return false
        }
        if (s.layer === 'free_street' || s.layer === 'timed' || s.layer === 'ev') {
          return false
        }
        if (paidLayers.has(s.layer)) {
          // Municipal only when priced (or has a paid zone code)
          if (s.layer === 'municipal') return s.price_per_hour > 0
          return true
        }
        return s.price_per_hour > 0
      })
    }
    if (filter === 'other') {
      return allSpots.filter((s) =>
        isUnclassifiedParking({
          layer: s.layer,
          price_per_hour: s.price_per_hour,
          zone_code: s.zone_code,
          operator: s.operator,
          verified_free: s.layer === 'free_street',
        }),
      )
    }
    return allSpots
  }, [allSpots, filter])

  /** Live search suggestions: parking name hits + geocode places. */
  const searchSuggestions = useMemo((): SearchSuggestion[] => {
    const q = query.trim().toLowerCase()
    if (q.length < 3) return []

    const parkingHits: SearchSuggestion[] = allSpots
      .filter((s) => {
        const name = s.name.toLowerCase()
        const zone = s.zone_code.toLowerCase()
        const addr = (s.address || '').toLowerCase()
        return name.includes(q) || zone.includes(q) || addr.includes(q)
      })
      .map((s) => {
        const distanceM = distanceMeters(
          userLocation[0],
          userLocation[1],
          s.lat,
          s.lng,
        )
        return {
          kind: 'parking' as const,
          id: s.id,
          name: s.name,
          subtitle: [s.zone_code, s.operator, s.address]
            .filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 2)
            .join(' · '),
          lat: s.lat,
          lng: s.lng,
          distanceM,
          spot: s,
        }
      })
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 4)

    const places: SearchSuggestion[] = geoResults.map((r) => {
      const { name, subtitle } = splitPlaceLabel(r.label)
      const distanceM = distanceMeters(
        userLocation[0],
        userLocation[1],
        r.lat,
        r.lng,
      )
      return {
        kind: 'place' as const,
        id: r.id,
        name,
        subtitle,
        lat: r.lat,
        lng: r.lng,
        distanceM,
        result: r,
      }
    })

    // Prefer nearby parking matches first, then address places
    return [...parkingHits, ...places].slice(0, 10)
  }, [query, allSpots, geoResults, userLocation])

  // Deep-link: /?spot=<id> opens the parking sheet (no map click needed)
  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current || allSpots.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const spotId = params.get('spot')?.trim()
    if (!spotId) return
    const match = allSpots.find((s) => s.id === spotId)
    if (!match) return
    deepLinkApplied.current = true
    setSelected(match)
    setFlyMode('fly')
    setFlyTarget([match.lat, match.lng])
    setFlyZoom(16.5)
    setFlyKey((k) => k + 1)
    // Drop ?spot= so a hard refresh lands on a clean map (not stuck on deep-link zoom)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('spot')
      url.searchParams.delete('panel')
      url.searchParams.delete('timer')
      window.history.replaceState({}, '', url.pathname + url.search)
    } catch {
      /* ignore */
    }
    if (params.get('panel') === '1' || params.get('timer') === '1') {
      setTimerOpen(true)
    }
  }, [allSpots, setTimerOpen])

  useEffect(() => {
    parkingIndex.bulkLoad(allSpots)
  }, [allSpots])

  const openSheet = useCallback(
    (spot: ParkingSpot) => {
      // Marker click: clear any prior search-route unless auto-route-on-click is enabled
      if (!AUTO_ROUTE_ON_MARKER_CLICK) {
        clearRoute()
      }
      setSearchSheetOpen(false)
      setSelected(spot)
    },
    [clearRoute],
  )

  const closeSheet = useCallback(() => setSelected(null), [])

  const dismissMapOverlays = useCallback(() => {
    clearRoute()
    setSelected(null)
    setSearchSheetOpen(false)
    setGeoResults([])
    setGeoError(null)
  }, [clearRoute])

  const clearSearchLocation = useCallback(() => {
    clearRoute()
    setSearchLocation(null)
    setSearchSheetOpen(false)
    setQuery('')
    setGeoResults([])
    setGeoError(null)
  }, [clearRoute])

  const openSearchSheet = useCallback(() => {
    if (!searchLocation) return
    setSelected(null)
    setSearchSheetOpen(true)
  }, [searchLocation])

  const recenter = () => {
    setFlyMode('ease')
    setFlyTarget([...userLocation] as [number, number])
    setFlyZoom(16)
    setFlyKey((k) => k + 1)
  }

  const flyToDestination = (
    loc: SearchLocation,
    opts?: { preferSpot?: ParkingSpot | null },
  ) => {
    if (searchSheetTimer.current) {
      window.clearTimeout(searchSheetTimer.current)
      searchSheetTimer.current = null
    }

    const runId = routeRunId.current + 1
    routeRunId.current = runId
    routeAbort.current?.abort()
    mapApiRef.current?.cancelRouteIntro()
    setRouteData(null)
    setRouteError(null)
    setRouteLoading(false)
    setRouteSummaryReady(false)

    ensureCityForCoords(loc.lat, loc.lng)

    setSearchSheetOpen(false)
    setSelected(null)
    setSearchLocation(loc)
    setQuery(loc.name)
    setGeoResults([])
    setGeoError(null)

    // Destination Interceptor — nearest roadside / lot parking within 400 m
    const nearby = parkingIndex.queryNearbyParking(loc.lat, loc.lng, 400)
    const destSpot = opts?.preferSpot ?? nearby?.spot ?? null
    const destination: [number, number] = destSpot
      ? [destSpot.lat, destSpot.lng]
      : [loc.lat, loc.lng]
    const label =
      destSpot?.name || loc.name || loc.label || 'Sihtkoht'

    const openInfoSheet = () => {
      if (routeRunId.current !== runId) return
      if (destSpot) {
        setSearchSheetOpen(false)
        setSelected(destSpot)
      } else {
        setSelected(null)
        setSearchSheetOpen(true)
      }
    }

    const nearUser =
      distanceMeters(
        userLocation[0],
        userLocation[1],
        destination[0],
        destination[1],
      ) < 40

    if (nearUser) {
      // Too close for a driving route — only zoom into the destination
      setFlyMode('fly')
      setFlyTarget(destination)
      setFlyZoom(17)
      setFlyKey((k) => k + 1)
      searchSheetTimer.current = window.setTimeout(() => {
        openInfoSheet()
        searchSheetTimer.current = null
      }, 1600)
      return
    }

    if (!hasGps && !gpsRouteToastShown.current) {
      gpsRouteToastShown.current = true
      setToast({
        kind: 'info',
        title: 'GPS puudub',
        detail:
          'GPS puudub, marsruut algab kaardi keskelt. Luba asukoht täpsema marsruudi jaoks.',
      })
    }

    const ac = new AbortController()
    routeAbort.current = ac
    setRouteLoading(true)
    setRouteError(null)
    const timeout = window.setTimeout(() => ac.abort(), 8000)

    const waitForRoute = fetchRoute(userLocation, destination, ac.signal)
      .then((result) => {
        if (ac.signal.aborted || routeRunId.current !== runId) return null
        return result
      })
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return null
        if (routeRunId.current === runId) {
          const msg =
            e instanceof Error ? e.message : 'Marsruuti ei õnnestunud leida'
          setRouteError(msg)
          setToast({
            kind: 'info',
            title: 'Marsruuti ei õnnestunud leida',
          })
        }
        return null
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (routeAbort.current === ac) {
          setRouteLoading(false)
          routeAbort.current = null
        }
      })

    void mapApiRef.current
      ?.playRouteIntro({
        destination,
        waitForRoute,
        routeWaitMs: 3000,
        onBeforeFitBounds: (result) => {
          if (routeRunId.current !== runId) return
          setRouteData({ ...result, destination, label })
          openInfoSheet()
        },
        onFailed: () => {
          if (routeRunId.current !== runId) return
          setToast({
            kind: 'info',
            title: 'Marsruuti ei õnnestunud leida',
          })
          openInfoSheet()
        },
      })
      .then((status) => {
        if (routeRunId.current !== runId) return
        if (status === 'fitted') setRouteSummaryReady(true)
      })
  }

  const selectSearchSuggestion = (item: SearchSuggestion) => {
    if (item.kind === 'parking') {
      flyToDestination(
        {
          id: item.spot.id,
          name: item.spot.name,
          label: item.spot.address || item.spot.name,
          lat: item.spot.lat,
          lng: item.spot.lng,
          kind: 'parking',
        },
        { preferSpot: item.spot },
      )
      return
    }
    flyToDestination(geocodeToSearchLocation(item.result))
  }

  const openProposeNew = () => {
    setReportContext({
      mode: 'PROPOSE_NEW',
      lat: userLocation[0],
      lng: userLocation[1],
      target: selected,
    })
  }

  const openReportInvalid = (spot: ParkingSpot) => {
    setReportContext({
      mode: 'REPORT_INVALID',
      lat: spot.lat,
      lng: spot.lng,
      target: spot,
    })
  }

  useEffect(() => {
    applyDocumentTheme(theme)
  }, [theme])

  const panel = dark ? glassDark : glass
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const text = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const chip = dark
    ? 'bg-white/10 text-[#EBEBF5] hover:bg-white/16'
    : 'bg-white/70 text-[#3A3A3C] hover:bg-white'
  const chipActive = dark ? 'bg-white text-[#1C1C1E]' : 'bg-[#1C1C1E] text-white'

  const selectedDist = selected
    ? formatDistance(
        distanceMeters(userLocation[0], userLocation[1], selected.lat, selected.lng),
      )
    : null

  const fabClass = `tap-scale flex h-[52px] w-[52px] items-center justify-center rounded-full ${panel} ${text} shadow-[0_4px_16px_rgba(15,23,42,0.14)]`

  return (
    <div className={`relative h-full overflow-hidden ${dark ? 'bg-[#0f1714]' : 'bg-transparent'}`}>
      {/* Full-bleed map */}
      <div className="absolute inset-0">
        <MapErrorBoundary>
          <MapView
            ref={mapApiRef}
            spots={visibleSpots}
            filter={filter}
            theme={theme}
            userLocation={userLocation}
            flyTarget={flyTarget}
            flyKey={flyKey}
            flyZoom={flyZoom}
            flyMode={flyMode}
            pitch3d={pitch3d}
            selectedId={selected?.id ?? null}
            searchPin={
              searchLocation
                ? { lat: searchLocation.lat, lng: searchLocation.lng }
                : null
            }
            onSearchPinClick={openSearchSheet}
            route={routeData}
            navigating={Boolean(routeData)}
            onNavigate={openSheet}
            onBackgroundClick={dismissMapOverlays}
            onZoomChange={() => {}}
            onPreciseSpotsLoaded={setPreciseSpots}
            onStreetSpotsLoaded={setStreetSpots}
            onMapReady={() => setMapReady(true)}
            suppressedFeatureIds={suppressedIds}
            infoPanelOpen={Boolean(
              selected || (searchSheetOpen && searchLocation),
            )}
            cityId={cityId}
          />
        </MapErrorBoundary>
        {!mapReady ? <MapChromeSkeleton /> : null}
      </div>

      <OfflineBanner />

      {/* Top floating search + filter pills (Apple HIG) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.65rem,env(safe-area-inset-top))] sm:px-4">
        <div className="pointer-events-auto mx-auto max-w-lg space-y-2">
          <div className={`relative ${panel}`}>
            <div className="flex items-center gap-1 px-2 py-1.5">
              <div className="relative min-w-0 flex-1">
                <Search
                  className={`pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] -translate-y-1/2 ${muted}`}
                  strokeWidth={2.2}
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Otsi aadressi või kohta Eestis"
                  className={`w-full rounded-2xl border-0 bg-transparent py-3 pr-10 pl-10 text-[16px] font-sans outline-none ${text} placeholder:text-[#8E8E93]`}
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setGeoResults([])
                      setGeoError(null)
                    }}
                    className={`absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 ${muted} bg-black/5`}
                    aria-label="Tühjenda"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className={`cursor-pointer rounded-full p-2.5 ${chip}`}
                title="Reeglid"
              >
                <CircleHelp className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme((t) => {
                    const next = toggleTheme(t)
                    persistTheme(next)
                    return next
                  })
                }}
                className={`cursor-pointer rounded-full p-2.5 ${chip}`}
                title={dark ? 'Hele režiim' : 'Tume režiim'}
                aria-label={dark ? 'Lülita hele režiim' : 'Lülita tume režiim'}
              >
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>

          </div>

          {query.trim().length >= 3 ? (
            <div className="relative z-40">
              <SearchDropdown
                loading={geoLoading && searchSuggestions.length === 0}
                error={geoError}
                suggestions={searchSuggestions}
                dark={dark}
                onSelect={selectSearchSuggestion}
              />
            </div>
          ) : null}

          <div className="no-scrollbar flex gap-2 overflow-x-auto px-0.5 py-0.5">
            {FILTERS.map((f) => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  data-filter={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`tap-scale shrink-0 cursor-pointer rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-sm sm:px-4 ${
                    active ? chipActive : `${panel} ${chip}`
                  }`}
                >
                  {f.color && !active ? (
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ backgroundColor: f.color }}
                    />
                  ) : null}
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {routeSummaryReady && routeData ? (
        <div
          data-testid="route-summary"
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-3"
          style={{ top: 'calc(env(safe-area-inset-top) + 6.25rem)' }}
        >
          <div
            className={`pointer-events-auto flex w-full max-w-xs animate-fade-in items-center gap-3 px-3 py-2.5 ${panel}`}
            role="status"
            aria-live="polite"
          >
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[13px] font-semibold ${text}`}>
                {routeData.label}
              </p>
              <p className={`mt-0.5 text-[12px] font-medium ${muted}`}>
                {formatDistance(routeData.distanceMeters)}
                {' · '}
                {formatDuration(routeData.durationSeconds)}
              </p>
            </div>
            <button
              type="button"
              onClick={clearRoute}
              className={`tap-scale flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${chip} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]`}
              aria-label="Peida marsruut"
              title="Peida marsruut"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Floating Action Buttons — location + 3D */}
      <div
        className={`absolute right-3 z-50 flex flex-col gap-2.5 sm:right-4 ${
          selected || (searchSheetOpen && searchLocation)
            ? 'bottom-[max(42vh,calc(env(safe-area-inset-bottom)+11rem))] sm:bottom-[max(6.5rem,env(safe-area-inset-bottom))]'
            : 'bottom-[max(6.5rem,env(safe-area-inset-bottom))]'
        }`}
      >
        <button
          type="button"
          onClick={recenter}
          className={fabClass}
          title="Minu asukoht"
          aria-label="Minu asukoht"
        >
          <LocateFixed className={`h-[22px] w-[22px] ${hasGps ? 'text-[#007AFF]' : muted}`} />
        </button>
        <button
          type="button"
          onClick={() => setPitch3d((v) => !v)}
          className={fabClass}
          title={pitch3d ? '2D vaade' : '3D vaade'}
          aria-label={pitch3d ? '2D vaade' : '3D vaade'}
        >
          {pitch3d ? (
            <MapIcon className="h-[22px] w-[22px] text-[#007AFF]" />
          ) : (
            <Box className="h-[22px] w-[22px] text-[#007AFF]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setTimerOpen((o) => !o)}
          className={`relative ${fabClass}`}
          title={activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
        >
          <Clock3 className={`h-[22px] w-[22px] ${activeSession ? 'text-[#34C759]' : muted}`} />
          {activeSession ? (
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#34C759] ring-2 ring-white" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={openProposeNew}
          className="tap-scale flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#34C759] text-white shadow-[0_4px_16px_rgba(52,199,89,0.35)]"
          title="Paku uut kohta (ülevaatusse)"
        >
          <Plus className="h-6 w-6" strokeWidth={2.4} />
        </button>
      </div>

      {/* Compact timer / parking session control panel */}
      {timerOpen ? (
        <div
          className={`absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 z-30 w-[min(100%-5.5rem,20rem)] px-3.5 py-3 sm:left-4 ${panel}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-xs font-bold ${text}`}>
                {activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
              </p>
              <p className={`truncate text-[10px] ${muted}`}>{timerLabel}</p>
            </div>
            <span className={`font-mono text-xl font-extrabold tabular-nums ${text}`}>
              {formatHMS(timerSeconds)}
            </span>
          </div>
          {activeSession ? (
            <div className="mb-2 rounded-xl bg-moss/10 px-2.5 py-2 text-[11px] font-semibold text-moss">
              {activeSession.carNumber} · {activeSession.zone}
              {activeSession.status ? ` · ${activeSession.status}` : ''}
              {formatHourlyRate(activeSession.hourlyRate)
                ? ` · ${formatHourlyRate(activeSession.hourlyRate)}`
                : ''}
              {formatSessionInstant(activeSession.startedAt)
                ? ` · alates ${formatSessionInstant(activeSession.startedAt)}`
                : ''}
              <span className="mt-1 block text-[10px] font-medium opacity-80">
                {timerMode === 'elapsed' ? 'Möödunud aeg' : 'Ettemakstud / jäänud'}
              </span>
            </div>
          ) : null}
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void refreshParkingStatus()
            }}
          >
            <label className={`mb-1 block text-[10px] font-semibold ${muted}`}>
              Auto number
            </label>
            <input
              value={carNumber}
              onChange={(e) => handleCarNumberChange(e.target.value.toUpperCase())}
              placeholder="nt 123ABC"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              disabled={sessionLoading}
              enterKeyHint="done"
              className={`mb-2 w-full rounded-xl border px-2.5 py-2 font-mono text-xs font-semibold tracking-wider outline-none focus:ring-2 focus:ring-moss/25 ${
                dark
                  ? 'border-white/10 bg-white/5 text-white'
                  : 'border-ink/10 bg-white/80 text-ink'
              }`}
            />
            <div className="mb-2 flex gap-1">
              {TIME_EXTEND_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  disabled={sessionLoading}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void addPrepaidMinutes(opt.minutes)
                  }}
                  className={`flex-1 rounded-lg py-1.5 text-[10px] font-bold ${chip} disabled:opacity-55`}
                  title={`Lisa ${opt.minutes} minutit`}
                >
                  {sessionAction === 'extend' ? '…' : opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {activeSession ? (
                <button
                  type="button"
                  disabled={sessionLoading}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void endParkingSession()
                  }}
                  className="flex-1 rounded-xl bg-clay py-2 text-xs font-bold text-white disabled:opacity-55"
                >
                  {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <button
                    type="button"
                    disabled={
                      sessionLoading ||
                      !selected ||
                      carNumber.trim().length < 2 ||
                      (selected != null && !canStartParkingSession(selected))
                    }
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void beginParkingSession()
                    }}
                    className="w-full rounded-xl bg-moss py-2 text-xs font-bold text-white disabled:opacity-55"
                  >
                    {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
                  </button>
                  {selected && !canStartParkingSession(selected) ? (
                    <p className={`truncate text-[10px] font-semibold ${muted}`}>
                      {sessionStartDisabledHint(selected)}
                    </p>
                  ) : null}
                </div>
              )}
              <button
                type="button"
                disabled={sessionLoading}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void refreshParkingStatus()
                }}
                className={`rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
                title="Ainult staatuse päring (ei peata ega alusta)"
              >
                {sessionAction === 'status' ? '…' : 'Staatus'}
              </button>
              <button
                type="button"
                disabled={sessionLoading}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void loadActiveSessionsOverview()
                }}
                className={`rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
                title="Kõik aktiivsed sessioonid"
              >
                Kõik
              </button>
            </div>
          </form>
          {sessionNotice ? (
            <p
              data-testid="session-notice"
              className={`mt-2 rounded-xl px-2.5 py-2 text-[11px] font-semibold leading-snug ${
                sessionNotice.kind === 'success'
                  ? 'bg-moss/12 text-moss'
                  : sessionNotice.kind === 'error'
                    ? 'bg-clay/15 text-clay'
                    : sessionNotice.kind === 'loading'
                      ? dark
                        ? 'bg-white/10 text-white/80'
                        : 'bg-ink/5 text-ink-soft'
                      : 'bg-sea/12 text-sea'
              }`}
            >
              {sessionNotice.text}
            </p>
          ) : null}
          {connectionNotice ? (
            <p
              data-testid="connection-notice"
              className={`mt-1.5 text-[10px] font-semibold ${muted}`}
            >
              {connectionNotice}
            </p>
          ) : null}
        </div>
      ) : null}

      {selected ? (
        <ParkingBottomSheet
          spot={selected}
          distanceLabel={selectedDist}
          carNumber={carNumber}
          onCarNumberChange={handleCarNumberChange}
          sessionLoading={sessionLoading}
          sessionAction={sessionAction}
          activeSession={activeSession}
          sessionNotice={sessionNotice}
          dark={dark}
          onClose={closeSheet}
          onStartSession={() => {
            void beginParkingSession()
          }}
          onStopSession={() => {
            void endParkingSession()
          }}
          onCheckStatus={() => {
            // Async status fetch only — no navigation / reload
            void refreshParkingStatus()
          }}
          onExtendMinutes={(mins) => {
            void addPrepaidMinutes(mins)
          }}
          onReportInvalid={() => openReportInvalid(selected)}
        />
      ) : null}

      {searchSheetOpen && searchLocation && !selected ? (
        <LocationInfoSheet
          location={searchLocation}
          dark={dark}
          onClose={() => setSearchSheetOpen(false)}
          onClear={clearSearchLocation}
        />
      ) : null}

      <Toast toast={toast} onClose={dismissToast} />

      {sessionsOverviewOpen ? (
        <ActiveSessionsModal
          sessions={activeSessionsList}
          count={activeSessionsCount}
          message={activeSessionsMessage}
          loading={sessionLoading && sessionAction === 'status'}
          onClose={() => setSessionsOverviewOpen(false)}
          onRefresh={() => void loadActiveSessionsOverview()}
          onPrefetch={() => {
            void queryClient.prefetchQuery({
              queryKey: parkingQueryKeys.sessions,
              queryFn: async () => outcomeToResponse(await listActiveParkingSessions()),
              staleTime: 15_000,
            })
          }}
          onSelect={adoptListedSession}
        />
      ) : null}

      {infoOpen ? (
        <ModalShell
          onClose={() => setInfoOpen(false)}
          title={
            cityId === 'parnu' ? 'Pärnu parkimisreeglid' : 'Tallinna parkimisreeglid'
          }
        >
          <div className="max-h-[60vh] space-y-3 overflow-y-auto text-xs leading-relaxed text-ink-soft">
            {cityId === 'parnu' ? (
              <>
                {PARNU_ZONE_LIST.map((z) => (
                  <div key={z.id} className="rounded-2xl bg-paper-2 p-3">
                    <h4 className="mb-1 text-sm font-bold text-ink">{z.name}</h4>
                    <p>
                      • {z.pricePerHour.toFixed(0)} €/h · {z.pricePer24h.toFixed(0)} €/24h
                    </p>
                    <p>• Ketas {z.freeMinutesWithDisc} min tasuta</p>
                    <p className="mt-1 text-[11px] opacity-80">{z.source}</p>
                  </div>
                ))}
                <div className="rounded-2xl border border-moss/20 bg-moss/8 p-3">
                  <h4 className="mb-1 text-sm font-bold text-moss">Vabastused</h4>
                  <p>• Täis-elektriline M1 sõiduauto</p>
                  <p>• Mootorrattad</p>
                  <p>• Invakaardi omanikud</p>
                </div>
                <p className="text-[11px] opacity-70">
                  Kontrolli kohapealt silti. Andmed: OSM + parnu.ee/parkimine.
                </p>
              </>
            ) : (
              <>
            <div className="rounded-2xl border border-sea/20 bg-sea/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-sea">Esimesed 15 minutit tasuta</h4>
              <p>
                Avalikel tasulistel linnatänavatel kehtib esimesed 15 minutit tasuta. Pane kell
                esiklaasile.
              </p>
            </div>
            <div className="rounded-2xl bg-paper-2 p-3">
              <h4 className="mb-1 text-sm font-bold text-ink">Tsoonide hinnad</h4>
              <p className="mb-2 text-[11px] opacity-80">
                Kontrolli kehtivaid hindu tallinn.ee lehel.
              </p>
              {ZONE_RATE_LIST.map((z) => (
                <p key={z.code}>
                  • {z.name} ({z.code}) — {z.pricePerHour.toFixed(2)} €/h
                  {z.freeMinutes > 0 ? ` · ${z.freeMinutes} min tasuta` : ''}
                </p>
              ))}
            </div>
            <div className="rounded-2xl bg-paper-2 p-3">
              <h4 className="mb-1 text-sm font-bold text-ink">Kesklinna tasuta kellaajad</h4>
              <p>• Tööpäeviti tasuline 07:00–19:00</p>
              <p>• Laupäeval tasuline 08:00–15:00</p>
              <p>• Pühapäeval ja riigipühadel tasuta</p>
            </div>
              </>
            )}
            <div className="rounded-2xl border border-moss/20 bg-moss/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-moss">Kaart</h4>
              <p>
                Roheline = kontrollitud tasuta · hall = määramata avalik · värvilised =
                operaatorid. “+” saadab ettepaneku ülevaatusse (GeoJSON ei muutu otse).
              </p>
            </div>
            <a
              href="/admin"
              onMouseEnter={() => prefetchParkingLayers()}
              onTouchStart={() => prefetchParkingLayers()}
              className="tap-scale block rounded-2xl border border-ink/10 bg-paper-2 px-3 py-2.5 text-center text-xs font-bold text-ink-soft hover:bg-ink/5"
            >
              Admin / Review (peidetud)
            </a>
          </div>
        </ModalShell>
      ) : null}

      {reportContext ? (
        <ReportModal
          context={reportContext}
          onClose={() => setReportContext(null)}
          onSubmitted={(message) => {
            setToast({ kind: 'info', title: 'Saadetud ülevaatusse', detail: message })
            // Refresh moderation layer if admin approved in another tab later
            setApprovedOverlays(loadApprovedOverlays())
            setSuppressedIds(loadSuppressedFeatureIds())
          }}
        />
      ) : null}

      {!hasGps ? null : null}
    </div>
  )
}
