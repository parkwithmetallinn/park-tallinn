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
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import { PARKING_SPOTS, PAID_ZONES, TALLINN_CENTER } from './data/parking'
import { distanceMeters, formatDistance } from './lib/geo'
import { formatHMS, minutesFromBadge, TYPE_COLORS, TYPE_LABELS } from './lib/parking'
import { loadCustomSpots, saveCustomSpot } from './lib/storage'
import type { FilterId, ParkingSpot } from './types'
import { MapLayers } from './components/MapLayers'
import { ModalShell } from './components/ModalShell'

function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.1 })
  }, [center, zoom, map])
  return null
}

const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'free', label: '100% tasuta', color: TYPE_COLORS.free },
  { id: 'street', label: 'Tänavaäärsed', color: '#3d5248' },
  { id: 'timed', label: 'Kellaga', color: TYPE_COLORS.timed },
  { id: 'lot', label: 'Avalikud parklad', color: '#0b6e4f' },
  { id: 'pr', label: 'Pargi & Reisi', color: TYPE_COLORS.pr },
]

export default function App() {
  const [dark, setDark] = useState(false)
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [userLocation, setUserLocation] = useState<[number, number]>(TALLINN_CENTER)
  const [hasGps, setHasGps] = useState(false)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)
  const [flyKey, setFlyKey] = useState(0)
  const [customSpots, setCustomSpots] = useState<ParkingSpot[]>([])
  const [selected, setSelected] = useState<ParkingSpot | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerLabel, setTimerLabel] = useState('Määra aeg või vali kellaga koht')

  useEffect(() => {
    setCustomSpots(loadCustomSpots())
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
          try {
            const ctx = new AudioContext()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = 880
            gain.gain.value = 0.35
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start()
            osc.stop(ctx.currentTime + 1)
          } catch {
            /* ignore */
          }
          setTimerLabel('Aeg läbi! Liiguta autot või pikenda')
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [timerRunning, timerSeconds])

  const allSpots = useMemo(
    () => [...PARKING_SPOTS, ...customSpots],
    [customSpots],
  )

  const filteredSpots = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allSpots.filter((spot) => {
      if (filter === 'street' && spot.kind !== 'street') return false
      if (filter === 'lot' && spot.kind !== 'lot') return false
      if (filter !== 'all' && filter !== 'street' && filter !== 'lot' && spot.type !== filter) {
        return false
      }
      if (!q) return true
      return (
        spot.name.toLowerCase().includes(q) ||
        spot.address.toLowerCase().includes(q) ||
        spot.desc.toLowerCase().includes(q) ||
        spot.badge.toLowerCase().includes(q)
      )
    })
  }, [allSpots, filter, query])

  const nearest = useMemo(() => {
    const candidates = allSpots.filter((s) => s.type !== 'paid')
    let best: ParkingSpot | null = null
    let bestDist = Infinity
    for (const spot of candidates) {
      const d = distanceMeters(userLocation[0], userLocation[1], spot.lat, spot.lng)
      if (d < bestDist) {
        bestDist = d
        best = spot
      }
    }
    return best
      ? { spot: best, dist: formatDistance(bestDist) }
      : null
  }, [allSpots, userLocation])

  const openNav = useCallback((spot: ParkingSpot) => {
    setSelected(spot)
    setNavOpen(true)
  }, [])

  const recenter = () => {
    setFlyTarget([...userLocation] as [number, number])
    setFlyKey((k) => k + 1)
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
    const mins = minutesFromBadge(selected.badge)
    setTimerSeconds(mins * 60)
    setTimerLabel(`Määratud: ${selected.name}`)
    setTimerRunning(true)
    setNavOpen(false)
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

    const spot: ParkingSpot = {
      id: `custom-${Date.now()}`,
      name,
      type,
      kind,
      badge: type === 'free' ? (kind === 'street' ? 'TÄNAV' : 'TASUTA') : type === 'pr' ? 'P&R' : 'KELLAGA',
      timeLimit: limit,
      lat: userLocation[0] + (Math.random() - 0.5) * 0.006,
      lng: userLocation[1] + (Math.random() - 0.5) * 0.006,
      address,
      desc: notes || 'Kasutaja lisatud koht',
      custom: true,
    }
    saveCustomSpot(spot)
    setCustomSpots(loadCustomSpots())
    setReportOpen(false)
    e.currentTarget.reset()
  }

  const tileUrl = dark
    ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const tileClassName = dark ? 'map-tiles-dark' : undefined

  const wazeUrl = selected
    ? `https://waze.com/ul?ll=${selected.lat},${selected.lng}&navigate=yes`
    : '#'
  const gmapsUrl = selected
    ? `https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`
    : '#'

  useEffect(() => {
    document.documentElement.classList.toggle('map-dark', dark)
  }, [dark])

  const chrome = dark
    ? {
        shell: 'bg-[#0f1714] text-[#e8f0eb]',
        bar: 'border-white/10 bg-[#15201b]/90',
        muted: 'text-[#9bb0a4]',
        chip: 'bg-white/10 text-[#c9d9d0] hover:bg-white/15',
        chipActive: 'bg-[#e8f0eb] text-[#0f1714]',
        input:
          'border-white/10 bg-white/8 text-[#e8f0eb] placeholder:text-[#9bb0a4]/70 focus:border-moss/50 focus:ring-moss/25',
        timerBox: 'bg-white/10 text-[#e8f0eb]',
      }
    : {
        shell: 'bg-transparent text-ink',
        bar: 'border-ink/8 bg-paper/85',
        muted: 'text-ink-soft',
        chip: 'bg-paper-2 text-ink-soft hover:bg-mist',
        chipActive: 'bg-ink text-paper',
        input:
          'border-ink/10 bg-paper-2 text-ink placeholder:text-ink-soft/50 focus:border-moss/40 focus:ring-moss/20',
        timerBox: 'bg-paper-2 text-ink',
      }

  return (
    <div className={`flex h-full flex-col ${chrome.shell}`}>
      <header
        className={`relative z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur-md ${chrome.bar}`}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-moss text-white shadow-md shadow-moss/25">
            <MapPin className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <div>
            <h1 className="font-display text-2xl leading-none tracking-tight">
              Park Tallinn
            </h1>
            <p className={`mt-0.5 text-xs font-medium ${chrome.muted}`}>
              Tasuta · tänavad · P&R
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className={`rounded-xl p-2.5 transition ${chrome.chip}`}
            title="Parkimisreeglid"
          >
            <CircleHelp className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            className={`rounded-xl p-2.5 transition ${chrome.chip}`}
            title="Hele / tume"
          >
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={recenter}
            className="flex items-center gap-1.5 rounded-xl bg-sea px-3 py-2.5 text-white shadow-md shadow-sea/30 transition hover:brightness-110"
            title="Minu asukoht"
          >
            <LocateFixed className="h-5 w-5" />
            <span className="hidden text-xs font-semibold sm:inline">
              {hasGps ? 'Minu asukoht' : 'Keskus'}
            </span>
          </button>
        </div>
      </header>

      <button
        type="button"
        onClick={() => nearest && openNav(nearest.spot)}
        className="relative z-20 flex w-full items-center justify-between bg-gradient-to-r from-moss via-moss to-sea px-4 py-2.5 text-left text-white transition hover:brightness-105"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Navigation className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/80">
              Lähim soodne koht
            </span>
            <span className="block truncate text-sm font-bold">
              {nearest
                ? `${nearest.spot.name} · ${nearest.dist}`
                : 'Arvutan…'}
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm">
          Ava navi →
        </span>
      </button>

      <div className={`relative z-20 space-y-2 border-b px-4 py-2.5 backdrop-blur-md ${chrome.bar}`}>
        <div className="relative">
          <Search className={`pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 ${chrome.muted} opacity-70`} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Otsi nime, tänavat või tsooni…"
            className={`w-full rounded-xl border py-2.5 pr-9 pl-10 text-sm outline-none transition focus:ring-2 ${chrome.input}`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className={`absolute top-1/2 right-3 -translate-y-1/2 ${chrome.muted}`}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5">
          {FILTERS.map((f) => {
            const active = filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                  active ? chrome.chipActive : chrome.chip
                }`}
              >
                {f.color && !active ? (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: f.color }}
                  />
                ) : null}
                {f.label}
              </button>
            )
          })}
        </div>
        <p className={`text-[11px] ${chrome.muted}`}>
          Kaardil <strong>{filteredSpots.length}</strong> kohta
          {filter !== 'all' ? ` · filter: ${FILTERS.find((f) => f.id === filter)?.label}` : ''}
        </p>
      </div>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <MapContainer
          center={TALLINN_CENTER}
          zoom={12}
          className="h-full w-full"
          zoomControl={false}
          attributionControl={true}
        >
          <TileLayer
            key={`${tileUrl}-${dark ? 'dark' : 'light'}`}
            url={tileUrl}
            maxZoom={19}
            className={tileClassName}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <MapLayers
            spots={filteredSpots}
            zones={PAID_ZONES}
            userLocation={userLocation}
            dark={dark}
            onNavigate={openNav}
            distanceFrom={userLocation}
          />
          {flyTarget ? <FlyTo key={flyKey} center={flyTarget} zoom={15} /> : null}
        </MapContainer>

        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="absolute right-4 bottom-4 z-[400] flex items-center gap-2 rounded-2xl bg-moss px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-moss/35 transition hover:bg-moss-deep active:scale-[0.98] sm:bottom-6"
        >
          <Plus className="h-4 w-4" />
          Lisa koht
        </button>
      </main>

      <footer className={`relative z-30 border-t px-4 py-3 backdrop-blur-md ${chrome.bar}`}>
        <div className="mx-auto max-w-xl space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sea/15 text-sea">
                <Clock3 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold leading-none">Parkimiskella taimer</h3>
                <p className={`mt-0.5 truncate text-xs ${chrome.muted}`}>{timerLabel}</p>
              </div>
            </div>
            <div
              className={`rounded-xl px-3 py-1 font-mono text-2xl font-extrabold tracking-wider sm:text-3xl ${chrome.timerBox} ${
                timerSeconds > 0 && timerSeconds < 60 && !timerRunning ? '!text-clay' : ''
              }`}
            >
              {formatHMS(timerSeconds)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              {[15, 30, 60, 120, 180].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => addMinutes(m)}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${chrome.chip}`}
                >
                  +{m < 60 ? `${m}m` : `${m / 60}t`}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={startOrPause}
                className={`rounded-xl px-4 py-1.5 text-xs font-bold text-white shadow-md transition ${
                  timerRunning ? 'bg-clay' : 'bg-moss hover:bg-moss-deep'
                }`}
              >
                {timerRunning ? 'Paus' : 'Käivita'}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${chrome.chip}`}
              >
                Nulli
              </button>
            </div>
          </div>
        </div>
      </footer>

      {navOpen && selected ? (
        <ModalShell onClose={() => setNavOpen(false)} title={selected.name}>
          <p className="text-xs text-ink-soft">
            {selected.address} · {selected.timeLimit}
          </p>
          <div className="mt-4 space-y-2.5">
            <a
              href={wazeUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-2xl bg-sea px-4 py-3.5 font-bold text-white shadow-md transition hover:brightness-110"
            >
              Ava Waze’is
              <Navigation className="h-4 w-4 opacity-80" />
            </a>
            <a
              href={gmapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-2xl bg-moss px-4 py-3.5 font-bold text-white shadow-md transition hover:bg-moss-deep"
            >
              Ava Google Mapsis
              <MapPin className="h-4 w-4 opacity-80" />
            </a>
          </div>
          {selected.type === 'timed' ? (
            <button
              type="button"
              onClick={autoTimerFromSpot}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-sea/10 py-2.5 text-xs font-semibold text-sea transition hover:bg-sea/15"
            >
              <Clock3 className="h-4 w-4" />
              Sea taimer ({selected.badge})
            </button>
          ) : null}
        </ModalShell>
      ) : null}

      {infoOpen ? (
        <ModalShell onClose={() => setInfoOpen(false)} title="Tallinna parkimisreeglid">
          <div className="max-h-[60vh] space-y-3 overflow-y-auto text-xs leading-relaxed text-ink-soft">
            <div className="rounded-2xl border border-sea/20 bg-sea/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-sea">Esimesed 15 minutit tasuta</h4>
              <p>
                Avalikel tasulistel linnatänavatel kehtib esimesed 15 minutit tasuta parkimine.
                Pane esiklaasile loetav parkimiskell või kirjalik algusaeg.
              </p>
            </div>
            <div className="rounded-2xl bg-paper-2 p-3">
              <h4 className="mb-1 text-sm font-bold text-ink">Kesklinna tasuta kellaajad</h4>
              <p>• Tööpäeviti tasuline 07:00–19:00 (öösel tasuta)</p>
              <p>• Laupäeval tasuline 08:00–15:00 (pärast 15:00 tasuta)</p>
              <p>• Pühapäeval ja riigipühadel ööpäevaringselt tasuta</p>
            </div>
            <div className="rounded-2xl border border-moss/20 bg-moss/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-moss">Avalikud & tänavaäärsed</h4>
              <p>
                Väljaspool tasulisi tsoone on tänavaparkimine üldjuhul tasuta (Mustamäe, Lasnamäe,
                Nõmme, Põhja-Tallinn, Õismäe jt). Kaardil on esile toodud mugavad lõigud ja avalikud
                platsid.
              </p>
            </div>
            <div className="rounded-2xl border border-navy/20 bg-navy/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-navy">Pargi ja Reisi</h4>
              <p>
                P&R parklates on parkimine tasuta, kui registreerid Ühiskaardiga või valideerid
                ühistranspordisõidu.
              </p>
            </div>
            <div className="rounded-2xl border border-clay/20 bg-clay/8 p-3">
              <h4 className="mb-1 text-sm font-bold text-clay">Eraparklad</h4>
              <p>
                EuroPark, Snabb, Ühisteenused jt — kontrolli alati kohapealseid märke enne
                sõidukist eemaldumist. Andmed on orienteeruvad.
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
                  {(Object.keys(TYPE_LABELS) as ParkingSpot['type'][])
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
    </div>
  )
}
