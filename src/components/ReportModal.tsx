import { Flag, MapPinPlus, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { enqueueParkingRequest, type ParkingRequestType } from '../lib/parkingRequests'
import type { ParkingSpot, SpotType } from '../types'
import {
  reportInvalidSchema,
  reportProposeSchema,
} from '../lib/validation'

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

const fieldClass =
  'w-full rounded-xl border-0 bg-slate-100/80 px-3 py-2.5 text-[15px] font-medium text-[#1C1C1E] outline-none transition focus:ring-2 focus:ring-[#007AFF]/35'

/** Glass select — strip native OS chrome, custom chevron. */
const selectClass =
  'w-full cursor-pointer appearance-none rounded-xl border-0 bg-slate-100/80 bg-[length:14px_14px] bg-[right_12px_center] bg-no-repeat py-2.5 pr-10 pl-3 text-[15px] font-medium text-[#1C1C1E] outline-none transition focus:ring-2 focus:ring-[#007AFF]/35 ' +
  "bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238E8E93%22 stroke-width=%222.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E')]"

function mapProposedType(raw: string): SpotType {
  if (raw === 'timed') return 'timed'
  if (raw === 'paid' || raw === 'other') return 'paid'
  return 'free'
}

export function ReportModal({
  context,
  onClose,
  onSubmitted,
}: {
  context: ReportModalContext
  onClose: () => void
  onSubmitted?: (message: string) => void
}) {
  const [mode, setMode] = useState<ParkingRequestType>(context.mode)
  const [submitting, setSubmitting] = useState(false)
  const openedAtRef = useRef(Date.now())

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    const fd = new FormData(e.currentTarget)

    // Invisible spam checks — same success path, no new UI
    const honeypot = String(fd.get('company_website') || '')
    if (honeypot) {
      onSubmitted?.(
        mode === 'PROPOSE_NEW'
          ? 'Ettepanek saadetud ülevaatusse — tootmise GeoJSON-i ei muudeta otseselt.'
          : 'Vea teade saadetud ülevaatusse — kaart muutub alles pärast kinnitust.',
      )
      onClose()
      return
    }
    if (Date.now() - openedAtRef.current < 1200) {
      onSubmitted?.(
        mode === 'PROPOSE_NEW'
          ? 'Ettepanek saadetud ülevaatusse — tootmise GeoJSON-i ei muudeta otseselt.'
          : 'Vea teade saadetud ülevaatusse — kaart muutub alles pärast kinnitust.',
      )
      onClose()
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
        if (!parsed.success) return
        const name = parsed.data.name
        const address = parsed.data.address?.trim() || ''
        note = parsed.data.note?.trim() || ''
        const rawType = parsed.data.type
        if (rawType === 'other' && !note.toLowerCase().includes('muud')) {
          note = note ? `Muud / Era. ${note}` : 'Muud / Era'
        }
        enqueueParkingRequest({
          type: 'PROPOSE_NEW',
          lat: context.lat,
          lng: context.lng,
          note,
          name,
          address: address || undefined,
          proposedKind: parsed.data.kind,
          proposedType: mapProposedType(rawType),
          timeLimit: parsed.data.limit?.trim() || undefined,
        })
        onSubmitted?.(
          'Ettepanek saadetud ülevaatusse — tootmise GeoJSON-i ei muudeta otseselt.',
        )
      } else {
        const target = context.target
        if (!target) return
        const parsed = reportInvalidSchema.safeParse({
          reason: String(fd.get('reason') || 'nonexistent'),
          note,
          company_website: honeypot,
        })
        if (!parsed.success) return
        enqueueParkingRequest({
          type: 'REPORT_INVALID',
          lat: target.lat,
          lng: target.lng,
          note: parsed.data.note?.trim() || '',
          targetFeatureId: target.id,
          targetName: target.name,
          targetLayer: target.layer,
          reason: parsed.data.reason,
        })
        onSubmitted?.(
          'Vea teade saadetud ülevaatusse — kaart muutub alles pärast kinnitust.',
        )
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const title =
    mode === 'PROPOSE_NEW' ? 'Paku uut parkimiskohta' : 'Märgi olematuks / Teavita veast'

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className="animate-slide-up max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/50 bg-white/85 p-6 font-sans shadow-2xl backdrop-blur-xl [font-family:var(--font-sans),ui-sans-serif,system-ui,-apple-system,sans-serif]"
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
            aria-label="Sulge"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100/80 p-1"
          role="tablist"
          aria-label="Teate tüüp"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'PROPOSE_NEW'}
            onClick={() => setMode('PROPOSE_NEW')}
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
            onClick={() => setMode('REPORT_INVALID')}
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
          Muudatused lähevad ootel järjekorda. Tootmise GeoJSON faile brauser ei
          muuda.
        </p>

        <form onSubmit={submit} className="space-y-3">
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
              <p className="text-[11px] font-medium text-[#8E8E93]">
                Koordinaadid: {context.lat.toFixed(5)}, {context.lng.toFixed(5)}
              </p>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-slate-100/80 px-3 py-2.5 text-[13px] font-semibold text-[#1C1C1E]">
                {context.target?.name ?? 'Valitud koht'}
                <span className="mt-0.5 block text-[11px] font-medium text-[#8E8E93]">
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
              placeholder="Tingimused, märgid, foto kirjeldus…"
              className={`${fieldClass} resize-none`}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || (mode === 'REPORT_INVALID' && !context.target)}
            className={`tap-scale mt-1 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl px-4 py-3 text-[15px] font-bold text-white shadow-lg transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
              mode === 'PROPOSE_NEW' ? 'bg-[#34C759]' : 'bg-[#007AFF]'
            }`}
          >
            {mode === 'PROPOSE_NEW' ? 'Saada ettepanek' : 'Saada veateade'}
          </button>
        </form>
      </div>
    </div>
  )
}
