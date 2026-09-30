import { Flag, MapPinPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { enqueueParkingRequest, type ParkingRequestType } from '../lib/parkingRequests'
import { TYPE_LABELS } from '../lib/parking'
import type { ParkingSpot, SpotType } from '../types'
import { ModalShell } from './ModalShell'

export type ReportModalContext = {
  /** Default request type */
  mode: ParkingRequestType
  lat: number
  lng: number
  /** When reporting an existing feature */
  target?: ParkingSpot | null
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

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    const fd = new FormData(e.currentTarget)
    const note = String(fd.get('note') || '').trim()

    setSubmitting(true)
    try {
      if (mode === 'PROPOSE_NEW') {
        const name = String(fd.get('name') || '').trim()
        const address = String(fd.get('address') || '').trim()
        if (!name) return
        enqueueParkingRequest({
          type: 'PROPOSE_NEW',
          lat: context.lat,
          lng: context.lng,
          note,
          name,
          address: address || undefined,
          proposedKind: (String(fd.get('kind') || 'street') as 'street' | 'lot'),
          proposedType: (String(fd.get('type') || 'free') as SpotType),
          timeLimit: String(fd.get('limit') || '').trim() || undefined,
        })
        onSubmitted?.(
          'Ettepanek saadetud ülevaatusse — tootmise GeoJSON-i ei muudeta otseselt.',
        )
      } else {
        const target = context.target
        if (!target) return
        enqueueParkingRequest({
          type: 'REPORT_INVALID',
          lat: target.lat,
          lng: target.lng,
          note,
          targetFeatureId: target.id,
          targetName: target.name,
          targetLayer: target.layer,
          reason: (String(fd.get('reason') || 'nonexistent') as
            | 'nonexistent'
            | 'blocked'
            | 'private'
            | 'other'),
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
    <ModalShell onClose={onClose} title={title}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('PROPOSE_NEW')}
          className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[12px] font-bold transition ${
            mode === 'PROPOSE_NEW'
              ? 'bg-[#22C55E] text-white'
              : 'bg-[#F2F2F7] text-[#3A3A3C]'
          }`}
        >
          <MapPinPlus className="h-3.5 w-3.5" />
          Uus koht
        </button>
        <button
          type="button"
          onClick={() => setMode('REPORT_INVALID')}
          disabled={!context.target}
          className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[12px] font-bold transition disabled:opacity-40 ${
            mode === 'REPORT_INVALID'
              ? 'bg-[#FF3B30] text-white'
              : 'bg-[#F2F2F7] text-[#3A3A3C]'
          }`}
        >
          <Flag className="h-3.5 w-3.5" />
          Teavita veast
        </button>
      </div>

      <p className="mb-3 rounded-xl bg-[#007AFF]/10 px-3 py-2 text-[11px] font-medium leading-snug text-[#007AFF]">
        Muudatused lähevad ootel järjekorda (<code className="font-mono">parking_requests</code>
        ). Tootmise GeoJSON faile brauser ei muuda.
      </p>

      <form onSubmit={submit} className="space-y-3">
        {mode === 'PROPOSE_NEW' ? (
          <>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Nimi</label>
              <input
                name="name"
                required
                placeholder="nt Pelgulinn — tasuta tänav"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Tüüp</label>
                <select
                  name="type"
                  defaultValue="free"
                  className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none"
                >
                  {(Object.keys(TYPE_LABELS) as SpotType[])
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
                  defaultValue="street"
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
                placeholder="Tänav, linnaosa"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
              />
            </div>
            <p className="text-[11px] text-ink-soft">
              Koordinaadid: {context.lat.toFixed(5)}, {context.lng.toFixed(5)}
            </p>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-[#F2F2F7] px-3 py-2.5 text-[12px] font-semibold text-[#1C1C1E]">
              {context.target?.name ?? 'Valitud koht'}
              <span className="mt-0.5 block text-[11px] font-medium text-[#8E8E93]">
                {context.target?.id} · {context.target?.layer}
              </span>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Põhjus</label>
              <select
                name="reason"
                defaultValue="nonexistent"
                className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none"
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
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Lisainfo</label>
          <textarea
            name="note"
            rows={2}
            placeholder="Tingimused, märgid, foto kirjeldus…"
            className="w-full rounded-xl border border-ink/10 bg-paper-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/25"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || (mode === 'REPORT_INVALID' && !context.target)}
          className="w-full rounded-xl bg-moss py-3 text-sm font-bold text-white shadow-lg transition hover:bg-moss-deep disabled:opacity-55"
        >
          {mode === 'PROPOSE_NEW' ? 'Saada ettepanek' : 'Saada veateade'}
        </button>
      </form>
    </ModalShell>
  )
}
