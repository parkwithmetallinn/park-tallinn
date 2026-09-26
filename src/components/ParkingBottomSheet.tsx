import { MapPin, Navigation, RefreshCw, Square, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ActiveParkingSession } from '../lib/parkingSession'
import { formatSessionInstant } from '../lib/parkingSession'
import type { ParkingSpot } from '../types'
import { navLinks, openAppleMaps } from '../lib/geocode'
import { PARKING_LAYER_META } from '../map/parkingLayers'
import { streetLineColor } from '../map/streetLineTheme'
import { useSheetClose } from './AnimatedBottomSheet'

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
  onTimer,
}: {
  spot: ParkingSpot
  distanceLabel?: string | null
  carNumber: string
  onCarNumberChange: (value: string) => void
  sessionLoading?: boolean
  sessionAction?: 'start' | 'stop' | 'status' | null
  activeSession?: ActiveParkingSession | null
  sessionNotice?: { kind: 'success' | 'error' | 'info' | 'loading'; text: string } | null
  onClose: () => void
  onStartSession: () => void
  onStopSession: () => void
  onCheckStatus: () => void
  onTimer?: () => void
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
            <p className="mt-1 flex items-center gap-1 truncate text-[13px] text-[#8E8E93]">
              <MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {spot.address}
            </p>
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

        {/* Session controls */}
        <div className="space-y-2.5 border-t border-black/5 px-5 pt-3 pb-4">
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
            className="w-full rounded-2xl border-0 bg-[#F2F2F7] px-4 py-3.5 font-mono text-[15px] font-semibold tracking-wider text-[#1C1C1E] outline-none ring-[#007AFF]/30 focus:ring-2 disabled:opacity-60"
          />
          {touched && !carOk ? (
            <p className="text-[12px] font-medium text-[#FF3B30]">Sisesta kehtiv auto number</p>
          ) : (
            <p className="text-[12px] text-[#8E8E93]">
              Tsoon <span className="font-semibold text-[#1C1C1E]">{spot.zone_code}</span>
              {hasActive && startedLabel ? ` · alates ${startedLabel}` : ''}
            </p>
          )}

          {hasActive ? (
            <button
              type="button"
              disabled={sessionLoading}
              onClick={onStopSession}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF3B30] px-4 py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-55"
            >
              <Square className="h-4 w-4 fill-current" />
              {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
            </button>
          ) : (
            <button
              type="button"
              disabled={sessionLoading || !carOk}
              onClick={() => {
                setTouched(true)
                if (!carOk) return
                onStartSession()
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-55"
            >
              {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
            </button>
          )}

          <button
            type="button"
            disabled={sessionLoading || !carOk}
            onClick={() => {
              setTouched(true)
              if (!carOk) return
              onCheckStatus()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#007AFF]/10 px-4 py-3 text-[14px] font-semibold text-[#007AFF] transition active:scale-[0.99] disabled:opacity-55"
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

          {spot.layer === 'timed' || spot.free_minutes > 0 ? (
            <button
              type="button"
              onClick={onTimer}
              className="w-full py-2 text-[13px] font-semibold text-[#007AFF]"
            >
              Sea ainult kohalik taimer
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
