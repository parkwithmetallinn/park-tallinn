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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ActiveSessionsModal } from './components/ActiveSessionsModal'
import { MapErrorBoundary } from './components/MapErrorBoundary'
import { MapView } from './components/MapView'
import { ModalShell } from './components/ModalShell'
import { LocationInfoSheet } from './components/LocationInfoSheet'
import { ParkingBottomSheet } from './components/ParkingBottomSheet'
import { Toast, type ToastState } from './components/Toast'
import { MOCK_KESKLINN_SPOTS } from './data/mockKesklinn'
import { PARKING_SPOTS, TALLINN_CENTER } from './data/parking'
import { distanceMeters, formatDistance } from './lib/geo'
import {
  geocodeToSearchLocation,
  searchAddress,
  type GeocodeResult,
  type SearchLocation,
} from './lib/geocode'
import { normalizeSpot } from './lib/geojson'
import { formatHMS, TYPE_LABELS } from './lib/parking'
import {
  activeSessionFromDetails,
  checkParkingStatus,
  extendParkingSession,
  formatHourlyRate,
  formatSessionFeedbackDetail,
  formatSessionInstant,
  isActiveSessionStatus,
  isSessionNotFoundMessage,
  listActiveParkingSessions,
  sessionEndIso,
  sessionHourlyRate,
  sessionStartIso,
  startParkingSession,
  stopParkingSession,
  type ActiveParkingSession,
  type ParkingSessionDetails,
} from './lib/parkingSession'

/** Elapsed (count-up) vs prepaid countdown. */
type TimerMode = 'elapsed' | 'prepaid'

const TIME_EXTEND_OPTIONS = [
  { minutes: 15, label: '+15m' },
  { minutes: 30, label: '+30m' },
  { minutes: 60, label: '+1h' },
  { minutes: 120, label: '+2h' },
] as const
import { parkingIndex } from './lib/spatialIndex'
import {
  loadActiveSession,
  loadCarNumber,
  loadCustomSpots,
  saveActiveSession,
  saveCarNumber,
  saveCustomSpot,
} from './lib/storage'
import { PARKING_LAYER_META } from './map/parkingLayers'
import type { FilterId, ParkingSpot, SpotType } from './types'

/** Apple HIG quick filters — primary parking intents */
const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'free_street', label: 'Tasuta', color: PARKING_LAYER_META.free_street.color },
  { id: 'timed', label: 'Kellaga', color: PARKING_LAYER_META.timed.color },
  { id: 'europark', label: 'EuroPark', color: PARKING_LAYER_META.europark.color },
  { id: 'snabb', label: 'Snabb', color: PARKING_LAYER_META.snabb.color },
  { id: 'ev', label: 'Elektriauto', color: PARKING_LAYER_META.ev.color },
]

const glass =
  'rounded-2xl border border-white/55 bg-white/72 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur-md'
const glassDark =
  'rounded-2xl border border-white/10 bg-[#1C1C1E]/78 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-md'

export default function App() {
  const [dark, setDark] = useState(false)
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<[number, number]>(TALLINN_CENTER)
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
  const [reportOpen, setReportOpen] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerMode, setTimerMode] = useState<TimerMode>('elapsed')
  const [timerLabel, setTimerLabel] = useState('Määra aeg või vali kellaga koht')
  const [timerOpen, setTimerOpen] = useState(false)
  const [carNumber, setCarNumber] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionAction, setSessionAction] = useState<
    'start' | 'stop' | 'status' | 'extend' | null
  >(null)
  const [activeSession, setActiveSession] = useState<ActiveParkingSession | null>(null)
  const [sessionNotice, setSessionNotice] = useState<{
    kind: 'success' | 'error' | 'info' | 'loading'
    text: string
  } | null>(null)
  const [sessionsOverviewOpen, setSessionsOverviewOpen] = useState(false)
  const [activeSessionsList, setActiveSessionsList] = useState<ParkingSessionDetails[]>([])
  const [activeSessionsCount, setActiveSessionsCount] = useState<number | undefined>()
  const [activeSessionsMessage, setActiveSessionsMessage] = useState<string | undefined>()
  const [toast, setToast] = useState<ToastState>(null)
  const [pitch3d, setPitch3d] = useState(true)
  const [preciseSpots, setPreciseSpots] = useState<ParkingSpot[]>([])
  const [streetSpots, setStreetSpots] = useState<ParkingSpot[]>([])
  const geoAbort = useRef<AbortController | null>(null)

  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    setCustomSpots(loadCustomSpots())
    setCarNumber(loadCarNumber())
    const saved = loadActiveSession()
    if (saved) {
      setActiveSession(saved)
      setTimerMode('elapsed')
      setTimerRunning(true)
      setTimerLabel(
        `Sessioon: ${saved.spotName ?? saved.zone} · ${saved.carNumber}`,
      )
      setTimerOpen(true)
      if (saved.startedAt) {
        const startMs = Date.parse(saved.startedAt)
        if (Number.isFinite(startMs)) {
          setTimerSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
        }
      }
    }
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

  // Mode 1 — live duration: tick UP from session startTime
  useEffect(() => {
    if (timerMode !== 'elapsed' || !activeSession?.startedAt) return
    const startMs = Date.parse(activeSession.startedAt)
    if (!Number.isFinite(startMs)) return
    const tick = () => {
      setTimerSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerMode, activeSession?.startedAt])

  // Mode 2 — prepaid / time limit: count DOWN
  useEffect(() => {
    if (timerMode !== 'prepaid' || !timerRunning) return
    if (timerSeconds <= 0) return
    const id = window.setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) {
          setTimerRunning(false)
          setTimerLabel('Aeg läbi! Liiguta autot või pikenda')
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [timerMode, timerRunning, timerSeconds])

  // Nominatim geocoding (debounced)
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
        const results = await searchAddress(q, ac.signal)
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

  const allSpots = useMemo(() => {
    const curated = PARKING_SPOTS.map((s) =>
      normalizeSpot({
        ...s,
        landmark: s.kind === 'lot' || s.type === 'pr' || s.id.startsWith('timed-'),
        layer:
          s.type === 'pr'
            ? 'park_ride'
            : s.type === 'timed'
              ? 'timed'
              : s.kind === 'street'
                ? 'free_street'
                : 'municipal',
      }),
    )
    const mocks = MOCK_KESKLINN_SPOTS.map((s) => normalizeSpot(s))
    const custom = customSpots.map((s) => normalizeSpot(s))
    // Precise GeoJSON lots / street lines take precedence over stub mocks
    const mockWithoutDupes = mocks.filter((m) => {
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
    return [...preciseSpots, ...streetSpots, ...mockWithoutDupes, ...curated, ...custom]
  }, [customSpots, preciseSpots, streetSpots])

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
  }, [allSpots])

  useEffect(() => {
    parkingIndex.bulkLoad(allSpots)
  }, [allSpots])

  const openSheet = useCallback((spot: ParkingSpot) => {
    setSearchSheetOpen(false)
    setSelected(spot)
  }, [])

  const closeSheet = useCallback(() => setSelected(null), [])

  const dismissMapOverlays = useCallback(() => {
    setSelected(null)
    setSearchSheetOpen(false)
    setGeoResults([])
    setGeoError(null)
  }, [])

  const clearSearchLocation = useCallback(() => {
    setSearchLocation(null)
    setSearchSheetOpen(false)
    setQuery('')
    setGeoResults([])
    setGeoError(null)
  }, [])

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

  const flyToGeocode = (r: GeocodeResult) => {
    const loc = geocodeToSearchLocation(r)
    if (searchSheetTimer.current) {
      window.clearTimeout(searchSheetTimer.current)
      searchSheetTimer.current = null
    }
    setSearchSheetOpen(false)
    setSearchLocation(loc)
    setQuery(loc.name)
    setGeoResults([])
    setGeoError(null)

    // Destination Interceptor — nearest roadside / lot parking within 400 m
    const nearby = parkingIndex.queryNearbyParking(loc.lat, loc.lng, 400)
    if (nearby) {
      const { spot } = nearby
      setSelected(null)
      setFlyMode('fly')
      setFlyTarget([spot.lat, spot.lng])
      setFlyZoom(16.8)
      setFlyKey((k) => k + 1)
      searchSheetTimer.current = window.setTimeout(() => {
        setSearchSheetOpen(false)
        setSelected(spot)
        searchSheetTimer.current = null
      }, 720)
      return
    }

    setSelected(null)
    setFlyMode('fly')
    setFlyTarget([loc.lat, loc.lng])
    setFlyZoom(16.5)
    setFlyKey((k) => k + 1)
    // Fly first, then open the info sheet
    searchSheetTimer.current = window.setTimeout(() => {
      setSearchSheetOpen(true)
      searchSheetTimer.current = null
    }, 720)
  }

  const handleCarNumberChange = (value: string) => {
    setCarNumber(value)
    saveCarNumber(value)
  }

  const persistActive = (session: ActiveParkingSession | null) => {
    setActiveSession(session)
    saveActiveSession(session)
  }

  /** Clear local active session + timer so UI returns to Start. */
  const clearLocalSession = (label = 'Määra aeg või vali kellaga koht') => {
    persistActive(null)
    setTimerRunning(false)
    setTimerSeconds(0)
    setTimerMode('elapsed')
    setTimerLabel(label)
  }

  const startElapsedTimer = (startedAt?: string, label?: string) => {
    const iso = startedAt || new Date().toISOString()
    const startMs = Date.parse(iso)
    setTimerMode('elapsed')
    setTimerSeconds(
      Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0,
    )
    setTimerRunning(true)
    setTimerOpen(true)
    if (label) setTimerLabel(label)
  }

  const showSessionFeedback = (
    kind: 'success' | 'error' | 'info' | 'loading',
    title: string,
    detail?: string,
  ) => {
    const text = detail ? `${title} — ${detail}` : title
    setSessionNotice({ kind, text })
    setToast({ kind, title, detail })
  }

  const beginParkingSession = async () => {
    if (!selected) return
    const zone = selected.zone_code
    const plate = carNumber.trim()
    if (!plate) {
      showSessionFeedback('error', 'Sisesta auto number')
      return
    }
    if (activeSession) {
      showSessionFeedback(
        'error',
        'Sessioon juba käib',
        `Lõpeta enne ${activeSession.carNumber} · ${activeSession.zone}`,
      )
      return
    }

    setSessionLoading(true)
    setSessionAction('start')
    showSessionFeedback('loading', 'Alustan parkimissessiooni…', `${plate} · ${zone}`)

    const result = await startParkingSession({ carNumber: plate, zone })

    setSessionLoading(false)
    setSessionAction(null)
    if (result.success) {
      const details = result.sessionDetails
      const startedAt = sessionStartIso(details)
      const status = String(details?.status ?? 'ACTIVE')
      const hourlyRate =
        sessionHourlyRate(details) ??
        (selected.price_per_hour > 0 ? selected.price_per_hour : undefined)
      const resolvedZone = String(details?.zone ?? zone)
      const resolvedPlate = String(details?.carNumber ?? plate).toUpperCase()
      // Keep sheet open — UI switches to active details + "Lõpeta sessioon"
      persistActive({
        carNumber: resolvedPlate,
        zone: resolvedZone,
        spotName: selected.name,
        startedAt,
        status,
        hourlyRate,
      })
      if (resolvedPlate !== carNumber.trim().toUpperCase()) {
        setCarNumber(resolvedPlate)
        saveCarNumber(resolvedPlate)
      }

      const rateLabel = formatHourlyRate(hourlyRate)
      // Mode 1 — live duration counter (ticks up from startTime)
      startElapsedTimer(
        startedAt || new Date().toISOString(),
        `Sessioon: ${selected.name} · ${resolvedPlate}${rateLabel ? ` · ${rateLabel}` : ''}`,
      )

      showSessionFeedback(
        'success',
        'Parkimine alanud',
        formatSessionFeedbackDetail(result, [
          details?.sessionId ? `ID ${details.sessionId}` : null,
        ]),
      )
    } else {
      showSessionFeedback('error', 'Sessiooni ei alustatud', result.message)
    }
  }

  const endParkingSession = async () => {
    const session = activeSession
    if (!session) {
      clearLocalSession()
      showSessionFeedback('info', 'Aktiivset sessiooni pole')
      return
    }

    setSessionLoading(true)
    setSessionAction('stop')
    showSessionFeedback(
      'loading',
      'Lõpetan parkimissessiooni…',
      `${session.carNumber} · ${session.zone}`,
    )

    const result = await stopParkingSession({
      carNumber: session.carNumber,
      zone: session.zone,
    })

    setSessionLoading(false)
    setSessionAction(null)

    const missing = isSessionNotFoundMessage(result.message)
    const detailsStopped =
      result.sessionDetails != null && !isActiveSessionStatus(result.sessionDetails)

    // Success, "not found", or stopped details → always reset to Start button
    if (result.success || missing || detailsStopped) {
      clearLocalSession('Sessioon lõpetatud')
      const ended = formatSessionInstant(sessionEndIso(result.sessionDetails))
      showSessionFeedback(
        result.success || detailsStopped ? 'success' : 'info',
        result.success || detailsStopped ? 'Parkimine lõpetatud' : 'Aktiivset sessiooni pole',
        formatSessionFeedbackDetail(result, [ended ? `lõpp ${ended}` : null]),
      )
      return
    }

    // Unexpected stop failure — still unstick UI so Start is available again
    clearLocalSession()
    showSessionFeedback('error', 'Sessiooni ei lõpetatud', result.message)
  }

  const loadActiveSessionsOverview = async () => {
    setSessionLoading(true)
    setSessionAction('status')
    showSessionFeedback('loading', 'Laadin aktiivseid sessioone…')

    const result = await listActiveParkingSessions()

    setSessionLoading(false)
    setSessionAction(null)

    if (!result.success) {
      showSessionFeedback('error', 'Sessioonide nimekiri ebaõnnestus', result.message)
      return
    }

    const list = result.activeSessions ?? []
    const count = result.count ?? list.length
    setActiveSessionsList(list)
    setActiveSessionsCount(count)
    setActiveSessionsMessage(result.message)
    setSessionsOverviewOpen(true)

    // Sync details if our plate appears — never clear local session from list view
    const plate = (carNumber.trim() || activeSession?.carNumber || '').toUpperCase()
    if (plate) {
      const mine = list.find(
        (s) => String(s.carNumber ?? '').toUpperCase() === plate && isActiveSessionStatus(s),
      )
      if (mine) {
        const synced = activeSessionFromDetails(mine, {
          carNumber: plate,
          spotName: activeSession?.spotName ?? selected?.name,
        })
        if (synced) persistActive(synced)
      }
    }

    showSessionFeedback(
      'success',
      'Aktiivsed sessioonid',
      formatSessionFeedbackDetail(result),
    )
  }

  /**
   * Status ONLY — POST { action: "status", carNumber }.
   * Never calls start/stop/extend and never clears a live local session.
   */
  const refreshParkingStatus = async () => {
    const plate = (carNumber.trim() || activeSession?.carNumber || '').trim()

    // No plate → list-all status (still action: "status" only)
    if (!plate) {
      await loadActiveSessionsOverview()
      return
    }

    setSessionLoading(true)
    setSessionAction('status')
    showSessionFeedback('loading', 'Kontrollin parkimise staatust…', plate)

    const result = await checkParkingStatus({ carNumber: plate })

    setSessionLoading(false)
    setSessionAction(null)

    const details = result.sessionDetails
    const fromList = result.activeSessions?.find(
      (s) =>
        String(s.carNumber ?? '').toUpperCase() === plate.toUpperCase() &&
        isActiveSessionStatus(s),
    )
    const activeDetails =
      (details && isActiveSessionStatus(details) ? details : null) ?? fromList ?? null

    if (activeDetails) {
      const synced = activeSessionFromDetails(activeDetails, {
        carNumber: plate,
        zone: activeSession?.zone || selected?.zone_code,
        spotName: activeSession?.spotName ?? selected?.name,
        hourlyRate: activeSession?.hourlyRate,
      })
      if (synced) {
        persistActive(synced)
        const rateLabel = formatHourlyRate(synced.hourlyRate)
        setTimerLabel(
          `Sessioon: ${synced.spotName ?? synced.zone} · ${synced.carNumber}${
            rateLabel ? ` · ${rateLabel}` : ''
          }`,
        )
        setTimerOpen(true)
        // Keep current timer mode; if elapsed and we got startTime, resume count-up
        if (timerMode === 'elapsed' && synced.startedAt) {
          startElapsedTimer(synced.startedAt)
        }
        if (synced.carNumber !== carNumber.trim().toUpperCase()) {
          setCarNumber(synced.carNumber)
          saveCarNumber(synced.carNumber)
        }
      }
      showSessionFeedback(
        'success',
        'Aktiivne parkimine',
        formatSessionFeedbackDetail({ ...result, sessionDetails: activeDetails }),
      )
      return
    }

    // Backend has no record — report cleanly but DO NOT interrupt local session
    showSessionFeedback(
      'info',
      activeSession ? 'Serveris sessiooni ei leitud' : 'Aktiivset parkimist pole',
      result.message || 'Sellel autol pole aktiivset parkimist',
    )
  }

  /**
   * Mode 2 — add prepaid time. Local countdown + optional n8n extend.
   * Isolated action: { action: "extend", carNumber, zone, minutes }
   */
  const addPrepaidMinutes = async (minutes: number) => {
    if (minutes <= 0) return

    // Switch to prepaid countdown and add time locally first
    setTimerMode('prepaid')
    setTimerSeconds((prev) =>
      timerMode === 'prepaid' ? prev + minutes * 60 : minutes * 60,
    )
    setTimerRunning(true)
    setTimerOpen(true)
    setTimerLabel(
      activeSession
        ? `Ettemaks +${minutes} min · ${activeSession.carNumber}`
        : `Ettemaks +${minutes} min`,
    )

    if (!activeSession) {
      showSessionFeedback('info', `Lisatud ${minutes} min`, 'Kohalik taimer (sessioon puudub)')
      return
    }

    setSessionLoading(true)
    setSessionAction('extend')
    const result = await extendParkingSession({
      carNumber: activeSession.carNumber,
      zone: activeSession.zone,
      minutes,
    })
    setSessionLoading(false)
    setSessionAction(null)

    if (result.success || (result.message && !/ebaõnnestus|failed|error/i.test(result.message))) {
      showSessionFeedback(
        'success',
        `+${minutes} min lisatud`,
        result.message || `${activeSession.carNumber} · ${activeSession.zone}`,
      )
    } else {
      // Local timer already updated — surface backend note without rolling back
      showSessionFeedback(
        'info',
        `+${minutes} min kohalikult`,
        result.message || 'Serveri pikendus ei vastanud',
      )
    }
  }

  const adoptListedSession = (details: ParkingSessionDetails) => {
    const synced = activeSessionFromDetails(details, {
      spotName: activeSession?.spotName ?? selected?.name,
    })
    if (!synced) return
    persistActive(synced)
    setCarNumber(synced.carNumber)
    saveCarNumber(synced.carNumber)
    const rateLabel = formatHourlyRate(synced.hourlyRate)
    setTimerLabel(
      `Sessioon: ${synced.zone} · ${synced.carNumber}${rateLabel ? ` · ${rateLabel}` : ''}`,
    )
    setTimerOpen(true)
    setSessionsOverviewOpen(false)
    showSessionFeedback(
      'success',
      'Sessioon valitud',
      `${synced.carNumber} · ${synced.zone}${rateLabel ? ` · ${rateLabel}` : ''}`,
    )
  }

  const submitReport = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const type = (fd.get('type') as ParkingSpot['type']) || 'free'
    const kind = (fd.get('kind') as ParkingSpot['kind']) || 'street'
    const name = String(fd.get('name') || '').trim()
    const address = String(fd.get('address') || '').trim()
    const limit = String(fd.get('limit') || 'Tasuta').trim()
    const notes = String(fd.get('notes') || '').trim()
    if (!name || !address) return

    const spot = normalizeSpot({
      id: `custom-${Date.now()}`,
      name,
      type,
      kind,
      badge: type === 'free' ? (kind === 'street' ? 'TÄNAV' : 'TASUTA') : type === 'pr' ? 'P&R' : 'KELLAGA',
      timeLimit: limit,
      lat: userLocation[0] + (Math.random() - 0.5) * 0.004,
      lng: userLocation[1] + (Math.random() - 0.5) * 0.004,
      address,
      desc: notes || 'Kasutaja lisatud koht',
      custom: true,
      landmark: true,
    })
    saveCustomSpot(spot)
    setCustomSpots(loadCustomSpots())
    setReportOpen(false)
    e.currentTarget.reset()
  }

  useEffect(() => {
    document.documentElement.classList.toggle('map-dark', dark)
  }, [dark])

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

  const fabClass = `flex h-[52px] w-[52px] items-center justify-center rounded-full ${panel} ${text} shadow-[0_4px_16px_rgba(15,23,42,0.14)] transition active:scale-95`

  return (
    <div className={`relative h-full overflow-hidden ${dark ? 'bg-[#0f1714]' : 'bg-transparent'}`}>
      {/* Full-bleed map */}
      <div className="absolute inset-0">
        <MapErrorBoundary>
          <MapView
            spots={allSpots}
            filter={filter}
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
            route={null}
            navigating={false}
            onNavigate={openSheet}
            onBackgroundClick={dismissMapOverlays}
            onZoomChange={() => {}}
            onPreciseSpotsLoaded={setPreciseSpots}
            onStreetSpotsLoaded={setStreetSpots}
          />
        </MapErrorBoundary>
      </div>

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
                  placeholder="Otsi aadressi või kohta"
                  className={`w-full rounded-2xl border-0 bg-transparent py-3 pr-10 pl-10 text-[16px] outline-none ${text} placeholder:text-[#8E8E93]`}
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setGeoResults([])
                    }}
                    className={`absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 ${muted} bg-black/5`}
                    aria-label="Tühjenda"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className={`rounded-full p-2.5 ${chip}`}
                title="Reeglid"
              >
                <CircleHelp className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setDark((d) => !d)}
                className={`rounded-full p-2.5 ${chip}`}
                title="Hele / tume"
              >
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>

            {(geoLoading || geoResults.length > 0 || geoError) && query.trim().length >= 3 ? (
              <div className="max-h-52 overflow-y-auto border-t border-black/6 px-1 py-1">
                {geoLoading ? (
                  <p className={`px-3 py-2.5 text-[13px] ${muted}`}>Otsin…</p>
                ) : null}
                {geoError ? (
                  <p className="px-3 py-2.5 text-[13px] text-[#FF3B30]">{geoError}</p>
                ) : null}
                {geoResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => flyToGeocode(r)}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-black/4 ${text}`}
                  >
                    <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#007AFF]" />
                    <span className="text-[14px] leading-snug font-medium">{r.label}</span>
                  </button>
                ))}
                {!geoLoading && !geoError && geoResults.length === 0 ? (
                  <p className={`px-3 py-2.5 text-[13px] ${muted}`}>Tulemusi ei leitud</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto px-0.5 py-0.5">
            {FILTERS.map((f) => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  data-filter={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold shadow-sm transition active:scale-[0.97] ${
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

      {/* Floating Action Buttons — location + 3D */}
      <div className="absolute right-3 bottom-[max(6.5rem,env(safe-area-inset-bottom))] z-20 flex flex-col gap-2.5 sm:right-4">
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
          onClick={() => setReportOpen(true)}
          className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#34C759] text-white shadow-[0_4px_16px_rgba(52,199,89,0.35)] transition active:scale-95"
          title="Lisa koht"
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
          <label className={`mb-1 block text-[10px] font-semibold ${muted}`}>Auto number</label>
          <input
            value={carNumber}
            onChange={(e) => handleCarNumberChange(e.target.value.toUpperCase())}
            placeholder="nt 123ABC"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={sessionLoading}
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
                onClick={() => void addPrepaidMinutes(opt.minutes)}
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
                onClick={() => void endParkingSession()}
                className="flex-1 rounded-xl bg-clay py-2 text-xs font-bold text-white disabled:opacity-55"
              >
                {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
              </button>
            ) : (
              <button
                type="button"
                disabled={sessionLoading || !selected || carNumber.trim().length < 2}
                onClick={() => void beginParkingSession()}
                className="flex-1 rounded-xl bg-moss py-2 text-xs font-bold text-white disabled:opacity-55"
              >
                {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
              </button>
            )}
            <button
              type="button"
              disabled={sessionLoading}
              onClick={() => void refreshParkingStatus()}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
              title="Ainult staatuse päring (ei peata ega alusta)"
            >
              {sessionAction === 'status' ? '…' : 'Staatus'}
            </button>
            <button
              type="button"
              disabled={sessionLoading}
              onClick={() => void loadActiveSessionsOverview()}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
              title="Kõik aktiivsed sessioonid"
            >
              Kõik
            </button>
          </div>
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
          onClose={closeSheet}
          onStartSession={() => void beginParkingSession()}
          onStopSession={() => void endParkingSession()}
          onCheckStatus={() => void refreshParkingStatus()}
          onExtendMinutes={(mins) => void addPrepaidMinutes(mins)}
        />
      ) : null}

      {searchSheetOpen && searchLocation && !selected ? (
        <LocationInfoSheet
          location={searchLocation}
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
          onSelect={adoptListedSession}
        />
      ) : null}

      {infoOpen ? (
        <ModalShell onClose={() => setInfoOpen(false)} title="Tallinna parkimisreeglid">
          <div className="max-h-[60vh] space-y-3 overflow-y-auto text-xs leading-relaxed text-ink-soft">
            <div className="rounded-2xl border border-sea/20 bg-sea/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-sea">Esimesed 15 minutit tasuta</h4>
              <p>
                Avalikel tasulistel linnatänavatel kehtib esimesed 15 minutit tasuta. Pane kell
                esiklaasile.
              </p>
            </div>
            <div className="rounded-2xl bg-paper-2 p-3">
              <h4 className="mb-1 text-sm font-bold text-ink">Kesklinna tasuta kellaajad</h4>
              <p>• Tööpäeviti tasuline 07:00–19:00</p>
              <p>• Laupäeval tasuline 08:00–15:00</p>
              <p>• Pühapäeval ja riigipühadel tasuta</p>
            </div>
            <div className="rounded-2xl border border-moss/20 bg-moss/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-moss">Kaart</h4>
              <p>
                Rohelised jooned = tasuta tänav · kollased = kellaga · värvilised alad =
                eraparklad. Otsi aadressi ülevalt.
              </p>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {reportOpen ? (
        <ModalShell onClose={() => setReportOpen(false)} title="Teata uuest kohast">
          <form onSubmit={submitReport} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Nimi</label>
              <input
                name="name"
                required
                placeholder="nt Pelguranna tasuta tänav"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Tüüp</label>
                <select
                  name="type"
                  className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none"
                >
                  {(Object.keys(TYPE_LABELS) as SpotType[])
                    .filter((t) => t !== 'paid')
                    .map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Koht</label>
                <select
                  name="kind"
                  className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none"
                >
                  <option value="street">Tänavaäär</option>
                  <option value="lot">Avalik parkla</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Ajapiirang</label>
              <input
                name="limit"
                placeholder="nt 2 tundi / Piiranguta"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Aadress</label>
              <input
                name="address"
                required
                placeholder="Tänav, linnaosa"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Lisainfo</label>
              <textarea
                name="notes"
                rows={2}
                placeholder="Tingimused, märgid…"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-moss py-3 text-sm font-bold text-white shadow-lg transition hover:bg-moss-deep"
            >
              Lisa parkimiskoht
            </button>
          </form>
        </ModalShell>
      ) : null}

      {!hasGps ? null : null}
    </div>
  )
}
