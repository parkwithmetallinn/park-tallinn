import { Flag, MapPin, Navigation, RefreshCw, Square, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react'
import type { ActiveParkingSession } from '../lib/parkingSession'
import { formatHourlyRate, formatSessionInstant } from '../lib/parkingSession'
import { getCachedAddress } from '../lib/addressCache'
import { isRealAddress } from '../lib/isRealAddress'
import {
  MISSING_ADDRESS,
  resolveSpotAddress,
} from '../lib/resolveSpotAddress'
import type { ParkingSpot } from '../types'
import { navLinks, openAppleMaps } from '../lib/geocode'
import { PARKING_LAYER_META } from '../map/parkingLayers'
import { streetLineColor } from '../map/streetLineTheme'
import { useSheetClose } from './AnimatedBottomSheet'

function blockNav(e: MouseEvent | FormEvent) {
  e.preventDefault()
  e.stopPropagation()
}

function priceSummary(spot: ParkingSpot): { headline: string; detail: string } {
  const free = spot.free_minutes > 0 ? `${spot.free_minutes} min tasuta` : null
  if (spot.price_per_hour <= 0 && !free) {
    return { headline: 'Tasuta', detail: spot.timeLimit || 'Piiramatu' }
  }
  if (free && spot.price_per_hour > 0) {
    return {
      headline: free,
      detail: `edasi ${spot.price_per_hour.toFixed(2)} €/h`,
    }
  }
  if (free) {
    return { headline: free, detail: spot.timeLimit || 'Kellaga' }
  }
  return {
    headline: `${spot.price_per_hour.toFixed(2)} €/h`,
    detail: spot.timeLimit || spot.operator,
  }
}

export function ParkingBottomSheet({
  spot,
  distanceLabel,
  carNumber,
  onCarNumberChange,
  sessionLoading,
  sessionAction,
  activeSession,
  sessionNotice,
  onClose,
  onStartSession,
  onStopSession,
  onCheckStatus,
  onExtendMinutes,
  onReportInvalid,
}: {
  spot: ParkingSpot
  distanceLabel?: string | null
  carNumber: string
  onCarNumberChange: (value: string) => void
  sessionLoading?: boolean
  sessionAction?: 'start' | 'stop' | 'status' | 'extend' | null
  activeSession?: ActiveParkingSession | null
  sessionNotice?: { kind: 'success' | 'error' | 'info' | 'loading'; text: string } | null
  onClose: () => void
  onStartSession: () => void
  onStopSession: () => void
  onCheckStatus: () => void
  onExtendMinutes?: (minutes: number) => void
  /** Crowdsource: queue REPORT_INVALID (does not mutate GeoJSON). */
  onReportInvalid?: () => void
}) {
  const stableClose = useCallback(() => onClose(), [onClose])
  const { requestClose, sheetClassName } = useSheetClose(stableClose)
  const links = navLinks(spot.lat, spot.lng)
  const color =
    spot.line || spot.featureType === 'on-street-line'
      ? streetLineColor(spot)
      : (PARKING_LAYER_META[spot.layer]?.color ?? '#30D158')
  const pricing = priceSummary(spot)
  const [touched, setTouched] = useState(false)
  const carOk = carNumber.trim().length >= 2
  const hasActive = Boolean(activeSession?.carNumber && activeSession?.zone)
  const startedLabel = formatSessionInstant(activeSession?.startedAt)
  const title = `${spot.zone_code} — ${spot.name}`
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(() => {
    const cached = getCachedAddress(spot.id)
    if (cached?.address) return cached.address
    if (isRealAddress(spot.address, { name: spot.name, code: spot.zone_code })) {
      return spot.address.trim()
    }
    return null
  })
  const [addressLoading, setAddressLoading] = useState(
    () => !getCachedAddress(spot.id) && !isRealAddress(spot.address, {
      name: spot.name,
      code: spot.zone_code,
    }),
  )
  const [copiedHint, setCopiedHint] = useState(false)
  const longPressTimer = useRef<number | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    const cached = getCachedAddress(spot.id)
    if (cached?.address) {
      setResolvedAddress(cached.address)
      setAddressLoading(false)
      return () => ac.abort()
    }
    if (isRealAddress(spot.address, { name: spot.name, code: spot.zone_code })) {
      setResolvedAddress(spot.address.trim())
      setAddressLoading(false)
    } else {
      setResolvedAddress(null)
      setAddressLoading(true)
    }
    setCopiedHint(false)

    void resolveSpotAddress(spot, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setResolvedAddress(r.address)
        setAddressLoading(false)
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError' || ac.signal.aborted) return
        setResolvedAddress(MISSING_ADDRESS)
        setAddressLoading(false)
      })

    return () => {
      ac.abort()
      if (longPressTimer.current) {
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }, [spot])

  const copyAddress = useCallback(async () => {
    const text = resolvedAddress?.trim()
    if (!text || text === MISSING_ADDRESS) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedHint(true)
      window.setTimeout(() => setCopiedHint(false), 1600)
    } catch {
      /* ignore clipboard failures */
    }
  }, [resolvedAddress])

  return (
    <div
      className={`${sheetClassName} absolute inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="mx-auto max-w-lg overflow-hidden rounded-[1.75rem] border border-black/5 bg-white/92 shadow-[0_16px_48px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        {/* iOS grabber */}
        <div className="flex justify-center pt-2.5 pb-1">
          <button
            type="button"
            onClick={requestClose}
            className="flex w-full justify-center py-1"
            aria-label="Sulge"
          >
            <span className="h-1 w-9 rounded-full bg-black/15" />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pt-1 pb-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-white"
                style={{ backgroundColor: color }}
              >
                {spot.zone_code}
              </span>
              {distanceLabel ? (
                <span className="rounded-full bg-[#007AFF]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#007AFF]">
                  {distanceLabel}
                </span>
              ) : null}
              {hasActive ? (
                <span className="rounded-full bg-[#34C759]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#248A3D]">
                  Aktiivne
                </span>
              ) : null}
            </div>
            <h3 className="text-[22px] leading-tight font-bold tracking-tight text-[#1C1C1E]">
              {spot.name}
            </h3>
            <button
              type="button"
              data-testid="spot-address"
              title={
                resolvedAddress && resolvedAddress !== MISSING_ADDRESS
                  ? 'Kopeeri aadress'
                  : undefined
              }
              disabled={addressLoading || !resolvedAddress || resolvedAddress === MISSING_ADDRESS}
              onClick={() => void copyAddress()}
              onContextMenu={(e) => {
                e.preventDefault()
                void copyAddress()
              }}
              onPointerDown={() => {
                if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
                longPressTimer.current = window.setTimeout(() => {
                  void copyAddress()
                }, 480)
              }}
              onPointerUp={() => {
                if (longPressTimer.current) {
                  window.clearTimeout(longPressTimer.current)
                  longPressTimer.current = null
                }
              }}
              onPointerLeave={() => {
                if (longPressTimer.current) {
                  window.clearTimeout(longPressTimer.current)
                  longPressTimer.current = null
                }
              }}
              className="mt-1 flex w-full min-w-0 items-center gap-1 truncate text-left text-[13px] text-[#8E8E93] disabled:cursor-default"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {addressLoading ? (
                <span
                  data-testid="spot-address-skeleton"
                  className="inline-block h-[14px] w-[min(100%,14rem)] max-w-full animate-pulse rounded bg-[#E5E5EA]"
                  aria-label="Aadressi laadimine"
                />
              ) : (
                <span className="truncate">
                  {copiedHint ? 'Aadress kopeeritud' : resolvedAddress}
                </span>
              )}
            </button>
            {spot.featureType === 'on-street-line' || spot.kind === 'street' ? (
              <p className="mt-2 text-[12px] font-semibold text-[#636366]">
                Teeäärne tsoon · {spot.zone_code}
                {spot.free_minutes > 0 ? ` · +${spot.free_minutes} min` : ''}
                {spot.price_per_hour > 0
                  ? ` · ${spot.price_per_hour.toFixed(2)} €/h`
                  : spot.price_per_hour === 0 && spot.free_minutes === 0
                    ? ' · Tasuta'
                    : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F2F2F7] text-[#8E8E93] transition active:scale-95"
            aria-label="Sulge"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Price block — HIG clarity */}
        <div className="mx-5 mb-4 overflow-hidden rounded-2xl bg-[#F2F2F7]">
          <div className="flex items-stretch">
            <div className="flex-1 px-4 py-3.5">
              <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
                Hind
              </p>
              <p className="mt-0.5 text-[20px] font-bold tracking-tight text-[#1C1C1E]">
                {pricing.headline}
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-[#636366]">{pricing.detail}</p>
            </div>
            <div className="w-px bg-black/6" />
            <div className="flex w-[38%] flex-col justify-center px-4 py-3.5">
              <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
                Operaator
              </p>
              <p className="mt-0.5 text-[15px] font-semibold text-[#1C1C1E]">{spot.operator}</p>
            </div>
          </div>
          {spot.structureType || typeof spot.floors === 'number' ? (
            <div className="flex items-center justify-between gap-3 border-t border-black/6 px-4 py-2.5">
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
                  Tüüp
                </p>
                <p className="mt-0.5 text-[14px] font-semibold text-[#1C1C1E]">
                  {spot.structureType === 'underground'
                    ? 'Underground'
                    : spot.structureType === 'multi_storey'
                      ? 'Multi-storey'
                      : 'Surface'}
                  {spot.structureType === 'multi_storey' && spot.floors
                    ? ` · P+${spot.floors}`
                    : null}
                </p>
              </div>
              {spot.zone_code ? (
                <span
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {spot.zone_code}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Large navigation CTAs */}
        <div className="space-y-2 px-5 pb-3">
          <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
            Navigeeri
          </p>
          <div className="grid grid-cols-3 gap-2">
            <a
              href={links.waze}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#33CCFF] px-2 py-3.5 text-center shadow-sm transition active:scale-[0.98]"
            >
              <Navigation className="h-5 w-5 text-[#053B4A]" strokeWidth={2.5} />
              <span className="text-[12px] font-bold text-[#053B4A]">Waze</span>
            </a>
            <a
              href={links.google}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#4285F4] px-2 py-3.5 text-center shadow-sm transition active:scale-[0.98]"
            >
              <MapPin className="h-5 w-5 text-white" strokeWidth={2.5} />
              <span className="text-[12px] font-bold text-white">Google</span>
            </a>
            <button
              type="button"
              onClick={() => openAppleMaps(spot.lat, spot.lng)}
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#1C1C1E] px-2 py-3.5 text-center shadow-sm transition active:scale-[0.98]"
            >
              <MapPin className="h-5 w-5 text-white" strokeWidth={2.5} />
              <span className="text-[12px] font-bold text-white">Apple</span>
            </button>
          </div>
        </div>

        {/* Session controls — form wrapper blocks Enter/submit page reloads */}
        <form
          className="space-y-2.5 border-t border-black/5 px-5 pt-3 pb-4"
          onSubmit={(e) => {
            blockNav(e)
            // Enter in plate field → status check only (never navigate)
            setTouched(true)
            if (!carOk || sessionLoading) return
            onCheckStatus()
          }}
        >
          <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
            Parkimissessioon
          </p>
          <input
            value={carNumber}
            onChange={(e) => onCarNumberChange(e.target.value.toUpperCase())}
            onBlur={() => setTouched(true)}
            placeholder="Auto number (nt 123ABC)"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={sessionLoading}
            enterKeyHint="done"
            className="w-full rounded-2xl border-0 bg-[#F2F2F7] px-4 py-3.5 font-mono text-[15px] font-semibold tracking-wider text-[#1C1C1E] outline-none ring-[#007AFF]/30 focus:ring-2 disabled:opacity-60"
          />
          {touched && !carOk ? (
            <p className="text-[12px] font-medium text-[#FF3B30]">Sisesta kehtiv auto number</p>
          ) : (
            <p className="text-[12px] text-[#8E8E93]">
              Tsoon{' '}
              <span className="font-semibold text-[#1C1C1E]">
                {activeSession?.zone ?? spot.zone_code}
              </span>
              {hasActive && activeSession?.status
                ? ` · ${activeSession.status}`
                : ''}
              {hasActive && formatHourlyRate(activeSession?.hourlyRate)
                ? ` · ${formatHourlyRate(activeSession?.hourlyRate)}`
                : ''}
              {hasActive && startedLabel ? ` · alates ${startedLabel}` : ''}
            </p>
          )}

          {hasActive ? (
            <button
              type="button"
              disabled={sessionLoading}
              onClick={(e) => {
                blockNav(e)
                onStopSession()
              }}
              className="tap-scale flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF3B30] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-55"
            >
              <Square className="h-4 w-4 fill-current" />
              {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
            </button>
          ) : (
            <button
              type="button"
              disabled={sessionLoading || !carOk}
              onClick={(e) => {
                blockNav(e)
                setTouched(true)
                if (!carOk) return
                onStartSession()
              }}
              className="tap-scale flex w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-55"
            >
              {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
            </button>
          )}

          {hasActive && onExtendMinutes ? (
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { minutes: 15, label: '+15m' },
                  { minutes: 30, label: '+30m' },
                  { minutes: 60, label: '+1h' },
                  { minutes: 120, label: '+2h' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  disabled={sessionLoading}
                  onClick={(e) => {
                    blockNav(e)
                    onExtendMinutes(opt.minutes)
                  }}
                  className="tap-scale rounded-xl bg-[#FF9F0A]/12 px-1 py-2.5 text-[12px] font-bold text-[#C93400] disabled:opacity-55"
                >
                  {sessionAction === 'extend' ? '…' : opt.label}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            disabled={sessionLoading || !carOk}
            onClick={(e) => {
              blockNav(e)
              setTouched(true)
              if (!carOk) return
              onCheckStatus()
            }}
            className="tap-scale flex w-full items-center justify-center gap-2 rounded-2xl bg-[#007AFF]/10 px-4 py-3 text-[14px] font-semibold text-[#007AFF] disabled:opacity-55"
          >
            <RefreshCw className={`h-4 w-4 ${sessionAction === 'status' ? 'animate-spin' : ''}`} />
            {sessionAction === 'status' ? 'Kontrollin…' : 'Kontrolli staatust'}
          </button>

          {sessionNotice ? (
            <p
              data-testid="session-notice"
              className={`rounded-2xl px-3.5 py-2.5 text-[13px] font-medium leading-snug ${
                sessionNotice.kind === 'success'
                  ? 'bg-[#34C759]/12 text-[#248A3D]'
                  : sessionNotice.kind === 'error'
                    ? 'bg-[#FF3B30]/10 text-[#D70015]'
                    : sessionNotice.kind === 'loading'
                      ? 'bg-[#F2F2F7] text-[#636366]'
                      : 'bg-[#007AFF]/10 text-[#007AFF]'
              }`}
            >
              {sessionNotice.text}
            </p>
          ) : null}

          {onReportInvalid ? (
            <button
              type="button"
              onClick={(e) => {
                blockNav(e)
                onReportInvalid()
              }}
              className="tap-scale flex w-full items-center justify-center gap-2 rounded-2xl bg-[#F2F2F7] px-4 py-2.5 text-[12px] font-semibold text-[#636366]"
            >
              <Flag className="h-3.5 w-3.5 text-[#FF3B30]" />
              Märgi olematuks / Teavita veast
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
