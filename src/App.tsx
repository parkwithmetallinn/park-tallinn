import {
  Box,
  Car,
  CircleHelp,
  Clock3,
  Footprints,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { ParkingDetailPanel } from './components/ParkingDetailPanel'
import type { CrowdStatusType } from './components/CrowdReportModal'
import { ParkingSessionModal } from './components/ParkingSessionModal'
import { OfflineBanner } from './components/OfflineBanner'
import { ReportModal, type ReportModalContext } from './components/ReportModal'
import {
  SearchDropdown,
  splitPlaceLabel,
  suggestionOptionId,
  type SearchSuggestion,
} from './components/SearchDropdown'
import { MyPinSheet } from './components/MyPinSheet'
import { Toast } from './components/Toast'
import { MapChromeSkeleton } from './components/ui/Skeleton'
import {
  loadApprovedOverlays,
  loadSuppressedFeatureIds,
} from './lib/parkingRequests'
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
import { ZONE_RATE_LIST } from './data/zones'
import {
  ALT_RADIUS_WIDE,
  findAlternatives,
  type AlternativeParking,
} from './lib/alternatives'
import { distanceMeters, formatDistance } from './lib/geo'
import {
  COMMUNITY_REPORTS_POLL_MS,
  communityReportIds,
  fetchCommunityReports,
  postCommunityFullReport,
} from './lib/communityReports'
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
  fetchRoutePlan,
  formatDuration,
  type NavRouteBundle,
} from './lib/routing'
import {
  geocodeToSearchLocation,
  type SearchLocation,
} from './lib/geocode'
import {
  addMyPin,
  loadHintSeen,
  loadMyPins,
  markHintSeen,
  markStorageUnavailableToastShown,
  MY_PINS_MAX,
  removeMyPin,
  updateMyPin,
  wasStorageUnavailableToastShown,
  type MyPin,
  type MyPinColor,
} from './lib/myPins'
import { normalizeSpot } from './lib/geojson'
import { useParkingSession } from './hooks/useParkingSession'
import { useSearchGeocode } from './hooks/useSearchGeocode'
import { clampSearchQuery } from './lib/validation'
import { track } from './lib/analytics'

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

/** Top filter pills — EV chargers unified under Elektriautolaadijad */
const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'free_street', label: 'Tasuta', color: PARKING_COLOR_FREE },
  { id: 'timed', label: 'Kellaga', color: PARKING_COLOR_TIMED },
  { id: 'paid', label: 'Tasuline', color: PARKING_COLOR_PAID },
  { id: 'ev', label: 'Elektriautolaadijad', color: EV_COLOR_CYAN },
  { id: 'other', label: 'Muud / Era', color: PARKING_COLOR_UNKNOWN },
  { id: 'alerts', label: '⚠️ Hoiatusega', color: '#FF3B30' },
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const skipNextGeocode = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const selectSearchSuggestionRef = useRef<(item: SearchSuggestion) => void>(
    () => {},
  )
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
  const [myPins, setMyPins] = useState<MyPin[]>(() => loadMyPins())
  const [draftPin, setDraftPin] = useState<{
    lat: number
    lng: number
    color: MyPinColor
  } | null>(null)
  const [editingPinId, setEditingPinId] = useState<string | null>(null)
  const [pinDragEnabled, setPinDragEnabled] = useState(false)
  const [myPinsExpanded, setMyPinsExpanded] = useState(false)
  const [draftColorPreview, setDraftColorPreview] = useState<MyPinColor>('red')
  const mapApiRef = useRef<MapViewHandle | null>(null)
  const routeAbort = useRef<AbortController | null>(null)
  const routeRunId = useRef(0)
  const gpsRouteToastShown = useRef(false)
  const [routePlan, setRoutePlan] = useState<NavRouteBundle | null>(null)
  const [routeSummaryReady, setRouteSummaryReady] = useState(false)
  const [, setRouteLoading] = useState(false)
  const [, setRouteError] = useState<string | null>(null)

  const {
    geoResults,
    resultsQuery,
    geoLoading,
    geoError,
    pendingEnterSelect,
    cancelPendingEnter,
    armPendingEnter,
    clearGeo,
  } = useSearchGeocode({
    query,
    biasLat: userLocation[0],
    biasLng: userLocation[1],
    skipNextGeocodeRef: skipNextGeocode,
  })

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
    toast,
    setToast,
    dismissToast,
    connectionNotice,
    beginParkingSession,
    endParkingSession,
    refreshParkingStatus,
    addPrepaidMinutes,
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

  // Nominatim geocoding owned by useSearchGeocode (debounce + pending Enter)

  // Local TTL prune + live community reports (GET /api/reports every 30s)
  useEffect(() => {
    let cancelled = false
    const mergeFullIds = (remoteIds: Set<string>) => {
      const local = loadFullSpotIds()
      const next = new Set<string>([...local, ...remoteIds])
      setFullSpotIds(next)
    }

    const refresh = async (signal?: AbortSignal) => {
      const reports = await fetchCommunityReports(signal)
      if (cancelled) return
      mergeFullIds(communityReportIds(reports))
    }

    setFullSpotIds(loadFullSpotIds())
    const ac = new AbortController()
    void refresh(ac.signal)

    const pollId = window.setInterval(() => {
      void refresh()
    }, COMMUNITY_REPORTS_POLL_MS)
    const pruneId = window.setInterval(() => {
      void refresh()
    }, 60_000)

    return () => {
      cancelled = true
      ac.abort()
      window.clearInterval(pollId)
      window.clearInterval(pruneId)
    }
  }, [])

  const clearRoute = useCallback(() => {
    routeRunId.current += 1
    routeAbort.current?.abort()
    routeAbort.current = null
    mapApiRef.current?.cancelRouteIntro()
    setRoutePlan(null)
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
      // Absolute ban: no on-street curb overlays — lots only
      const isStreetOverlay = (s: ParkingSpot) =>
        s.featureType === 'on-street-line' ||
        s.kind === 'street' ||
        Boolean(s.line)
      // Pärnu EV charger polygons/pins are not shown on the map
      const noEv = (s: ParkingSpot) => s.layer !== 'ev' && s.badge !== 'EV'
      const custom = customSpots
        .map((s) => normalizeSpot(s))
        .filter(
          (s) =>
            !suppressedIds.has(s.id) &&
            s.cityId !== 'tallinn' &&
            noEv(s) &&
            !isStreetOverlay(s),
        )
      const overlays = approvedOverlays
        .map((s) => normalizeSpot(s))
        .filter((s) => !suppressedIds.has(s.id) && noEv(s) && !isStreetOverlay(s))
      return [
        ...filteredPrecise.filter((s) => noEv(s) && !isStreetOverlay(s)),
        ...filteredStreet.filter((s) => noEv(s) && !isStreetOverlay(s)),
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
    // Absolute ban: never include on-street curb / road-network features.
    // Map shows verified off-street lots (polygons + markers) only.
    const isStreetOverlay = (s: ParkingSpot) =>
      s.featureType === 'on-street-line' ||
      s.kind === 'street' ||
      Boolean(s.line)
    const mockWithoutDupes = mocks.filter((m) => {
      if (suppressedIds.has(m.id)) return false
      if (isStreetOverlay(m)) return false
      if (m.polygon) {
        return !preciseSpots.some(
          (p) =>
            p.layer === m.layer &&
            Math.abs(p.lat - m.lat) < 0.001 &&
            Math.abs(p.lng - m.lng) < 0.001,
        )
      }
      return true
    })
    return [
      ...filteredPrecise.filter((s) => !isStreetOverlay(s)),
      ...filteredStreet.filter((s) => !isStreetOverlay(s)),
      ...mockWithoutDupes,
      ...curated.filter((s) => !suppressedIds.has(s.id) && !isStreetOverlay(s)),
      ...custom.filter((s) => !isStreetOverlay(s)),
      ...overlays.filter((s) => !isStreetOverlay(s)),
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
    if (filter === 'alerts') {
      // Hoiatusega — only spots with active community isFull reports
      return allSpots.filter((s) => fullSpotIds.has(s.id))
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
            free_minutes: s.free_minutes,
            zone_code: s.zone_code,
            operator: s.operator,
            verified_free: s.layer === 'free_street',
            type: s.type,
            timeLimit: s.timeLimit,
            name: s.name,
            desc: s.desc,
            badge: s.badge,
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
          free_minutes: s.free_minutes,
          zone_code: s.zone_code,
          operator: s.operator,
          verified_free: s.layer === 'free_street',
          type: s.type,
          timeLimit: s.timeLimit,
          name: s.name,
          desc: s.desc,
          badge: s.badge,
        }),
      )
    }
    return allSpots
  }, [allSpots, filter, fullSpotIds])

  /** Live search suggestions: my pins + parking + geocode (only fresh results). */
  const searchSuggestions = useMemo((): SearchSuggestion[] => {
    const qRaw = clampSearchQuery(query)
    const q = qRaw.toLowerCase()
    if (q.length < 3) return []

    const myPinHits: SearchSuggestion[] = myPins
      .filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({
        kind: 'mypin' as const,
        id: p.id,
        name: p.name,
        subtitle: p.address || '',
        lat: p.lat,
        lng: p.lng,
        distanceM: distanceMeters(
          userLocation[0],
          userLocation[1],
          p.lat,
          p.lng,
        ),
        pin: p,
      }))
      .slice(0, 5)

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

    // Only attach Nominatim rows when they belong to the current query
    const places: SearchSuggestion[] =
      resultsQuery === qRaw
        ? geoResults
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
                subtitle:
                  r.kind && r.kind !== 'place'
                    ? `${subtitle || r.kind}`
                    : subtitle,
                lat: r.lat,
                lng: r.lng,
                distanceM,
                result: r,
              }
            })
            .sort((a, b) => a.distanceM - b.distanceM)
        : []

    return [...myPinHits, ...parkingHits, ...places].slice(0, 12)
  }, [query, allSpots, geoResults, resultsQuery, userLocation, myPins])

  // Keep keyboard highlight on the top row when the list changes
  useEffect(() => {
    setActiveIndex(0)
  }, [searchSuggestions])

  /**
   * Pending Enter: when results for the armed query arrive, pick the top
   * suggestion automatically (same path as a click).
   */
  useEffect(() => {
    if (!pendingEnterSelect) return
    const q = clampSearchQuery(query)
    if (pendingEnterSelect !== q) return

    // Local hits (pins/parking) can resolve immediately without Nominatim
    if (searchSuggestions.length > 0) {
      const item = searchSuggestions[0]
      cancelPendingEnter()
      selectSearchSuggestionRef.current(item)
      return
    }

    // Still loading fresh geocode for this query
    if (geoLoading || resultsQuery !== q) return

    // Fresh empty / error result — clear pending, show empty/error UI
    cancelPendingEnter()
  }, [
    pendingEnterSelect,
    query,
    searchSuggestions,
    geoLoading,
    resultsQuery,
    cancelPendingEnter,
  ])

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
    if (params.get('panel') === '1') {
      // Detail card owns the session form — do not also open the clock modal
      setTimerOpen(false)
    } else if (params.get('timer') === '1') {
      setSelected(null)
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
      // Exclusive with clock session modal — session lives inside this detail card
      setTimerOpen(false)
      setSearchSheetOpen(false)
      setNearestPickerOpen(false)
      setFromNearestPicker(false)
      setSelectedEvCharger(null)
      setSelected(spot)
    },
    [clearRoute, setTimerOpen],
  )

  const openEvCharger = useCallback((feature: EvChargerFeature) => {
    clearRoute()
    setTimerOpen(false)
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setFromNearestPicker(false)
    setSelected(null)
    setSelectedEvCharger(feature)
  }, [clearRoute, setTimerOpen])

  const openSessionModal = useCallback(() => {
    // Exclusive with left detail panel — never stack both in the sidebar
    setSelected(null)
    setSelectedEvCharger(null)
    setNearestPickerOpen(false)
    setSearchSheetOpen(false)
    setTimerOpen(true)
  }, [setTimerOpen])

  const closeSessionModal = useCallback(() => {
    setTimerOpen(false)
  }, [setTimerOpen])

  const closeSheet = useCallback(() => setSelected(null), [])

  const dismissMapOverlays = useCallback(() => {
    clearRoute()
    setSelected(null)
    setSelectedEvCharger(null)
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setSelectedPreviewId(null)
    setFromNearestPicker(false)
    clearGeo()
    setIsDropdownOpen(false)
    setNoAlternatives(false)
    setDraftPin(null)
    setEditingPinId(null)
    setPinDragEnabled(false)
  }, [clearRoute, clearGeo])

  /** Cross-tab sync for personal pins (localStorage only). */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'parking.myPins.v1') {
        setMyPins(loadMyPins())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** First-time long-press hint after map is ready. */
  useEffect(() => {
    if (!mapReady) return
    if (loadHintSeen()) return
    if (myPins.length > 0) {
      markHintSeen()
      return
    }
    const t = window.setTimeout(() => {
      setToast({
        kind: 'info',
        title: 'Vajuta kaardil pikalt, et lisada oma pin',
      })
      markHintSeen()
    }, 1200)
    return () => window.clearTimeout(t)
  }, [mapReady, myPins.length, setToast])

  const notifyStorageIssue = useCallback(() => {
    if (wasStorageUnavailableToastShown()) return
    markStorageUnavailableToastShown()
    setToast({
      kind: 'info',
      title: 'Pinne ei saa sellel seadmel salvestada',
    })
  }, [setToast])

  const closePinSheet = useCallback(() => {
    setDraftPin(null)
    setEditingPinId(null)
    setPinDragEnabled(false)
  }, [])

  const handleLongPress = useCallback(
    (coords: { lat: number; lng: number }) => {
      setSelected(null)
      setSelectedEvCharger(null)
      setSearchSheetOpen(false)
      setNearestPickerOpen(false)
      setIsDropdownOpen(false)
      clearGeo()
      setEditingPinId(null)
      setDraftColorPreview('red')
      setDraftPin({ lat: coords.lat, lng: coords.lng, color: 'red' })
    },
    [clearGeo],
  )

  const handleMyPinClick = useCallback((pin: MyPin) => {
    setSelected(null)
    setSelectedEvCharger(null)
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setIsDropdownOpen(false)
    setDraftPin(null)
    setEditingPinId(pin.id)
  }, [])

  const handleCreatePin = useCallback(
    (payload: {
      name: string
      note: string
      color: MyPinColor
      lat: number
      lng: number
      address?: string
    }) => {
      const result = addMyPin({
        name: payload.name,
        note: payload.note,
        color: payload.color,
        lat: payload.lat,
        lng: payload.lng,
        address: payload.address,
      })
      if (!result.ok && result.reason === 'quota') {
        setToast({
          kind: 'info',
          title: `Pinne on liiga palju (max ${MY_PINS_MAX})`,
        })
        return
      }
      setMyPins(result.pins)
      if (result.ok) {
        if (result.storageFailed) notifyStorageIssue()
        setToast({ kind: 'info', title: 'Pin salvestatud' })
        markHintSeen()
      }
      setDraftPin(null)
      setEditingPinId(null)
    },
    [notifyStorageIssue, setToast],
  )

  const handleUpdatePin = useCallback(
    (
      id: string,
      payload: {
        name: string
        note: string
        color: MyPinColor
        lat: number
        lng: number
        address?: string
      },
    ) => {
      const result = updateMyPin(id, {
        name: payload.name,
        note: payload.note,
        color: payload.color,
        lat: payload.lat,
        lng: payload.lng,
        address: payload.address,
      })
      setMyPins(result.pins)
      if (result.ok) {
        setToast({ kind: 'info', title: 'Pin salvestatud' })
      }
      setEditingPinId(null)
      setPinDragEnabled(false)
    },
    [setToast],
  )

  const handleDeletePin = useCallback(
    (id: string) => {
      const { pins } = removeMyPin(id)
      setMyPins(pins)
      setEditingPinId(null)
      setPinDragEnabled(false)
      setToast({ kind: 'info', title: 'Pin kustutatud' })
    },
    [setToast],
  )

  const handleMyPinDragEnd = useCallback(
    (pinId: string, coords: { lat: number; lng: number }) => {
      const result = updateMyPin(pinId, {
        lat: coords.lat,
        lng: coords.lng,
        address: '', // clear stale reverse-geocode; sheet will refetch
      })
      setMyPins(result.pins)
    },
    [],
  )

  const clearSearchLocation = useCallback(() => {
    clearRoute()
    setSearchLocation(null)
    setSearchSheetOpen(false)
    setNearestPickerOpen(false)
    setNearestOptions([])
    setSelectedPreviewId(null)
    setFromNearestPicker(false)
    setQuery('')
    clearGeo()
    setIsDropdownOpen(false)
    setAlternatives([])
    setNoAlternatives(false)
  }, [clearRoute, clearGeo])

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
      setRoutePlan(null)
      setRouteError(null)
      setRouteLoading(false)
      setRouteSummaryReady(false)
      setNearestPickerOpen(false)
      setSelectedPreviewId(null)
      setSearchSheetOpen(false)
      setAlternatives([])
      setNoAlternatives(false)
      setTimerOpen(false)

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
          setTimerOpen(false)
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

      let resolvedPlan: Awaited<ReturnType<typeof fetchRoutePlan>> | null = null
      const planPromise = fetchRoutePlan({
        from: userLocation,
        parking,
        destination: sameAsHouse ? null : house,
        signal: ac.signal,
      })
        .then((plan) => {
          if (ac.signal.aborted || routeRunId.current !== runId) return null
          resolvedPlan = plan
          return plan
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

      const waitForRoute = planPromise.then((p) => p?.drive ?? null)
      const waitForWalkRoute = planPromise.then((p) => {
        if (p?.walkFailed && routeRunId.current === runId) {
          setToast({
            kind: 'info',
            title: 'Jalgsi marsruuti ei leitud',
            detail: 'Näitan ligikaudset teekonda',
          })
        }
        return p?.walk ?? null
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
            if (!drive && walk) {
              setToast({
                kind: 'info',
                title: 'Autosõitu ei leitud',
                detail: 'Näitan ainult jalgsi lõiku',
              })
            }
            setRoutePlan({
              drive,
              walk,
              parking,
              destination: sameAsHouse ? null : house,
              house,
              label,
              longWalk: resolvedPlan?.longWalk ?? false,
              walkFailed: resolvedPlan?.walkFailed ?? Boolean(walk?.isFallback),
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
    setRoutePlan(null)
    setRouteError(null)
    setRouteLoading(false)
    setRouteSummaryReady(false)

    ensureCityForCoords(loc.lat, loc.lng)

    skipNextGeocode.current = true
    clearGeo()
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
    cancelPendingEnter()
    if (item.kind === 'mypin') {
      skipNextGeocode.current = true
      clearGeo()
      setIsDropdownOpen(false)
      searchInputRef.current?.blur()
      setQuery(item.pin.name)
      setFlyMode('fly')
      setFlyTarget([item.pin.lat, item.pin.lng])
      setFlyZoom(16.5)
      setFlyKey((k) => k + 1)
      handleMyPinClick(item.pin)
      return
    }
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
  selectSearchSuggestionRef.current = selectSearchSuggestion

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const composing =
      e.nativeEvent.isComposing ||
      (e as unknown as { keyCode?: number }).keyCode === 229
    const q = clampSearchQuery(query)
    const suggestions = q.length >= 3 ? searchSuggestions : []
    const listOpen = isDropdownOpen && (q.length >= 3 || myPins.length > 0)

    if (e.key === 'Escape') {
      e.preventDefault()
      cancelPendingEnter()
      setIsDropdownOpen(false)
      searchInputRef.current?.blur()
      return
    }

    if (e.key === 'Tab') {
      cancelPendingEnter()
      setIsDropdownOpen(false)
      return
    }

    if (e.key === 'ArrowDown' && listOpen && suggestions.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
      return
    }

    if (e.key === 'ArrowUp' && listOpen && suggestions.length > 0) {
      e.preventDefault()
      setActiveIndex(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      )
      return
    }

    if (e.key !== 'Enter') return
    if (composing) return
    if (q.length < 3) return
    e.preventDefault()

    // After a selection the dropdown stays closed — second Enter is a no-op
    if (!isDropdownOpen && !pendingEnterSelect) return

    setIsDropdownOpen(true)

    // Combined list only includes fresh Nominatim rows (resultsQuery match),
    // so any non-empty list is safe to pick from immediately.
    if (suggestions.length > 0) {
      const idx = Math.min(
        Math.max(activeIndex, 0),
        suggestions.length - 1,
      )
      selectSearchSuggestion(suggestions[idx])
      return
    }

    // Still loading / stale / empty pending → skip debounce and wait
    armPendingEnter(q)
  }

  const navigateToMyPin = (pin: MyPin) => {
    closePinSheet()
    flyToDestination({
      id: `mypin-${pin.id}`,
      name: pin.name,
      label: pin.address || pin.name,
      lat: pin.lat,
      lng: pin.lng,
      kind: 'mypin',
    })
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
      setRoutePlan(null)
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

      let resolvedPlan: Awaited<ReturnType<typeof fetchRoutePlan>> | null = null
      const planPromise = fetchRoutePlan({
        from: userLocation,
        parking,
        destination: sameAsHouse ? null : house,
        signal: ac.signal,
      })
        .then((plan) => {
          if (ac.signal.aborted || routeRunId.current !== runId) return null
          resolvedPlan = plan
          return plan
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

      const waitForRoute = planPromise.then((p) => p?.drive ?? null)
      const waitForWalkRoute = planPromise.then((p) => {
        if (p?.walkFailed && routeRunId.current === runId) {
          setToast({
            kind: 'info',
            title: 'Jalgsi marsruuti ei leitud',
            detail: 'Näitan ligikaudset teekonda',
          })
        }
        return p?.walk ?? null
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
            setRoutePlan({
              drive,
              walk,
              parking,
              destination: sameAsHouse ? null : house,
              house,
              label,
              longWalk: resolvedPlan?.longWalk ?? false,
              walkFailed: resolvedPlan?.walkFailed ?? Boolean(walk?.isFallback),
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
        const marked =
          allSpots.find((s) => s.id === opts.markFullId) ?? selected
        void postCommunityFullReport({
          spotId: opts.markFullId,
          lat: marked?.lat,
          lng: marked?.lng,
          isFull: true,
        }).then((reports) => {
          const remote = communityReportIds(reports)
          setFullSpotIds(
            new Set([...loadFullSpotIds(), ...remote]),
          )
        })
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

  const handleCrowdReportSuccess = useCallback(
    (payload: {
      statusType: CrowdStatusType
      comment: string
      message: string
    }) => {
      setToast({
        kind: 'success',
        title: payload.message,
      })
      if (
        selected &&
        (payload.statusType === 'full' || payload.statusType === 'closed')
      ) {
        // API already stored the report — only sync local TTL + suggest alternatives
        setFullSpotIds(markSpotFull(selected.id))
        runFindAlternatives({ autoGo: true })
      }
    },
    [selected, runFindAlternatives, setToast],
  )

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
            route={routePlan?.drive ?? null}
            walkRoute={routePlan?.walk ?? null}
            navigating={Boolean(routePlan)}
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
                nearestPickerOpen ||
                draftPin ||
                editingPinId,
            )}
            cityId={cityId}
            myPins={myPins}
            draftPin={
              draftPin
                ? {
                    lat: draftPin.lat,
                    lng: draftPin.lng,
                    color: draftColorPreview,
                  }
                : null
            }
            editingPinId={editingPinId}
            pinDragEnabled={pinDragEnabled}
            onLongPress={handleLongPress}
            onMyPinClick={handleMyPinClick}
            onMyPinDragEnd={handleMyPinDragEnd}
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
                  {(geoLoading || pendingEnterSelect) &&
                  clampSearchQuery(query).length >= 3 ? (
                    <Loader2
                      className={`pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] -translate-y-1/2 animate-spin ${muted}`}
                      strokeWidth={2.2}
                      aria-hidden
                    />
                  ) : (
                    <Search
                      className={`pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] -translate-y-1/2 ${muted}`}
                      strokeWidth={2.2}
                    />
                  )}
                  <input
                    ref={searchInputRef}
                    role="combobox"
                    aria-expanded={isDropdownOpen}
                    aria-controls="search-suggestions"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      isDropdownOpen &&
                      clampSearchQuery(query).length >= 3 &&
                      searchSuggestions[activeIndex]
                        ? suggestionOptionId(
                            searchSuggestions[activeIndex],
                            activeIndex,
                          )
                        : undefined
                    }
                    value={query}
                    onChange={(e) => {
                      skipNextGeocode.current = false
                      cancelPendingEnter()
                      const v = e.target.value.slice(0, 120)
                      setQuery(v)
                      const qLen = clampSearchQuery(v).length
                      setIsDropdownOpen(qLen >= 3 || myPins.length > 0)
                      if (qLen < 3) setMyPinsExpanded(false)
                    }}
                    onFocus={() => {
                      const q = clampSearchQuery(query).length
                      if (q >= 3 || myPins.length > 0) setIsDropdownOpen(true)
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Otsi aadressi või kohta Eestis"
                    aria-label="Otsi aadressi või kohta"
                    className={`w-full rounded-2xl border-0 bg-transparent py-3 pr-10 pl-10 text-[16px] font-sans outline-none ${text} placeholder:text-[#8E8E93]`}
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        skipNextGeocode.current = false
                        cancelPendingEnter()
                        setQuery('')
                        clearGeo()
                        setIsDropdownOpen(myPins.length > 0)
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
                  aria-label="Reeglid"
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

            {isDropdownOpen &&
            (clampSearchQuery(query).length >= 3 || myPins.length > 0) ? (
              <div className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50">
                <SearchDropdown
                  loading={
                    (geoLoading || Boolean(pendingEnterSelect)) &&
                    searchSuggestions.length === 0 &&
                    clampSearchQuery(query).length >= 3
                  }
                  error={geoError}
                  suggestions={
                    clampSearchQuery(query).length >= 3 ? searchSuggestions : []
                  }
                  dark={dark}
                  onSelect={selectSearchSuggestion}
                  activeIndex={activeIndex}
                  onActiveIndexChange={setActiveIndex}
                  myPins={
                    clampSearchQuery(query).length < 3 ? myPins : undefined
                  }
                  myPinsExpanded={myPinsExpanded}
                  onExpandMyPins={() => setMyPinsExpanded(true)}
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
                    onClick={() => {
                      setFilter(f.id)
                      track('filter_used', { filter: f.id })
                      if (f.id === 'free_street') {
                        track('free_now_toggled', { filter: f.id })
                      }
                    }}
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
          {routeSummaryReady && routePlan && !selected ? (
            <div
              data-testid="route-summary"
              className={`pointer-events-auto w-full animate-fade-in px-3 py-2.5 ${panel}`}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={`truncate text-[13px] font-semibold ${text}`}>
                    {routePlan.label}
                  </p>
                  {routePlan.drive ? (
                    <p
                      className={`flex items-center gap-1.5 text-[12px] font-semibold ${
                        dark ? 'text-[#64D2FF]' : 'text-[#007AFF]'
                      }`}
                    >
                      <Car className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>Autoga</span>
                      <span className={muted}>
                        {formatDistance(routePlan.drive.distanceMeters)}
                        {' · '}
                        {formatDuration(routePlan.drive.durationSeconds)}
                      </span>
                    </p>
                  ) : null}
                  {routePlan.walk ? (
                    <p
                      className={`flex flex-wrap items-center gap-1.5 text-[12px] font-semibold ${
                        routePlan.walk.isFallback
                          ? muted
                          : dark
                            ? 'text-[#FF9F0A]'
                            : 'text-[#FF9500]'
                      }`}
                    >
                      <Footprints className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        {routePlan.walk.isFallback
                          ? 'Ligikaudne jalutuskäik'
                          : 'Jalgsi'}
                      </span>
                      <span className={muted}>
                        {formatDistance(routePlan.walk.distanceMeters)}
                        {' · '}
                        {formatDuration(routePlan.walk.durationSeconds)}
                      </span>
                      {routePlan.longWalk ? (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            dark
                              ? 'bg-[#FF9F0A]/20 text-[#FF9F0A]'
                              : 'bg-[#FF9500]/15 text-[#C93400]'
                          }`}
                        >
                          Pikk jalutuskäik
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {routePlan.drive || routePlan.walk ? (
                    <p className={`text-[11px] font-medium ${muted}`}>
                      Kokku ~{' '}
                      {formatDuration(
                        (routePlan.drive?.durationSeconds ?? 0) +
                          (routePlan.walk?.durationSeconds ?? 0),
                      )}
                    </p>
                  ) : null}
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
        </div>
      </div>

      {/* Floating Action Buttons — location + 3D */}
      <div
        className={`absolute right-3 z-50 flex flex-col gap-2.5 sm:right-4 ${
          selected ||
          selectedEvCharger ||
          (searchSheetOpen && searchLocation) ||
          nearestPickerOpen ||
          draftPin ||
          editingPinId
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
          onClick={() => {
            if (timerOpen) closeSessionModal()
            else openSessionModal()
          }}
          className={`relative ${fabClass}`}
          title={activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
          aria-label={activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
          aria-expanded={timerOpen}
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
          aria-label="Paku uut kohta"
        >
          <Plus className="h-6 w-6" strokeWidth={2.4} />
        </button>
      </div>

      {/* Isolated clock-FAB session modal — never stacks in the left detail rail */}
      {timerOpen && !selected && !selectedEvCharger ? (
        <ParkingSessionModal
          dark={dark}
          carNumber={carNumber}
          onCarNumberChange={handleCarNumberChange}
          timerSeconds={timerSeconds}
          timerMode={timerMode}
          timerLabel={timerLabel}
          sessionLoading={sessionLoading}
          sessionAction={sessionAction}
          activeSession={activeSession}
          sessionNotice={sessionNotice}
          selectedSpot={null}
          onClose={closeSessionModal}
          onStart={() => {
            void beginParkingSession()
          }}
          onStop={() => {
            void endParkingSession()
          }}
          onStatus={() => {
            void refreshParkingStatus()
          }}
          onExtend={(mins) => {
            void addPrepaidMinutes(mins)
          }}
          formatHourlyRate={formatHourlyRate}
          formatSessionInstant={formatSessionInstant}
        />
      ) : null}
      {connectionNotice && !selected && !timerOpen ? (
        <p
          data-testid="connection-notice"
          className={`pointer-events-none absolute bottom-[max(5.5rem,env(safe-area-inset-bottom))] left-1/2 z-40 max-w-[min(90vw,20rem)] -translate-x-1/2 rounded-full px-3 py-1.5 text-center text-[10px] font-semibold ${
            dark ? 'bg-black/50 text-white/80' : 'bg-white/80 text-[#636366]'
          }`}
        >
          {connectionNotice}
        </p>
      ) : null}

      {selectedEvCharger && !selected ? (
        <EvChargerSheet
          feature={selectedEvCharger}
          dark={dark}
          onClose={() => setSelectedEvCharger(null)}
        />
      ) : null}

      {selected ? (
        <ParkingDetailPanel
          spot={selected}
          distanceLabel={selectedDist}
          carNumber={carNumber}
          onCarNumberChange={handleCarNumberChange}
          sessionLoading={sessionLoading}
          sessionAction={sessionAction}
          activeSession={activeSession}
          sessionNotice={sessionNotice}
          routeSummary={
            routeSummaryReady && routePlan
              ? {
                  label: routePlan.label,
                  driveDistanceM: routePlan.drive?.distanceMeters ?? 0,
                  driveDurationS: routePlan.drive?.durationSeconds ?? 0,
                  walkDistanceM: routePlan.walk?.distanceMeters,
                  walkDurationS: routePlan.walk?.durationSeconds,
                  walkIsFallback: routePlan.walk?.isFallback,
                  longWalk: routePlan.longWalk,
                }
              : null
          }
          onClearRoute={routePlan ? clearRoute : undefined}
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
          onCrowdReportSuccess={handleCrowdReportSuccess}
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

      {draftPin || editingPinId ? (
        <MyPinSheet
          key={editingPinId ?? `draft-${draftPin?.lat}-${draftPin?.lng}`}
          mode={editingPinId ? 'edit' : 'create'}
          draft={draftPin}
          pin={
            editingPinId
              ? myPins.find((p) => p.id === editingPinId) ?? null
              : null
          }
          dark={dark}
          onClose={closePinSheet}
          onSave={(payload) => {
            if (editingPinId) {
              handleUpdatePin(editingPinId, payload)
            } else {
              handleCreatePin(payload)
            }
          }}
          onDelete={
            editingPinId
              ? () => handleDeletePin(editingPinId)
              : undefined
          }
          onNavigate={
            editingPinId
              ? () => {
                  const pin = myPins.find((p) => p.id === editingPinId)
                  if (pin) navigateToMyPin(pin)
                }
              : undefined
          }
          onColorPreview={(c) => {
            setDraftColorPreview(c)
            if (draftPin) setDraftPin({ ...draftPin, color: c })
          }}
          onDragRequest={setPinDragEnabled}
        />
      ) : null}

      <Toast toast={toast} onClose={dismissToast} />

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
            <div className="rounded-2xl bg-paper-2 p-3">
              <h4 className="mb-1 text-sm font-bold text-ink">
                Minu pinnid ({myPins.length})
              </h4>
              <p>
                Vajuta kaardil pikalt, et lisada isiklik pin. Pinnid salvestatakse ainult
                sellesse seadmesse — teised kasutajad neid ei näe.
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
            if (reportContext?.mode === 'PROPOSE_NEW') {
              track('spot_added', { mode: 'PROPOSE_NEW' })
            }
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
