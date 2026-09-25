import {
  CircleHelp,
  Clock3,
  LocateFixed,
  MapPin,
  Moon,
  Navigation,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MapErrorBoundary } from './components/MapErrorBoundary'
import { MapView } from './components/MapView'
import { ModalShell } from './components/ModalShell'
import { ParkingBottomSheet } from './components/ParkingBottomSheet'
import { Toast, type ToastState } from './components/Toast'
import { MOCK_KESKLINN_SPOTS } from './data/mockKesklinn'
import { PARKING_SPOTS, TALLINN_CENTER } from './data/parking'
import { distanceMeters, formatDistance } from './lib/geo'
import { searchAddress, type GeocodeResult } from './lib/geocode'
import { normalizeSpot } from './lib/geojson'
import { formatHMS, minutesFromBadge, TYPE_LABELS } from './lib/parking'
import {
  activeSessionFromDetails,
  checkParkingStatus,
  formatSessionInstant,
  isActiveSessionStatus,
  sessionEndIso,
  sessionStartIso,
  startParkingSession,
  stopParkingSession,
  type ActiveParkingSession,
} from './lib/parkingSession'
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

const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'municipal', label: 'Linnatsoon', color: PARKING_LAYER_META.municipal.color },
  { id: 'free_street', label: 'Tasuta', color: PARKING_LAYER_META.free_street.color },
  { id: 'timed', label: 'Kellaga', color: PARKING_LAYER_META.timed.color },
  { id: 'europark', label: 'EuroPark', color: PARKING_LAYER_META.europark.color },
  { id: 'snabb', label: 'Snabb', color: PARKING_LAYER_META.snabb.color },
  { id: 'citypark', label: 'Citypark', color: PARKING_LAYER_META.citypark.color },
  { id: 'ev', label: 'EV', color: PARKING_LAYER_META.ev.color },
  { id: 'inva', label: 'Inva', color: PARKING_LAYER_META.inva.color },
  { id: 'park_ride', label: 'P&R', color: PARKING_LAYER_META.park_ride.color },
]

const glass =
  'rounded-[1.35rem] border border-white/50 bg-white/75 shadow-[0_8px_32px_rgba(15,23,42,0.12)] backdrop-blur-2xl'
const glassDark =
  'rounded-[1.35rem] border border-white/10 bg-[#15201b]/80 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl'

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
  const [customSpots, setCustomSpots] = useState<ParkingSpot[]>([])
  const [selected, setSelected] = useState<ParkingSpot | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerLabel, setTimerLabel] = useState('Määra aeg või vali kellaga koht')
  const [timerOpen, setTimerOpen] = useState(false)
  const [carNumber, setCarNumber] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionAction, setSessionAction] = useState<'start' | 'stop' | 'status' | null>(null)
  const [activeSession, setActiveSession] = useState<ActiveParkingSession | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const geoAbort = useRef<AbortController | null>(null)

  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    setCustomSpots(loadCustomSpots())
    setCarNumber(loadCarNumber())
    const saved = loadActiveSession()
    if (saved) {
      setActiveSession(saved)
      setTimerLabel(
        `Sessioon: ${saved.spotName ?? saved.zone} · ${saved.carNumber}`,
      )
      setTimerOpen(true)
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

  useEffect(() => {
    if (!timerRunning || timerSeconds <= 0) return
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
  }, [timerRunning, timerSeconds])

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
    // Curated mock + public lots only — no dense synthetic grid clutter
    return [...mocks, ...curated, ...custom]
  }, [customSpots])

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
    setFlyTarget([match.lat, match.lng])
    setFlyZoom(16.5)
    setFlyKey((k) => k + 1)
    if (params.get('panel') === '1' || params.get('timer') === '1') {
      setTimerOpen(true)
    }
  }, [allSpots])

  useEffect(() => {
    parkingIndex.bulkLoad(allSpots)
  }, [allSpots])

  const nearest = useMemo(() => {
    const candidates = allSpots.filter(
      (s) =>
        s.landmark &&
        !s.id.startsWith('gen-') &&
        !s.id.includes('15min') &&
        !s.id.includes('center-evening'),
    )
    let best: ParkingSpot | null = null
    let bestD = Infinity
    for (const spot of candidates) {
      const d = distanceMeters(userLocation[0], userLocation[1], spot.lat, spot.lng)
      if (d < bestD) {
        bestD = d
        best = spot
      }
    }
    if (!best) return null
    return { spot: best, dist: formatDistance(bestD) }
  }, [allSpots, userLocation])

  const openSheet = useCallback((spot: ParkingSpot) => {
    setSelected(spot)
  }, [])

  const closeSheet = () => setSelected(null)

  const recenter = () => {
    setFlyTarget([...userLocation] as [number, number])
    setFlyZoom(15.5)
    setFlyKey((k) => k + 1)
  }

  const flyToGeocode = (r: GeocodeResult) => {
    setFlyTarget([r.lat, r.lng])
    setFlyZoom(16.2)
    setFlyKey((k) => k + 1)
    setQuery(r.label.split(',')[0] ?? r.label)
    setGeoResults([])
  }

  const addMinutes = (mins: number) => setTimerSeconds((s) => s + mins * 60)
  const startOrPause = () => {
    if (timerSeconds <= 0) return
    setTimerRunning((r) => !r)
  }
  const resetTimer = () => {
    setTimerRunning(false)
    setTimerSeconds(0)
    setTimerLabel('Määra aeg või vali kellaga koht')
  }

  const autoTimerFromSpot = () => {
    if (!selected) return
    const mins = minutesFromBadge(selected.badge) || selected.free_minutes || 60
    setTimerSeconds(mins * 60)
    setTimerLabel(`Määratud: ${selected.name}`)
    setTimerRunning(true)
    setTimerOpen(true)
    closeSheet()
  }

  const handleCarNumberChange = (value: string) => {
    setCarNumber(value)
    saveCarNumber(value)
  }

  const persistActive = (session: ActiveParkingSession | null) => {
    setActiveSession(session)
    saveActiveSession(session)
  }

  const beginParkingSession = async () => {
    if (!selected) return
    const zone = selected.zone_code
    const plate = carNumber.trim()
    if (!plate) {
      setToast({ kind: 'error', title: 'Sisesta auto number' })
      return
    }
    if (activeSession) {
      setToast({
        kind: 'error',
        title: 'Sessioon juba käib',
        detail: `Lõpeta enne ${activeSession.carNumber} · ${activeSession.zone}`,
      })
      return
    }

    setSessionLoading(true)
    setSessionAction('start')
    setToast({ kind: 'loading', title: 'Alustan parkimissessiooni…', detail: `${plate} · ${zone}` })

    const result = await startParkingSession({ carNumber: plate, zone })

    setSessionLoading(false)
    setSessionAction(null)
    if (result.success) {
      const startedAt = sessionStartIso(result.sessionDetails)
      const status = String(result.sessionDetails?.status ?? 'ACTIVE')
      persistActive({
        carNumber: plate.toUpperCase(),
        zone,
        spotName: selected.name,
        startedAt,
        status,
      })

      const mins = minutesFromBadge(selected.badge) || selected.free_minutes || 60
      setTimerSeconds(mins * 60)
      setTimerLabel(`Sessioon: ${selected.name} · ${plate}`)
      setTimerRunning(true)
      setTimerOpen(true)
      closeSheet()

      const detailParts = [result.message]
      if (result.sessionDetails?.sessionId) {
        detailParts.push(`ID ${result.sessionDetails.sessionId}`)
      }
      const startedLabel = formatSessionInstant(startedAt)
      if (startedLabel) detailParts.push(startedLabel)
      if (status) detailParts.push(status)
      setToast({
        kind: 'success',
        title: 'Parkimine alanud',
        detail: detailParts.filter(Boolean).join(' · '),
      })
    } else {
      setToast({
        kind: 'error',
        title: 'Sessiooni ei alustatud',
        detail: result.message,
      })
    }
  }

  const endParkingSession = async () => {
    const session = activeSession
    if (!session) {
      setToast({ kind: 'error', title: 'Aktiivset sessiooni pole' })
      return
    }

    setSessionLoading(true)
    setSessionAction('stop')
    setToast({
      kind: 'loading',
      title: 'Lõpetan parkimissessiooni…',
      detail: `${session.carNumber} · ${session.zone}`,
    })

    const result = await stopParkingSession({
      carNumber: session.carNumber,
      zone: session.zone,
    })

    setSessionLoading(false)
    setSessionAction(null)
    if (result.success) {
      persistActive(null)
      setTimerRunning(false)
      setTimerSeconds(0)
      setTimerLabel('Sessioon lõpetatud')

      const detailParts = [result.message]
      const ended = formatSessionInstant(sessionEndIso(result.sessionDetails))
      if (ended) detailParts.push(`lõpp ${ended}`)
      const status = result.sessionDetails?.status
      if (status) detailParts.push(String(status))
      setToast({
        kind: 'success',
        title: 'Parkimine lõpetatud',
        detail: detailParts.filter(Boolean).join(' · '),
      })
    } else {
      setToast({
        kind: 'error',
        title: 'Sessiooni ei lõpetatud',
        detail: result.message,
      })
    }
  }

  const refreshParkingStatus = async () => {
    const plate = (carNumber.trim() || activeSession?.carNumber || '').trim()
    const zone = activeSession?.zone || selected?.zone_code || undefined
    if (!plate) {
      setToast({ kind: 'error', title: 'Sisesta auto number' })
      return
    }

    setSessionLoading(true)
    setSessionAction('status')
    setToast({
      kind: 'loading',
      title: 'Kontrollin parkimise staatust…',
      detail: zone ? `${plate} · ${zone}` : plate,
    })

    const result = await checkParkingStatus({ carNumber: plate, zone })

    setSessionLoading(false)
    setSessionAction(null)

    if (!result.success) {
      setToast({
        kind: 'error',
        title: 'Staatuse päring ebaõnnestus',
        detail: result.message,
      })
      return
    }

    const details = result.sessionDetails
    if (isActiveSessionStatus(details) && details) {
      const synced = activeSessionFromDetails(details, {
        carNumber: plate,
        zone,
        spotName: activeSession?.spotName ?? selected?.name,
      })
      if (synced) {
        persistActive(synced)
        setTimerLabel(`Sessioon: ${synced.spotName ?? synced.zone} · ${synced.carNumber}`)
        setTimerOpen(true)
        if (synced.carNumber && synced.carNumber !== carNumber.trim().toUpperCase()) {
          setCarNumber(synced.carNumber)
          saveCarNumber(synced.carNumber)
        }
      }

      const detailParts = [result.message]
      if (synced) detailParts.push(`${synced.carNumber} · ${synced.zone}`)
      const started = formatSessionInstant(sessionStartIso(details))
      if (started) detailParts.push(`alates ${started}`)
      if (details.status) detailParts.push(String(details.status))
      setToast({
        kind: 'success',
        title: 'Aktiivne parkimine',
        detail: detailParts.filter(Boolean).join(' · '),
      })
    } else {
      persistActive(null)
      setTimerRunning(false)
      setTimerLabel('Aktiivset sessiooni ei leitud')
      const ended = formatSessionInstant(sessionEndIso(details))
      setToast({
        kind: 'info',
        title: 'Aktiivset parkimist pole',
        detail: [result.message, ended ? `lõpp ${ended}` : null, details?.status]
          .filter(Boolean)
          .join(' · '),
      })
    }
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
  const muted = dark ? 'text-[#9bb0a4]' : 'text-ink-soft'
  const text = dark ? 'text-[#e8f0eb]' : 'text-ink'
  const chip = dark
    ? 'bg-white/10 text-[#c9d9d0] hover:bg-white/15'
    : 'bg-white/60 text-ink-soft hover:bg-white/90'
  const chipActive = dark ? 'bg-[#e8f0eb] text-[#0f1714]' : 'bg-ink text-paper'

  const selectedDist = selected
    ? formatDistance(
        distanceMeters(userLocation[0], userLocation[1], selected.lat, selected.lng),
      )
    : null

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
            route={null}
            navigating={false}
            onNavigate={openSheet}
            onZoomChange={() => {}}
          />
        </MapErrorBoundary>
      </div>

      {/* Floating top chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <div className="pointer-events-auto mx-auto max-w-lg space-y-2.5">
          <div className={`flex items-center gap-2.5 px-3 py-2.5 ${panel}`}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-moss text-white shadow-md shadow-moss/25">
              <MapPin className="h-5 w-5" strokeWidth={2.4} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className={`font-display text-xl leading-none tracking-tight ${text}`}>
                Park Tallinn
              </h1>
              <p className={`mt-0.5 text-[11px] font-medium ${muted}`}>Tasuta · kellaga · P&R</p>
            </div>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className={`rounded-xl p-2 transition ${chip}`}
              title="Reeglid"
            >
              <CircleHelp className="h-4.5 w-4.5 h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className={`rounded-xl p-2 transition ${chip}`}
              title="Hele / tume"
            >
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={recenter}
              className="rounded-xl bg-sea p-2 text-white shadow-md shadow-sea/25 transition hover:brightness-110"
              title="Minu asukoht"
            >
              <LocateFixed className="h-5 w-5" />
            </button>
          </div>

          <div className={`relative px-1 py-1 ${panel}`}>
            <div className="relative">
              <Search
                className={`pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 ${muted} opacity-70`}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Otsi aadressi (nt Estonia pst 1)…"
                className={`w-full rounded-[1.1rem] border-0 bg-transparent py-3 pr-10 pl-10 text-sm outline-none ${text} placeholder:opacity-45`}
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
                  className={`absolute top-1/2 right-3 -translate-y-1/2 ${muted}`}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {(geoLoading || geoResults.length > 0 || geoError) && query.trim().length >= 3 ? (
              <div className="mt-1 max-h-52 overflow-y-auto border-t border-ink/6 px-1 py-1">
                {geoLoading ? (
                  <p className={`px-3 py-2 text-xs ${muted}`}>Otsin aadresse…</p>
                ) : null}
                {geoError ? <p className="px-3 py-2 text-xs text-clay">{geoError}</p> : null}
                {geoResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => flyToGeocode(r)}
                    className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition hover:bg-moss/8 ${text}`}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-moss" />
                    <span className="text-xs leading-snug font-medium">{r.label}</span>
                  </button>
                ))}
                {!geoLoading && !geoError && geoResults.length === 0 ? (
                  <p className={`px-3 py-2 text-xs ${muted}`}>Tulemusi ei leitud</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={`no-scrollbar flex gap-1.5 overflow-x-auto px-2 py-2 ${panel}`}>
            {FILTERS.map((f) => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  data-filter={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    active ? chipActive : chip
                  }`}
                >
                  {f.color && !active ? (
                    <span
                      className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: f.color }}
                    />
                  ) : null}
                  {f.label}
                </button>
              )
            })}
          </div>

          {nearest ? (
            <button
              type="button"
              onClick={() => openSheet(nearest.spot)}
              className="flex w-full items-center justify-between rounded-[1.35rem] bg-gradient-to-r from-moss to-sea px-4 py-2.5 text-left text-white shadow-lg shadow-moss/25 transition hover:brightness-105"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Navigation className="h-4 w-4 shrink-0 opacity-90" />
                <span className="truncate text-sm font-semibold">
                  {nearest.spot.name} · {nearest.dist}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold opacity-90">Ava →</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Floating actions */}
      <div className="absolute right-3 bottom-[max(5.5rem,env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 sm:right-4">
        <button
          type="button"
          onClick={() => setTimerOpen((o) => !o)}
          className={`relative flex h-12 w-12 items-center justify-center rounded-2xl ${panel} ${text} transition hover:scale-105`}
          title={activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
        >
          <Clock3 className={`h-5 w-5 ${activeSession ? 'text-moss' : 'text-sea'}`} />
          {activeSession ? (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-moss ring-2 ring-white" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss text-white shadow-lg shadow-moss/30 transition hover:scale-105 hover:bg-moss-deep"
          title="Lisa koht"
        >
          <Plus className="h-5 w-5" />
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
              {formatSessionInstant(activeSession.startedAt)
                ? ` · alates ${formatSessionInstant(activeSession.startedAt)}`
                : ''}
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
            {[15, 30, 60, 120].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => addMinutes(m)}
                className={`flex-1 rounded-lg py-1 text-[10px] font-semibold ${chip}`}
              >
                +{m < 60 ? `${m}m` : `${m / 60}t`}
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
            ) : selected ? (
              <button
                type="button"
                disabled={sessionLoading || carNumber.trim().length < 2}
                onClick={() => void beginParkingSession()}
                className="flex-1 rounded-xl bg-moss py-2 text-xs font-bold text-white disabled:opacity-55"
              >
                {sessionAction === 'start' ? 'Alustan…' : 'Alusta'}
              </button>
            ) : (
              <button
                type="button"
                onClick={startOrPause}
                className={`flex-1 rounded-xl py-2 text-xs font-bold text-white ${
                  timerRunning ? 'bg-clay' : 'bg-moss'
                }`}
              >
                {timerRunning ? 'Paus' : 'Käivita'}
              </button>
            )}
            <button
              type="button"
              disabled={sessionLoading || !(carNumber.trim() || activeSession?.carNumber)}
              onClick={() => void refreshParkingStatus()}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${chip} disabled:opacity-55`}
              title="Kontrolli staatust"
            >
              {sessionAction === 'status' ? '…' : 'Staatus'}
            </button>
            <button
              type="button"
              onClick={resetTimer}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${chip}`}
            >
              Nulli
            </button>
          </div>
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
          onClose={closeSheet}
          onStartSession={() => void beginParkingSession()}
          onStopSession={() => void endParkingSession()}
          onCheckStatus={() => void refreshParkingStatus()}
          onTimer={autoTimerFromSpot}
        />
      ) : null}

      <Toast toast={toast} onClose={dismissToast} />

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
