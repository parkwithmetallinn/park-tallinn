import { RefreshCw } from 'lucide-react'
import type { ParkingSessionDetails } from '../lib/parkingSession'
import {
  formatHourlyRate,
  formatSessionInstant,
  sessionHourlyRate,
  sessionStartIso,
} from '../lib/parkingSession'
import { ModalShell } from './ModalShell'
import { SessionsListSkeleton } from './ui/Skeleton'
import { Pressable } from './ui/Pressable'

export function ActiveSessionsModal({
  sessions,
  count,
  message,
  loading,
  onClose,
  onRefresh,
  onSelect,
  onPrefetch,
}: {
  sessions: ParkingSessionDetails[]
  count?: number
  message?: string
  loading?: boolean
  onClose: () => void
  onRefresh: () => void
  /** Adopt a listed session as the local active session. */
  onSelect?: (session: ParkingSessionDetails) => void
  /** Prefetch / warm cache on hover or touch-start. */
  onPrefetch?: () => void
}) {
  const total = count ?? sessions.length
  const showSkeleton = loading && sessions.length === 0

  return (
    <ModalShell title="Aktiivsed sessioonid" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-soft">
          {showSkeleton ? 'Laadin…' : `${total} aktiivset`}
          {message && !showSkeleton ? ` · ${message}` : ''}
        </p>
        <Pressable
          disabled={loading}
          onClick={onRefresh}
          onMouseEnter={onPrefetch}
          onTouchStart={onPrefetch}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sea/10 px-3 py-1.5 text-[12px] font-semibold text-sea"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Värskenda
        </Pressable>
      </div>

      {showSkeleton ? (
        <SessionsListSkeleton count={3} />
      ) : sessions.length === 0 ? (
        <p className="rounded-2xl bg-paper-2 px-4 py-6 text-center text-[14px] text-ink-soft">
          Aktiivseid parkimissessioone pole
        </p>
      ) : (
        <ul
          className={`space-y-2 transition-opacity duration-300 ${loading ? 'opacity-70' : 'opacity-100'}`}
        >
          {sessions.map((s, i) => {
            const plate = s.carNumber ?? '—'
            const zone = s.zone ?? '—'
            const rate = formatHourlyRate(sessionHourlyRate(s))
            const started = formatSessionInstant(sessionStartIso(s))
            const key = s.sessionId ?? `${plate}-${zone}-${i}`
            return (
              <li key={key}>
                <Pressable
                  disabled={!onSelect || !s.carNumber || !s.zone}
                  onClick={() => onSelect?.(s)}
                  className="w-full rounded-2xl border border-ink/8 bg-white px-3.5 py-3 text-left hover:border-sea/30 hover:bg-sea/5 disabled:cursor-default"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[15px] font-bold tracking-wide text-ink">
                        {plate}
                      </p>
                      <p className="mt-0.5 text-[12px] font-semibold text-ink-soft">
                        {zone}
                        {s.status ? ` · ${s.status}` : ''}
                        {rate ? ` · ${rate}` : ''}
                      </p>
                      {started ? (
                        <p className="mt-1 text-[11px] text-ink-soft/80">alates {started}</p>
                      ) : null}
                    </div>
                    {s.status ? (
                      <span className="rounded-lg bg-moss/10 px-2 py-1 text-[10px] font-bold text-moss uppercase">
                        {s.status}
                      </span>
                    ) : null}
                  </div>
                </Pressable>
              </li>
            )
          })}
        </ul>
      )}
    </ModalShell>
  )
}
