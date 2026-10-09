import { AlertTriangle, Ban, Clock, Loader2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { apiUrl } from '../lib/apiBase'
import type { ParkingSpot } from '../types'

export type CrowdStatusType = 'full' | 'prices' | 'closed'

const STATUS_OPTIONS: {
  id: CrowdStatusType
  label: string
  Icon: typeof AlertTriangle
}[] = [
  { id: 'full', label: 'Parkla on täis', Icon: AlertTriangle },
  { id: 'prices', label: 'Hinnad/reeglid muutusid', Icon: Clock },
  { id: 'closed', label: 'Parkla suletud', Icon: Ban },
]

const COMMENT_MAX = 200

const SUCCESS_TOAST =
  'Aitäh! Sinu teavitus aitab teisi autojuhte.'

/**
 * Glassmorphic slide-up crowd-report modal (mobile-first).
 * POSTs { parkingId, statusType, comment } to /api/reports.
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
  const [statusType, setStatusType] = useState<CrowdStatusType>(initialStatus)
  const [comment, setComment] = useState('')
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
  const field = dark
    ? 'border-white/10 bg-white/5 text-white placeholder:text-[#636366]'
    : 'border-ink/10 bg-white/95 text-ink placeholder:text-[#8E8E93]'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(apiUrl('/api/reports'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parkingId: spot.id,
          // FULL = täis; prices/closed map to FREE vote for tally
          statusType: statusType === 'full' ? 'FULL' : 'FREE',
          comment: comment.trim().slice(0, COMMENT_MAX),
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        message?: string
      } | null
      if (!res.ok || data?.success === false) {
        setError(data?.message || 'Teavituse saatmine ebaõnnestus')
        return
      }
      onSuccess?.({
        statusType,
        comment: comment.trim(),
        message: SUCCESS_TOAST,
      })
      onClose()
    } catch {
      setError('Ühendus ebaõnnestus — proovi uuesti')
    } finally {
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
        aria-label="Saada teavitus"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[16px] font-bold ${ink}`}>Saada teavitus</p>
            <p className={`mt-0.5 truncate text-[12px] font-medium ${muted}`}>
              {spot.name || spot.zone_code || 'Parkla'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`tap-scale flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              dark ? 'bg-white/10 text-[#F5F5F7]' : 'bg-[#F2F2F7] text-[#1C1C1E]'
            }`}
            aria-label="Sulge"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <fieldset className="space-y-2">
            <legend className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>
              Põhjus
            </legend>
            <div className="grid gap-2">
              {STATUS_OPTIONS.map(({ id, label, Icon }) => {
                const active = statusType === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setStatusType(id)}
                    aria-pressed={active}
                    className={`tap-scale flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-[14px] font-semibold transition ${
                      active ? optionActive : optionIdle
                    } ${ink}`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        active
                          ? 'bg-[#FF3B30]/20 text-[#FF3B30]'
                          : dark
                            ? 'bg-white/10 text-[#EBEBF5]'
                            : 'bg-white text-[#636366]'
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2.4} />
                    </span>
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="crowd-report-comment"
              className={`mb-1 block text-[10px] font-semibold uppercase tracking-wide ${muted}`}
            >
              Märkused (nt tõkkepuu rikkis)
            </label>
            <textarea
              id="crowd-report-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
              maxLength={COMMENT_MAX}
              rows={3}
              placeholder="Valikuline…"
              disabled={submitting}
              className={`w-full resize-none rounded-2xl border px-3.5 py-2.5 text-[14px] font-medium outline-none focus:ring-2 focus:ring-[#FF3B30]/25 ${field}`}
            />
            <p className={`mt-1 text-right text-[11px] font-medium ${muted}`}>
              {comment.length}/{COMMENT_MAX}
            </p>
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
              disabled={submitting}
              className="tap-scale flex flex-[1.35] items-center justify-center gap-2 rounded-2xl bg-[#FF3B30] px-3 py-3 text-[14px] font-bold text-white disabled:opacity-55"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saadan…
                </>
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
