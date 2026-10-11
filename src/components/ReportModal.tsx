import { Flag, MapPinPlus, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import type { ParkingRequestType } from '../lib/parkingRequests'
import type { ParkingSpot } from '../types'
import {
  reportInvalidSchema,
  reportProposeSchema,
} from '../lib/validation'
import {
  composeProposeNote,
  composeWrongDataNote,
  submitFeedback,
} from '../lib/submitFeedback'
import { useI18n } from '../i18n'

export type ReportModalContext = {
  /** Default request type */
  mode: ParkingRequestType
  lat: number
  lng: number
  /** When reporting an existing feature */
  target?: ParkingSpot | null
}

/** Propose-new type options — no Pargi ja Reisi; matches map filter language. */
const TYPE_OPTIONS = [
  { value: 'free', label: '100% tasuta' },
  { value: 'timed', label: 'Kellaga / ajaga' },
  { value: 'paid', label: 'Tasuline' },
  { value: 'other', label: 'Muud / Era' },
] as const

const SUCCESS_ET = 'Aitäh! Vaatame teate üle.'

const fieldClass =
  'w-full rounded-xl border-0 bg-slate-100/80 px-3 py-2.5 text-[15px] font-medium text-[#1C1C1E] outline-none transition focus:ring-2 focus:ring-[#007AFF]/35'

/** Glass select — strip native OS chrome, custom chevron. */
const selectClass =
  'w-full cursor-pointer appearance-none rounded-xl border-0 bg-slate-100/80 bg-[length:14px_14px] bg-[right_12px_center] bg-no-repeat py-2.5 pr-10 pl-3 text-[15px] font-medium text-[#1C1C1E] outline-none transition focus:ring-2 focus:ring-[#007AFF]/35 ' +
  "bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238E8E93%22 stroke-width=%222.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E')]"

export function ReportModal({
  context,
  onClose,
  onSubmitted,
}: {
  context: ReportModalContext
  onClose: () => void
  onSubmitted?: (message: string, ok?: boolean) => void
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<ParkingRequestType>(context.mode)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openedAtRef = useRef(Date.now())

  const fakeSuccessClose = () => {
    onSubmitted?.(SUCCESS_ET, true)
    onClose()
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    const fd = new FormData(e.currentTarget)
    setError(null)

    // Invisible spam checks — same success path, no new UI (do not hit API)
    const honeypot = String(fd.get('company_website') || '')
    if (honeypot) {
      fakeSuccessClose()
      return
    }
    if (Date.now() - openedAtRef.current < 1200) {
      fakeSuccessClose()
      return
    }

    let note = String(fd.get('note') || '').trim()

    setSubmitting(true)
    try {
      if (mode === 'PROPOSE_NEW') {
        const parsed = reportProposeSchema.safeParse({
          name: String(fd.get('name') || ''),
          address: String(fd.get('address') || ''),
          type: String(fd.get('type') || 'free'),
          kind: String(fd.get('kind') || 'street'),
          limit: String(fd.get('limit') || ''),
          note,
          company_website: honeypot,
        })
        if (!parsed.success) {
          setError('Palun täida kohustuslikud väljad õigesti.')
          return
        }
        const name = parsed.data.name
        const address = parsed.data.address?.trim() || ''
        note = parsed.data.note?.trim() || ''
        const rawType = parsed.data.type
        if (rawType === 'other' && !note.toLowerCase().includes('muud')) {
          note = note ? `Muud / Era. ${note}` : 'Muud / Era'
        }
        const composed = composeProposeNote({
          name,
          type: rawType,
          kind: parsed.data.kind,
          limit: parsed.data.limit?.trim() || '',
          address,
          note,
        })
        const result = await submitFeedback({
          type: 'NEW_PARKING',
          parkingId: null,
          lat: context.lat,
          lng: context.lng,
          note: composed,
          company_website: '',
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        onSubmitted?.(result.message, true)
        onClose()
      } else {
        const target = context.target
        if (!target) {
          setError('Parkla puudub — vali koht kaardilt.')
          return
        }
        const parsed = reportInvalidSchema.safeParse({
          reason: String(fd.get('reason') || 'nonexistent'),
          note,
          company_website: honeypot,
        })
        if (!parsed.success) {
          setError('Palun täida kohustuslikud väljad õigesti.')
          return
        }
        const composed = composeWrongDataNote({
          reason: parsed.data.reason,
          note: parsed.data.note?.trim() || '',
        })
        const result = await submitFeedback({
          type: 'WRONG_DATA',
          parkingId: target.id,
          lat: target.lat,
          lng: target.lng,
          note: composed,
          company_website: '',
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        onSubmitted?.(result.message, true)
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const title =
    mode === 'PROPOSE_NEW' ? 'Paku uut parkimiskohta' : 'Märgi olematuks / Teavita veast'

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className="animate-slide-up max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-black/8 bg-white/95 p-6 font-sans shadow-2xl [font-family:var(--font-sans),ui-sans-serif,system-ui,-apple-system,sans-serif]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[20px] font-bold leading-tight tracking-tight text-[#1C1C1E]">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="tap-scale flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100/80 text-[#8E8E93] transition hover:bg-slate-200/80 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100/80 p-1"
          role="tablist"
          aria-label={t('report.typeAria')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'PROPOSE_NEW'}
            onClick={() => {
              setMode('PROPOSE_NEW')
              setError(null)
            }}
            className={`tap-scale flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[13px] font-bold transition active:scale-[0.98] ${
              mode === 'PROPOSE_NEW'
                ? 'bg-white text-[#1C1C1E] shadow-sm'
                : 'text-[#8E8E93] hover:bg-white/50'
            }`}
          >
            <MapPinPlus className="h-3.5 w-3.5" />
            Uus koht
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'REPORT_INVALID'}
            onClick={() => {
              setMode('REPORT_INVALID')
              setError(null)
            }}
            disabled={!context.target}
            className={`tap-scale flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[13px] font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
              mode === 'REPORT_INVALID'
                ? 'bg-white text-[#1C1C1E] shadow-sm'
                : 'text-[#8E8E93] hover:bg-white/50'
            }`}
          >
            <Flag className="h-3.5 w-3.5" />
            Teavita veast
          </button>
        </div>

        <p className="mb-4 rounded-xl bg-[#007AFF]/10 px-3 py-2.5 text-[12px] font-medium leading-snug text-[#007AFF]">
          Teade läheb meeskonnale ülevaatuseks. Ära lisa e-posti ega telefoni.
        </p>

        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          {/* Invisible honeypot — off-screen, ignored by assistive tech */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-10000px',
              top: 'auto',
              width: 1,
              height: 1,
              overflow: 'hidden',
            }}
          >
            <label>
              Company website
              <input
                type="text"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>
          {mode === 'PROPOSE_NEW' ? (
            <>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
                  Nimi
                </label>
                <input
                  name="name"
                  required
                  placeholder="nt Pelgulinn — tasuta tänav"
                  className={fieldClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
                    Tüüp
                  </label>
                  <select
                    name="type"
                    defaultValue="free"
                    className={selectClass}
                    aria-label="Parkimise tüüp"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
                    Koht
                  </label>
                  <select
                    name="kind"
                    defaultValue="street"
                    className={selectClass}
                    aria-label="Koha liik"
                  >
                    <option value="street">Tänavaäär</option>
                    <option value="lot">Avalik parkla</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
                  Ajapiirang
                </label>
                <input
                  name="limit"
                  placeholder="nt 2 tundi / Piiranguta"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
                  Aadress
                </label>
                <input
                  name="address"
                  placeholder="Tänav, linnaosa"
                  className={fieldClass}
                />
              </div>
              <p className="text-[12px] font-medium text-[#8E8E93]">
                Koordinaadid: {context.lat.toFixed(5)}, {context.lng.toFixed(5)}
              </p>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-slate-100/80 px-3 py-2.5 text-[13px] font-semibold text-[#1C1C1E]">
                {context.target?.name ?? 'Valitud koht'}
                <span className="mt-0.5 block text-[12px] font-medium text-[#8E8E93]">
                  {context.target?.id} · {context.target?.layer}
                </span>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
                  Põhjus
                </label>
                <select
                  name="reason"
                  defaultValue="nonexistent"
                  className={selectClass}
                  aria-label="Vea põhjus"
                >
                  <option value="nonexistent">Kohta pole / vale asukoht</option>
                  <option value="blocked">Blokeeritud / suletud</option>
                  <option value="private">Eravaldus / residentidele</option>
                  <option value="other">Muu</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-[#8E8E93]">
              Lisainfo
            </label>
            <textarea
              name="note"
              rows={2}
              maxLength={200}
              placeholder="Tingimused, märgid… (max 200 märki, ilma e-posti/telefonita)"
              className={`${fieldClass} resize-none`}
            />
          </div>

          {error ? (
            <p
              data-testid="feedback-error"
              className="rounded-xl bg-[#FF3B30]/10 px-3 py-2.5 text-[13px] font-semibold text-[#D70015]"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting || (mode === 'REPORT_INVALID' && !context.target)}
            className={`tap-scale mt-1 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl px-4 py-3 text-[15px] font-bold text-white shadow-lg transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
              mode === 'PROPOSE_NEW' ? 'bg-[#34C759]' : 'bg-[#007AFF]'
            }`}
          >
            {submitting
              ? t('common.loading')
              : mode === 'PROPOSE_NEW'
                ? 'Saada ettepanek'
                : 'Saada veateade'}
          </button>
        </form>
      </div>
    </div>
  )
}
