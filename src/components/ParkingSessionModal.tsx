import { X } from 'lucide-react'
import type { FormEvent } from 'react'
import type { ActiveParkingSession } from '../lib/parkingSession'
import { formatHMS } from '../lib/parking'
import {
  canStartParkingSession,
  sessionStartDisabledHint,
} from '../data/zones'
import type { ParkingSpot } from '../types'

const TIME_EXTEND_OPTIONS = [
  { minutes: 15, label: '+15m' },
  { minutes: 30, label: '+30m' },
  { minutes: 60, label: '+1h' },
  { minutes: 120, label: '+2h' },
] as const

/**
 * Isolated floating parking-session modal (clock FAB).
 * Never mounts inside the left detail sidebar — exclusive of ParkingBottomSheet.
 */
export function ParkingSessionModal({
  dark,
  carNumber,
  onCarNumberChange,
  timerSeconds,
  timerMode,
  timerLabel,
  sessionLoading,
  sessionAction,
  activeSession,
  sessionNotice,
  selectedSpot,
  onClose,
  onStart,
  onStop,
  onStatus,
  onExtend,
  onShowAll,
  formatHourlyRate,
  formatSessionInstant,
}: {
  dark?: boolean
  carNumber: string
  onCarNumberChange: (v: string) => void
  timerSeconds: number
  timerMode: 'elapsed' | 'remaining' | string
  timerLabel: string
  sessionLoading: boolean
  sessionAction: 'start' | 'stop' | 'status' | 'extend' | null
  activeSession: ActiveParkingSession | null
  sessionNotice: { kind: 'success' | 'error' | 'info' | 'loading'; text: string } | null
  /** Optional context spot when starting without an open detail card */
  selectedSpot: ParkingSpot | null
  onClose: () => void
  onStart: () => void
  onStop: () => void
  onStatus: () => void
  onExtend: (minutes: number) => void
  onShowAll: () => void
  formatHourlyRate: (rate?: number) => string | undefined
  formatSessionInstant: (iso?: string) => string | undefined
}) {
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const chip = dark
    ? 'bg-white/10 text-[#F5F5F7]'
    : 'bg-[#F2F2F7] text-[#1C1C1E]'
  const field = dark
    ? 'border-white/10 bg-white/5 text-white'
    : 'border-ink/10 bg-white/90 text-ink'
  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/88 text-[#F5F5F7]'
    : 'border-white/60 bg-white/90 text-[#1C1C1E]'

  const canStart =
    Boolean(selectedSpot) &&
    carNumber.trim().length >= 2 &&
    selectedSpot != null &&
    canStartParkingSession(selectedSpot)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onStatus()
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[90] flex items-end justify-center bg-black/35 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
      data-testid="parking-session-modal"
    >
      <div
        className={`animate-slide-up max-h-[min(80vh,32rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border p-4 shadow-2xl backdrop-blur-xl sm:p-5 ${panel}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[15px] font-bold ${ink}`}>
              {activeSession ? 'Aktiivne sessioon' : 'Parkimiskell'}
            </p>
            <p className={`truncate text-[11px] ${muted}`}>{timerLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`font-mono text-xl font-extrabold tabular-nums ${ink}`}
            >
              {formatHMS(timerSeconds)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className={`tap-scale flex h-10 w-10 items-center justify-center rounded-full ${chip}`}
              aria-label="Sulge"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {activeSession ? (
          <div className="mb-3 rounded-2xl bg-[#34C759]/12 p-3.5 text-[12px] font-semibold leading-snug text-[#248A3D]">
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

        <form className="flex flex-col gap-2.5" onSubmit={onSubmit}>
          <div>
            <label className={`mb-1 block text-[10px] font-semibold ${muted}`}>
              Auto number
            </label>
            <input
              value={carNumber}
              onChange={(e) => onCarNumberChange(e.target.value.toUpperCase())}
              placeholder="nt 123ABC"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              disabled={sessionLoading}
              enterKeyHint="done"
              className={`w-full rounded-xl border px-3 py-2.5 font-mono text-[13px] font-semibold tracking-wider outline-none focus:ring-2 focus:ring-[#34C759]/30 ${field}`}
            />
          </div>

          {activeSession ? (
            <div className="grid grid-cols-4 gap-1.5">
              {TIME_EXTEND_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  disabled={sessionLoading}
                  onClick={(e) => {
                    e.preventDefault()
                    onExtend(opt.minutes)
                  }}
                  className={`rounded-xl py-2.5 text-[11px] font-bold ${chip} disabled:opacity-55`}
                >
                  {sessionAction === 'extend' ? '…' : opt.label}
                </button>
              ))}
            </div>
          ) : null}

          {activeSession ? (
            <button
              type="button"
              disabled={sessionLoading}
              onClick={(e) => {
                e.preventDefault()
                onStop()
              }}
              className="w-full rounded-2xl bg-[#FF3B30] py-3 text-[14px] font-bold text-white disabled:opacity-55"
            >
              {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
            </button>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              <button
                type="button"
                disabled={sessionLoading || !canStart}
                onClick={(e) => {
                  e.preventDefault()
                  onStart()
                }}
                className="w-full rounded-2xl bg-[#34C759] py-3 text-[14px] font-bold text-white disabled:opacity-55"
              >
                {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
              </button>
              {!selectedSpot ? (
                <p className={`text-[11px] font-medium leading-snug ${muted}`}>
                  Vali kaardilt parkla, et alustada sessiooni.
                </p>
              ) : selectedSpot && !canStartParkingSession(selectedSpot) ? (
                <p className={`text-[11px] font-medium leading-snug ${muted}`}>
                  {sessionStartDisabledHint(selectedSpot)}
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
                onStatus()
              }}
              className={`flex-1 rounded-xl px-3 py-2.5 text-[12px] font-bold ${chip} disabled:opacity-55`}
            >
              {sessionAction === 'status' ? '…' : 'Staatus'}
            </button>
            <button
              type="button"
              disabled={sessionLoading}
              onClick={(e) => {
                e.preventDefault()
                onShowAll()
              }}
              className={`flex-1 rounded-xl px-3 py-2.5 text-[12px] font-bold ${chip} disabled:opacity-55`}
            >
              Kõik
            </button>
          </div>
        </form>

        {sessionNotice ? (
          <p
            data-testid="session-notice"
            className={`mt-3 rounded-2xl p-3 text-[12px] font-medium leading-snug ${
              sessionNotice.kind === 'success'
                ? 'bg-[#34C759]/12 text-[#248A3D]'
                : sessionNotice.kind === 'error'
                  ? 'bg-[#FF3B30]/10 text-[#D70015]'
                  : sessionNotice.kind === 'loading'
                    ? dark
                      ? 'bg-white/10 text-[#EBEBF5]'
                      : 'bg-[#F2F2F7] text-[#636366]'
                    : dark
                      ? 'bg-[#0A84FF]/15 text-[#64D2FF]'
                      : 'bg-[#007AFF]/10 text-[#007AFF]'
            }`}
          >
            {sessionNotice.text}
          </p>
        ) : null}
      </div>
    </div>
  )
}
