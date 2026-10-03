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
import {
  NearestParkingPanel,
  parkingMapPillLabel,
  parkingMapPillTone,
  type NearestParkingOption,
} from './components/NearestParkingPanel'
import { collectNearestAround } from './lib/nearestParking'
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
import {
  ALT_RADIUS_WIDE,
  findAlternatives,
  type AlternativeParking,
} from './lib/alternatives'
import { distanceMeters, formatDistance } from './lib/geo'
import { loadFullSpotIds, markSpotFull } from './lib/fullSpots'
import {
  isClockLimitedParking,
  isUnclassifiedParking,
  isUnlimitedFreeParking,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
  PARKING_COLOR_UNKNOWN,
} from './lib/parkingClassification'
import { spotDisplayName } from './lib/parkingDisplayName'
import {
  fetchRoute,
  fetchWalkingRoute,
  formatDuration,
  type NavRouteBundle,
  type RouteResult,
} from './lib/routing'
import {
  geocodeToSearchLocation,
  searchAddress,
  viewboxForQuery,
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
import { EV_COLOR_CYAN, type EvChargerFeature } from './lib/evChargers'
import { EvChargerSheet } from './components/EvChargerSheet'
import type { FilterId, ParkingSpot } from './types'

const TIME_EXTEND_OPTIONS = [
  { minutes: 15, label: '+15m' },
  { minutes: 30, label: '+30m' },
  { minutes: 60, label: '+1h' },
  { minutes: 120, label: '+2h' },
] as const

/** Top filter pills — EV chargers unified under Elektriautolaadijad */
const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'free_street', label: 'Tasuta', color: PARKING_COLOR_FREE },
  { id: 'timed', label: 'Kellaga', color: PARKING_COLOR_TIMED },
  { id: 'paid', label: 'Tasuline', color: PARKING_COLOR_PAID },
  { id: 'ev', label: 'Elektriautolaadijad', color: EV_COLOR_CYAN },
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const skipNextGeocode = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [fullSpotIds, setFullSpotIds] = useState<Set<string>>(() => loadFullSpotIds())
  const [alternatives, setAlternatives] = useState<AlternativeParking[]>([])
  const [noAlternatives, setNoAlternatives] = useState(false)
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
  const [selectedEvCharger, setSelectedEvCharger] =
    useState<EvChargerFeature | null>(null)
  const [searchLocation, setSearchLocation] = useState<SearchLocation | null>(null)
  const [searchSheetOpen, setSearchSheetOpen] = useState(false)
  /** Step 1 after address search — pick among nearest parking options */
  const [nearestPickerOpen, setNearestPickerOpen] = useState(false)
  const [nearestOptions, setNearestOptions] = useState<NearestParkingOption[]>(
    [],
  )
  /** Tap/click preview in nearest picker — no hover (mobile has none). */
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(
    null,
  )
  /** Detail was opened from nearest picker — show "Tagasi nimekirja". */
  const [fromNearestPicker, setFromNearestPicker] = useState(false)
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
  const [routeData, setRouteData] = useState<NavRouteBundle | null>(null)
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

  // Nominatim geocoding — Estonia-wide, soft-biased to current map location
  const searchBiasKey = `${userLocation[0].toFixed(2)},${userLocation[1].toFixed(2)}`
  useEffect(() => {
    // After picking a suggestion we set the query to the place name —
    // skip the rebound geocode so the dropdown stays closed.
    if (skipNextGeocode.current) {
      skipNextGeocode.current = false
      setGeoResults([])
      setGeoError(null)
      setGeoLoading(false)
      return
    }
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
    const [biasLat, biasLng] = searchBiasKey.split(',').map(Number) as [
      number,
      number,
    ]
    const t = window.setTimeout(async () => {
      try {
        const results = await searchAddress(
          q,
          ac.signal,
          viewboxForQuery(q, biasLat, biasLng),
        )
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
  }, [query, searchBiasKey])

  // Prune expired "full" marks periodically
  useEffect(() => {
    setFullSpotIds(loadFullSpotIds())
    const id = window.setInterval(() => {
      setFullSpotIds(loadFullSpotIds())
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

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
    if (filter === 'ev') {
      // Elektriautolaadijad — map uses dedicated EV GeoJSON; no parking pins
      return []
    }
    if (filter === 'free_street') {
      // Tasuta: unlimited free only — no clock / free_minutes window
      return allSpots.filter((s) => isUnlimitedFreeParking(s))
    }
    if (filter === 'timed') {
      // Kellaga: all clock-limited free parking
      return allSpots.filter((s) => isClockLimitedParking(s))
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
        if (isUnlimitedFreeParking(s) || isClockLimitedParking(s)) return false
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
        const name = spotDisplayName(s).toLowerCase()
        const zone = s.zone_code.toLowerCase()
        const addr = (s.address || '').toLowerCase()
        const op = (s.operator || '').toLowerCase()
        return (
          name.includes(q) ||
          zone.includes(q) ||
          addr.includes(q) ||
          op.includes(q) ||
          s.name.toLowerCase().includes(q)
        )
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
          name: spotDisplayName(s),
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

    const places: SearchSuggestion[] = geoResults
      .map((r) => {
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
          name: r.name || name,
          subtitle: r.kind && r.kind !== 'place' ? `${subtitle || r.kind}` : subtitle,
          lat: r.lat,
          lng: r.lng,
          distanceM,
          result: r,
        }
      })
      .sort((a, b) => a.distanceM - b.distanceM)

    // Nearby parking first, then nearest places — keep Estonia-wide but ranked
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
      setNearestPickerOpen(false)
      setFromNearestPicker(false)
      setSelectedEvCharger(null)
      setSelected(spot)
    },
    [clearRoute],
  )

  const openEvCharger = useCallback((feature: EvChargerFeature) => {
    clearRoute()
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setFromNearestPicker(false)
    setSelected(null)
    setSelectedEvCharger(feature)
  }, [clearRoute])

  const closeSheet = useCallback(() => setSelected(null), [])

  const dismissMapOverlays = useCallback(() => {
    clearRoute()
    setSelected(null)
    setSelectedEvCharger(null)
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setSelectedPreviewId(null)
    setFromNearestPicker(false)
    setGeoResults([])
    setGeoError(null)
    setIsDropdownOpen(false)
    setNoAlternatives(false)
  }, [clearRoute])

  const clearSearchLocation = useCallback(() => {
    clearRoute()
    setSearchLocation(null)
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setNearestOptions([])
    setSelectedPreviewId(null)
    setFromNearestPicker(false)
    setQuery('')
    setGeoResults([])
    setGeoError(null)
    setIsDropdownOpen(false)
    setAlternatives([])
    setNoAlternatives(false)
  }, [clearRoute])

  const visibleIdSet = useMemo(
    () => new Set(visibleSpots.map((s) => s.id)),
    [visibleSpots],
  )

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

  /** Collect 3–5 nearest roadside/lot spots around the SEARCH destination. */
  const collectNearestOptions = useCallback(
    (lat: number, lng: number): NearestParkingOption[] => {
      return collectNearestAround(allSpots, lat, lng, {
        excludeIds: fullSpotIds,
        limit: 5,
      })
    },
    [allSpots, fullSpotIds],
  )

  /**
   * Step 2 — user confirmed a parking card: open detail panel + route intro
   * (drive to lot, walk to house).
   */
  const confirmParkingSelection = useCallback(
    (houseLoc: SearchLocation, destSpot: ParkingSpot | null) => {
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
      setNearestPickerOpen(false)
      setSelectedPreviewId(null)
      setSearchSheetOpen(false)
      setAlternatives([])
      setNoAlternatives(false)

      const house: [number, number] = [houseLoc.lat, houseLoc.lng]
      const parking: [number, number] = destSpot
        ? [destSpot.lat, destSpot.lng]
        : house
      const sameAsHouse =
        !destSpot ||
        (Math.abs(parking[0] - house[0]) < 1e-6 &&
          Math.abs(parking[1] - house[1]) < 1e-6)
      const label =
        destSpot?.name || houseLoc.name || houseLoc.label || 'Sihtkoht'

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
          parking[0],
          parking[1],
        ) < 40

      if (nearUser) {
        setFlyMode('fly')
        setFlyTarget(house)
        setFlyZoom(17)
        setFlyKey((k) => k + 1)
        searchSheetTimer.current = window.setTimeout(() => {
          openInfoSheet()
          searchSheetTimer.current = null
        }, 900)
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

      const waitForRoute = fetchRoute(userLocation, parking, ac.signal)
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

      const waitForWalkRoute: Promise<RouteResult | null> = sameAsHouse
        ? Promise.resolve(null)
        : fetchWalkingRoute(parking, house, ac.signal)
            .then((result) => {
              if (ac.signal.aborted || routeRunId.current !== runId) return null
              return result
            })
            .catch((e) => {
              if ((e as Error).name === 'AbortError') return null
              return null
            })

      void mapApiRef.current
        ?.playRouteIntro({
          house,
          parking,
          origin: userLocation,
          waitForRoute,
          waitForWalkRoute,
          routeWaitMs: 3000,
          onBeforeFitBounds: (drive, walk) => {
            if (routeRunId.current !== runId) return
            setRouteData({
              drive,
              walk,
              parking,
              house,
              label,
            })
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
    },
    [hasGps, userLocation, setToast],
  )

  /**
   * Step 1 — address/place search: show Nearest Parking Options panel.
   * Parking suggestions from the dropdown skip the picker and confirm directly.
   */
  const flyToDestination = (
    loc: SearchLocation,
    opts?: { preferSpot?: ParkingSpot | null; skipPicker?: boolean },
  ) => {
    if (searchSheetTimer.current) {
      window.clearTimeout(searchSheetTimer.current)
      searchSheetTimer.current = null
    }

    routeAbort.current?.abort()
    mapApiRef.current?.cancelRouteIntro()
    setRouteData(null)
    setRouteError(null)
    setRouteLoading(false)
    setRouteSummaryReady(false)

    ensureCityForCoords(loc.lat, loc.lng)

    skipNextGeocode.current = true
    geoAbort.current?.abort()
    setGeoLoading(false)
    setGeoResults([])
    setGeoError(null)
    setIsDropdownOpen(false)
    searchInputRef.current?.blur()

    setSearchSheetOpen(false)
    setSelected(null)
    setSearchLocation(loc)
    setQuery(loc.name)
    setAlternatives([])
    setNoAlternatives(false)
    setSelectedPreviewId(null)

    // Direct confirm when user picked a parking result from search
    if (opts?.preferSpot || opts?.skipPicker) {
      setFromNearestPicker(false)
      confirmParkingSelection(loc, opts.preferSpot ?? null)
      return
    }

    const options = collectNearestOptions(loc.lat, loc.lng)
    setNearestOptions(options)
    setFromNearestPicker(false)
    setNearestPickerOpen(true)
    setSelectedPreviewId(options[0]?.optionKey ?? null)

    // Frame the searched destination (wider so nearby lots are visible)
    setFlyMode('fly')
    setFlyTarget([loc.lat, loc.lng])
    setFlyZoom(options.length > 0 ? 15.2 : 16.5)
    setFlyKey((k) => k + 1)

    if (options.length === 0) {
      // No parking nearby — fall back to location info sheet
      setNearestPickerOpen(false)
      setSearchSheetOpen(true)
    }
  }

  const selectSearchSuggestion = (item: SearchSuggestion) => {
    if (item.kind === 'parking') {
      flyToDestination(
        {
          id: item.spot.id,
          name: spotDisplayName(item.spot),
          label: item.spot.address || spotDisplayName(item.spot),
          lat: item.spot.lat,
          lng: item.spot.lng,
          kind: 'parking',
        },
        { preferSpot: item.spot, skipPicker: true },
      )
      return
    }
    flyToDestination(geocodeToSearchLocation(item.result))
  }

  /** Instant preview only — no detail panel, no OSRM. Strict single selection. */
  const handleNearestPreview = useCallback((id: string) => {
    setSelectedPreviewId(id)
  }, [])

  /** Explicit "Vali see parkla" — opens detail + starts route. */
  const handleNearestConfirm = useCallback(
    (spot: ParkingSpot) => {
      if (!searchLocation) return
      setFromNearestPicker(true)
      confirmParkingSelection(searchLocation, spot)
    },
    [searchLocation, confirmParkingSelection],
  )

  const handleBackToNearestList = useCallback(() => {
    clearRoute()
    setSelected(null)
    setRouteSummaryReady(false)
    setFromNearestPicker(true)
    setNearestPickerOpen(true)
    if (nearestOptions[0]) {
      setSelectedPreviewId(nearestOptions[0].optionKey)
    }
  }, [clearRoute, nearestOptions])

  // Refresh nearest list when parking data finishes loading after a search.
  // Always anchor distances to searchLocation — never keep stale Tallinn rows
  // after navigating to Tartu / another landmark.
  useEffect(() => {
    if (!nearestPickerOpen || !searchLocation) return
    const next = collectNearestOptions(searchLocation.lat, searchLocation.lng)
    setNearestOptions(next)
    setSelectedPreviewId((prev) => {
      if (prev && next.some((o) => o.optionKey === prev)) return prev
      return next[0]?.optionKey ?? null
    })
  }, [allSpots, nearestPickerOpen, searchLocation, collectNearestOptions])

  // Prefocus the closest option when the picker opens
  useEffect(() => {
    if (!nearestPickerOpen) return
    if (selectedPreviewId) return
    if (nearestOptions[0]) setSelectedPreviewId(nearestOptions[0].optionKey)
  }, [nearestPickerOpen, nearestOptions, selectedPreviewId])

  const nearestPills = useMemo(() => {
    if (!nearestPickerOpen) return []
    return nearestOptions.map(({ spot, optionKey }) => ({
      id: optionKey,
      lat: spot.lat,
      lng: spot.lng,
      label: parkingMapPillLabel(spot),
      tone: parkingMapPillTone(spot),
    }))
  }, [nearestPickerOpen, nearestOptions])

  const previewFocus = useMemo(() => {
    if (!nearestPickerOpen || !searchLocation) return null
    const hit = selectedPreviewId
      ? nearestOptions.find((o) => o.optionKey === selectedPreviewId)
      : null
    return {
      target: { lat: searchLocation.lat, lng: searchLocation.lng },
      parking: hit
        ? { lat: hit.spot.lat, lng: hit.spot.lng }
        : undefined,
      // Fit cluster once — do not re-camera on every preview tap (keeps taps instant)
      fitAll: true,
    }
  }, [nearestPickerOpen, searchLocation, selectedPreviewId, nearestOptions])

  /** Route camera + OSRM intro to a parking spot (alternatives flow). */
  const routeToSpot = useCallback(
    (spot: ParkingSpot, opts?: { toastTitle?: string }) => {
      const runId = routeRunId.current + 1
      routeRunId.current = runId
      routeAbort.current?.abort()
      mapApiRef.current?.cancelRouteIntro()
      setRouteData(null)
      setRouteError(null)
      setRouteLoading(false)
      setRouteSummaryReady(false)
      setSearchSheetOpen(false)
      setSelected(spot)
      setIsDropdownOpen(false)

      const parking: [number, number] = [spot.lat, spot.lng]
      // Keep original house destination when available
      const house: [number, number] = searchLocation
        ? [searchLocation.lat, searchLocation.lng]
        : parking
      const sameAsHouse =
        Math.abs(parking[0] - house[0]) < 1e-6 &&
        Math.abs(parking[1] - house[1]) < 1e-6
      const label = spotDisplayName(spot)

      if (opts?.toastTitle) {
        setToast({ kind: 'info', title: opts.toastTitle })
      }

      const nearUser =
        distanceMeters(
          userLocation[0],
          userLocation[1],
          parking[0],
          parking[1],
        ) < 40

      if (nearUser) {
        setFlyMode('fly')
        setFlyTarget(house)
        setFlyZoom(17)
        setFlyKey((k) => k + 1)
        return
      }

      const ac = new AbortController()
      routeAbort.current = ac
      setRouteLoading(true)
      const timeout = window.setTimeout(() => ac.abort(), 8000)
      const waitForRoute = fetchRoute(userLocation, parking, ac.signal)
        .then((result) => {
          if (ac.signal.aborted || routeRunId.current !== runId) return null
          return result
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return null
          if (routeRunId.current === runId) {
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

      const waitForWalkRoute: Promise<RouteResult | null> = sameAsHouse
        ? Promise.resolve(null)
        : fetchWalkingRoute(parking, house, ac.signal)
            .then((result) => {
              if (ac.signal.aborted || routeRunId.current !== runId) return null
              return result
            })
            .catch((e) => {
              if ((e as Error).name === 'AbortError') return null
              return null
            })

      void mapApiRef.current
        ?.playRouteIntro({
          house,
          parking,
          origin: userLocation,
          waitForRoute,
          waitForWalkRoute,
          routeWaitMs: 3000,
          onBeforeFitBounds: (drive, walk) => {
            if (routeRunId.current !== runId) return
            setRouteData({
              drive,
              walk,
              parking,
              house,
              label,
            })
          },
          onFailed: () => {
            if (routeRunId.current !== runId) return
            setFlyMode('fly')
            setFlyTarget(house)
            setFlyZoom(16.5)
            setFlyKey((k) => k + 1)
          },
        })
        .then((status) => {
          if (routeRunId.current !== runId) return
          if (status === 'fitted') setRouteSummaryReady(true)
        })
    },
    [userLocation, searchLocation, setToast],
  )

  const runFindAlternatives = useCallback(
    (opts?: {
      markFullId?: string
      maxRadius?: number
      autoGo?: boolean
    }) => {
      const origin = searchLocation
        ? { lat: searchLocation.lat, lng: searchLocation.lng }
        : selected
          ? { lat: selected.lat, lng: selected.lng }
          : null
      if (!origin) return

      let nextFull = fullSpotIds
      if (opts?.markFullId) {
        nextFull = markSpotFull(opts.markFullId)
        setFullSpotIds(nextFull)
      }

      const exclude = new Set<string>([...nextFull])
      if (selected) exclude.add(selected.id)
      if (opts?.markFullId) exclude.add(opts.markFullId)

      const { results } = findAlternatives({
        origin,
        candidates: allSpots,
        excludeIds: exclude,
        fullIds: nextFull,
        matchesFilter: (s) => visibleIdSet.has(s.id),
        maxRadius: opts?.maxRadius,
        limit: 6,
      })

      setAlternatives(results)
      setNoAlternatives(results.length === 0)

      if (results.length > 0 && opts?.autoGo !== false) {
        routeToSpot(results[0].spot, {
          toastTitle: 'Leidsime lähima vaba parkla',
        })
      }
    },
    [
      searchLocation,
      selected,
      fullSpotIds,
      allSpots,
      visibleIdSet,
      routeToSpot,
    ],
  )

  const handleFindAnother = useCallback(() => {
    runFindAlternatives({ autoGo: true })
  }, [runFindAlternatives])

  const handleMarkFull = useCallback(() => {
    if (!selected) return
    runFindAlternatives({ markFullId: selected.id, autoGo: true })
  }, [selected, runFindAlternatives])

  const handleWidenRadius = useCallback(() => {
    runFindAlternatives({ maxRadius: ALT_RADIUS_WIDE, autoGo: true })
  }, [runFindAlternatives])

  const handleSelectAlternative = useCallback(
    (spot: ParkingSpot) => {
      routeToSpot(spot, { toastTitle: 'Leidsime lähima vaba parkla' })
    },
    [routeToSpot],
  )

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
            highlightId={nearestPickerOpen ? selectedPreviewId : null}
            nearestPills={nearestPills}
            previewFocus={previewFocus}
            onNearestPillClick={(id) => {
              // Map pill tap = preview only (same as list card tap)
              handleNearestPreview(id)
            }}
            searchPin={
              searchLocation
                ? { lat: searchLocation.lat, lng: searchLocation.lng }
                : null
            }
            onSearchPinClick={openSearchSheet}
            route={routeData?.drive ?? null}
            walkRoute={routeData?.walk ?? null}
            navigating={Boolean(routeData)}
            onNavigate={openSheet}
            onEvChargerSelect={openEvCharger}
            onBackgroundClick={dismissMapOverlays}
            onZoomChange={() => {}}
            onPreciseSpotsLoaded={setPreciseSpots}
            onStreetSpotsLoaded={setStreetSpots}
            onMapReady={() => setMapReady(true)}
            suppressedFeatureIds={suppressedIds}
            fullSpotIds={fullSpotIds}
            infoPanelOpen={Boolean(
              selected ||
                selectedEvCharger ||
                (searchSheetOpen && searchLocation) ||
                nearestPickerOpen,
            )}
            cityId={cityId}
          />
        </MapErrorBoundary>
        {!mapReady ? <MapChromeSkeleton /> : null}
      </div>

      <OfflineBanner />

      {/* Top floating search + filter pills (Apple HIG) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.65rem,env(safe-area-inset-top))] sm:px-4">
        <div className="pointer-events-auto mx-auto w-full max-w-xl space-y-2">
          <div className="relative min-w-0">
            <div className={panel}>
              <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className={`pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] -translate-y-1/2 ${muted}`}
                    strokeWidth={2.2}
                  />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => {
                      skipNextGeocode.current = false
                      const v = e.target.value
                      setQuery(v)
                      setIsDropdownOpen(v.trim().length >= 3)
                    }}
                    onFocus={() => {
                      if (query.trim().length >= 3) setIsDropdownOpen(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setIsDropdownOpen(false)
                        searchInputRef.current?.blur()
                      }
                    }}
                    placeholder="Otsi aadressi või kohta Eestis"
                    className={`w-full rounded-2xl border-0 bg-transparent py-3 pr-10 pl-10 text-[16px] font-sans outline-none ${text} placeholder:text-[#8E8E93]`}
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        skipNextGeocode.current = false
                        setQuery('')
                        setGeoResults([])
                        setGeoError(null)
                        setIsDropdownOpen(false)
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

            {isDropdownOpen && query.trim().length >= 3 ? (
              <div className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50">
                <SearchDropdown
                  loading={geoLoading && searchSuggestions.length === 0}
                  error={geoError}
                  suggestions={searchSuggestions}
                  dark={dark}
                  onSelect={selectSearchSuggestion}
                />
              </div>
            ) : null}
          </div>

          {!isDropdownOpen ? (
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
          ) : null}

          {/* Below filters only when detail panel is closed — never overlays pills */}
          {routeSummaryReady && routeData && !selected ? (
            <div
              data-testid="route-summary"
              className={`pointer-events-auto flex w-full animate-fade-in items-center gap-3 px-3 py-2.5 ${panel}`}
              role="status"
              aria-live="polite"
            >
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] font-semibold ${text}`}>
                  {routeData.label}
                </p>
                <p
                  className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-medium ${muted}`}
                >
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-1.5 w-3 rounded-full bg-[#007AFF]"
                      aria-hidden
                    />
                    Sõida {formatDistance(routeData.drive.distanceMeters)}
                    {' · '}
                    {formatDuration(routeData.drive.durationSeconds)}
                  </span>
                  {routeData.walk ? (
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="inline-block h-1.5 w-3 rounded-full border border-dashed border-[#059669] bg-[#059669]/30"
                        aria-hidden
                      />
                      Jalgsi {formatDistance(routeData.walk.distanceMeters)}
                      {' · '}
                      {formatDuration(routeData.walk.durationSeconds)}
                    </span>
                  ) : null}
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
          ) : null}
        </div>
      </div>

      {/* Floating Action Buttons — location + 3D */}
      <div
        className={`absolute right-3 z-50 flex flex-col gap-2.5 sm:right-4 ${
          selected ||
          selectedEvCharger ||
          (searchSheetOpen && searchLocation) ||
          nearestPickerOpen
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
          className={`absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 z-30 max-h-[min(70vh,28rem)] w-[min(100%-5.5rem,20rem)] overflow-y-auto overscroll-contain px-3.5 py-3 pb-4 sm:left-4 ${panel}`}
        >
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-xs font-bold ${text}`}>
                {activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
              </p>
              <p className={`truncate text-[10px] ${muted}`}>{timerLabel}</p>
            </div>
            <span className={`shrink-0 font-mono text-xl font-extrabold tabular-nums ${text}`}>
              {formatHMS(timerSeconds)}
            </span>
          </div>
          {activeSession ? (
            <div className="mb-2.5 rounded-2xl bg-moss/10 p-3.5 text-[11px] font-semibold leading-snug text-moss">
              <p>
                {activeSession.carNumber} · {activeSession.zone}
                {activeSession.status ? ` · ${activeSession.status}` : ''}
              </p>
              {(formatHourlyRate(activeSession.hourlyRate) ||
                formatSessionInstant(activeSession.startedAt)) && (
                <p className="mt-1 opacity-90">
                  {[
                    formatHourlyRate(activeSession.hourlyRate),
                    formatSessionInstant(activeSession.startedAt)
                      ? `alates ${formatSessionInstant(activeSession.startedAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <span className="mt-1.5 block text-[10px] font-medium opacity-80">
                {timerMode === 'elapsed' ? 'Möödunud aeg' : 'Ettemakstud / jäänud'}
              </span>
            </div>
          ) : null}
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void refreshParkingStatus()
            }}
          >
            <div>
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
                className={`w-full rounded-xl border px-2.5 py-2 font-mono text-xs font-semibold tracking-wider outline-none focus:ring-2 focus:ring-moss/25 ${
                  dark
                    ? 'border-white/10 bg-white/5 text-white'
                    : 'border-ink/10 bg-white/80 text-ink'
                }`}
              />
            </div>
            <div className="grid grid-cols-4 gap-1.5">
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
                  className={`rounded-lg py-2 text-[10px] font-bold ${chip} disabled:opacity-55`}
                  title={`Lisa ${opt.minutes} minutit`}
                >
                  {sessionAction === 'extend' ? '…' : opt.label}
                </button>
              ))}
            </div>
            {activeSession ? (
              <button
                type="button"
                disabled={sessionLoading}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void endParkingSession()
                }}
                className="w-full rounded-xl bg-clay py-2.5 text-xs font-bold text-white disabled:opacity-55"
              >
                {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
              </button>
            ) : (
              <div className="flex min-w-0 flex-col gap-1">
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
                  className="w-full rounded-xl bg-moss py-2.5 text-xs font-bold text-white disabled:opacity-55"
                >
                  {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
                </button>
                {selected && !canStartParkingSession(selected) ? (
                  <p className={`text-[10px] font-semibold leading-snug ${muted}`}>
                    {sessionStartDisabledHint(selected)}
                  </p>
                ) : null}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={sessionLoading}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void refreshParkingStatus()
                }}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
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
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
                title="Kõik aktiivsed sessioonid"
              >
                Kõik
              </button>
            </div>
          </form>
          {sessionNotice ? (
            <p
              data-testid="session-notice"
              className={`mt-2.5 rounded-2xl p-3.5 text-[11px] font-semibold leading-snug ${
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

      {selectedEvCharger && !selected ? (
        <EvChargerSheet
          feature={selectedEvCharger}
          dark={dark}
          onClose={() => setSelectedEvCharger(null)}
        />
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
          routeSummary={
            routeSummaryReady && routeData
              ? {
                  label: routeData.label,
                  driveDistanceM: routeData.drive.distanceMeters,
                  driveDurationS: routeData.drive.durationSeconds,
                  walkDistanceM: routeData.walk?.distanceMeters,
                  walkDurationS: routeData.walk?.durationSeconds,
                }
              : null
          }
          onClearRoute={routeData ? clearRoute : undefined}
          dark={dark}
          onClose={() => {
            setFromNearestPicker(false)
            closeSheet()
          }}
          onBackToList={
            fromNearestPicker && nearestOptions.length > 0
              ? handleBackToNearestList
              : undefined
          }
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
          alternatives={alternatives}
          noAlternatives={noAlternatives}
          isFull={fullSpotIds.has(selected.id)}
          onFindAnother={handleFindAnother}
          onMarkFull={handleMarkFull}
          onWidenRadius={handleWidenRadius}
          onSelectAlternative={handleSelectAlternative}
        />
      ) : null}

      {nearestPickerOpen && searchLocation && !selected && !selectedEvCharger ? (
        <NearestParkingPanel
          targetName={searchLocation.name || searchLocation.label}
          options={nearestOptions}
          dark={dark}
          selectedPreviewId={selectedPreviewId}
          onPreview={handleNearestPreview}
          onConfirm={handleNearestConfirm}
          onClose={() => {
            setNearestPickerOpen(false)
            setSelectedPreviewId(null)
            setSearchSheetOpen(true)
          }}
        />
      ) : null}

      {searchSheetOpen &&
      searchLocation &&
      !selected &&
      !selectedEvCharger &&
      !nearestPickerOpen ? (
        <LocationInfoSheet
          location={searchLocation}
          dark={dark}
          onClose={() => setSearchSheetOpen(false)}
          onClear={clearSearchLocation}
          alternatives={alternatives}
          noAlternatives={noAlternatives}
          onFindNearest={handleFindAnother}
          onWidenRadius={handleWidenRadius}
          onSelectAlternative={handleSelectAlternative}
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
