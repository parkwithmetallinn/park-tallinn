import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { apiUrl } from '../lib/apiBase'
import { assertNearParkingForFullReport } from '../lib/fullReportProximity'
import { installIdHeaders } from '../lib/installId'
import {
  canSubmitReport,
  markReportSubmitted,
} from '../lib/reportCooldown'
import type { ParkingSpot } from '../types'
import { useI18n } from '../i18n'

/** Only FULL / FREE — API rejects PRICES / CLOSED. */
export type CrowdStatusType = 'full' | 'free'

const STATUS_OPTIONS: {
  id: CrowdStatusType
  label: string
  Icon: typeof AlertTriangle
  apiStatus: 'FULL' | 'FREE'
}[] = [
  { id: 'full', label: 'Parkla on täis', Icon: AlertTriangle, apiStatus: 'FULL' },
  { id: 'free', label: 'Vabu kohti', Icon: CheckCircle2, apiStatus: 'FREE' },
]

const FETCH_TIMEOUT_MS = 10_000

const SUCCESS_TOAST =
  'Aitäh! Sinu teavitus aitab teisi autojuhte.'

/**
 * Glassmorphic slide-up crowd-report modal (mobile-first).
 * Preset buttons only — no free-form notes (App Store UGC Rule 1.2).
 * POSTs { parkingId, statusType } to /api/reports.
 */
export function CrowdReportModal({
  spot,
  dark,
  initialStatus = 'full',
  onClose,
  onSuccess,
}: {
  spot: ParkingSpot
  dark?: boolean
  /** Pre-select when opened from "Parkla on täis". */
  initialStatus?: CrowdStatusType
  onClose: () => void
  /** Called after a successful submit (parent shows toast / marks full). */
  onSuccess?: (payload: {
    statusType: CrowdStatusType
    comment: string
    message: string
  }) => void
}) {
  const { t } = useI18n()
  const safeInitial =
    initialStatus === 'free' || initialStatus === 'full' ? initialStatus : 'full'
  const [statusType, setStatusType] = useState<CrowdStatusType>(safeInitial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/95 text-[#F5F5F7]'
    : 'border-black/8 bg-white/95 text-[#1C1C1E]'
  const optionIdle = dark
    ? 'border-white/10 bg-white/5'
    : 'border-black/6 bg-[#F2F2F7]/90'
  const optionActive = dark
    ? 'border-[#FF3B30]/55 bg-[#FF3B30]/18'
    : 'border-[#FF3B30]/45 bg-[#FF3B30]/10'

  const cooldownActive = !canSubmitReport(spot.id)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!canSubmitReport(spot.id)) {
      setError('Sama parkla jaoks oota 5 minutit enne uut teavitust')
      return
    }
    setError(null)
    setSubmitting(true)
    const opt = STATUS_OPTIONS.find((o) => o.id === statusType)
    const apiStatus = opt?.apiStatus ?? 'FULL'
    if (apiStatus === 'FULL') {
      const near = await assertNearParkingForFullReport(spot.lat, spot.lng)
      if (!near.ok) {
        setError(near.message)
        setSubmitting(false)
        return
      }
    }
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(apiUrl('/api/reports'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...installIdHeaders(),
        },
        body: JSON.stringify({
          parkingId: spot.id,
          statusType: apiStatus,
          comment: '',
        }),
        signal: ac.signal,
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        message?: string
      } | null
      if (!res.ok || data?.success === false) {
        setError(data?.message || 'Teavituse saatmine ebaõnnestus')
        return
      }
      markReportSubmitted(spot.id)
      onSuccess?.({
        statusType,
        comment: '',
        message: SUCCESS_TOAST,
      })
      onClose()
    } catch (err) {
      const aborted =
        (err as Error)?.name === 'AbortError' || ac.signal.aborted
      if (aborted) {
        // Request may still land on the server — block retries for 5 minutes.
        markReportSubmitted(spot.id)
      }
      setError(
        aborted
          ? 'Aegus — sama teavitust ei saadeta uuesti 5 minutit'
          : 'Ühendus ebaõnnestus — proovi uuesti',
      )
    } finally {
      window.clearTimeout(timer)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1100] flex items-end justify-center bg-black/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
      data-testid="crowd-report-modal"
    >
      <div
        className={`animate-slide-up w-full max-w-md overflow-hidden rounded-3xl border p-4 shadow-2xl sm:p-5 ${panel}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('report.send')}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className={`text-[17px] font-bold tracking-tight ${ink}`}>
              Saada teavitus
            </h2>
            <p className={`mt-0.5 truncate text-[12px] font-medium ${muted}`}>
              {spot.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`tap-scale flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              dark ? 'bg-white/10 text-[#F5F5F7]' : 'bg-[#F2F2F7] text-[#1C1C1E]'
            }`}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map(({ id, label, Icon }) => {
              const active = statusType === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusType(id)}
                  className={`tap-scale flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition ${
                    active ? optionActive : optionIdle
                  }`}
                  aria-pressed={active}
                >
                  <Icon
                    className={`h-5 w-5 ${
                      active
                        ? id === 'full'
                          ? 'text-[#FF3B30]'
                          : 'text-[#34C759]'
                        : muted
                    }`}
                  />
                  <span
                    className={`text-[12px] font-bold leading-tight ${
                      active ? ink : muted
                    }`}
                  >
                    {label}
                  </span>
                </button>
              )
            })}
          </div>

          {error ? (
            <p className="rounded-2xl bg-[#FF3B30]/10 px-3 py-2.5 text-[12px] font-semibold text-[#D70015]">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={`tap-scale flex-1 rounded-2xl px-3 py-3 text-[14px] font-bold disabled:opacity-55 ${
                dark
                  ? 'bg-white/10 text-[#F5F5F7]'
                  : 'bg-[#F2F2F7] text-[#1C1C1E]'
              }`}
            >
              Tühista
            </button>
            <button
              type="submit"
              disabled={submitting || cooldownActive}
              className="tap-scale flex-[1.35] items-center justify-center gap-2 rounded-2xl bg-[#FF3B30] px-3 py-3 text-[14px] font-bold text-white disabled:opacity-55 inline-flex"
              title={
                cooldownActive
                  ? 'Sama parkla jaoks oota 5 minutit'
                  : undefined
              }
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saadan…
                </>
              ) : cooldownActive ? (
                'Oota 5 min'
              ) : (
                'Saada teavitus'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export const CROWD_REPORT_SUCCESS_MESSAGE = SUCCESS_TOAST
