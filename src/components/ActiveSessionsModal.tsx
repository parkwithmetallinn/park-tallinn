import { RefreshCw } from 'lucide-react'
import type { ParkingSessionDetails } from '../lib/parkingSession'
import {
  formatHourlyRate,
  formatSessionInstant,
  sessionHourlyRate,
  sessionStartIso,
} from '../lib/parkingSession'
import { ModalShell } from './ModalShell'

export function ActiveSessionsModal({
  sessions,
  count,
  message,
  loading,
  onClose,
  onRefresh,
  onSelect,
}: {
  sessions: ParkingSessionDetails[]
  count?: number
  message?: string
  loading?: boolean
  onClose: () => void
  onRefresh: () => void
  /** Adopt a listed session as the local active session. */
  onSelect?: (session: ParkingSessionDetails) => void
}) {
  const total = count ?? sessions.length

  return (
    <ModalShell title="Aktiivsed sessioonid" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-soft">
          {loading ? 'Laadin…' : `${total} aktiivset`}
          {message ? ` · ${message}` : ''}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sea/10 px-3 py-1.5 text-[12px] font-semibold text-sea transition disabled:opacity-55"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Värskenda
        </button>
      </div>

      {sessions.length === 0 && !loading ? (
        <p className="rounded-2xl bg-paper-2 px-4 py-6 text-center text-[14px] text-ink-soft">
          Aktiivseid parkimissessioone pole
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s, i) => {
            const plate = s.carNumber ?? '—'
            const zone = s.zone ?? '—'
            const rate = formatHourlyRate(sessionHourlyRate(s))
            const started = formatSessionInstant(sessionStartIso(s))
            const key = s.sessionId ?? `${plate}-${zone}-${i}`
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!onSelect || !s.carNumber || !s.zone}
                  onClick={() => onSelect?.(s)}
                  className="w-full rounded-2xl border border-ink/8 bg-white px-3.5 py-3 text-left transition hover:border-sea/30 hover:bg-sea/5 disabled:cursor-default disabled:opacity-90"
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
                    {onSelect && s.carNumber && s.zone ? (
                      <span className="shrink-0 rounded-full bg-moss/12 px-2 py-0.5 text-[10px] font-bold text-moss">
                        Vali
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </ModalShell>
  )
}
