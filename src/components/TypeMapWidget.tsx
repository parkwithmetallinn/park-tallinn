/**
 * Crowdsource widget for unknown-price lots:
 * "Aita kaardistada: mis parkla see on?"
 * POSTs to /api/type-votes with X-Install-Id; local vote marks duplicate UX.
 */

import { HelpCircle } from 'lucide-react'
import { useState } from 'react'
import {
  hasLocalTypeVote,
  submitTypeVote,
  type TypeVoteKind,
} from '../lib/submitTypeVote'
import { postTypeVote } from '../lib/typeVotes'

const OPTIONS: {
  id: TypeVoteKind
  label: string
  className: string
}[] = [
  {
    id: 'FREE',
    label: 'Tasuta',
    className: 'bg-[#00FF00]/18 text-[#0B7A0B] border-[#00FF00]/45',
  },
  {
    id: 'TIMED',
    label: 'Kellaga',
    className: 'bg-[#FFCC00]/22 text-[#8A6D00] border-[#FFCC00]/50',
  },
  {
    id: 'PAID',
    label: 'Tasuline',
    className: 'bg-[#FF0000]/14 text-[#C62828] border-[#FF0000]/40',
  },
]

export function TypeMapWidget({
  parkingId,
  dark,
}: {
  parkingId: string
  dark?: boolean
}) {
  const [hidden, setHidden] = useState(() => hasLocalTypeVote(parkingId))
  const [thanks, setThanks] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const box = dark
    ? 'border-white/12 bg-white/6'
    : 'border-black/8 bg-[#F2F4F7]'

  if (hidden && !thanks) return null

  const onVote = (type: TypeVoteKind) => {
    if (busy) return
    if (hasLocalTypeVote(parkingId)) {
      setErr('Oled selle parkla juba kaardistanud')
      setHidden(true)
      return
    }
    setBusy(true)
    setErr(null)
    void (async () => {
      const api = await postTypeVote({
        parkingId,
        proposedType: type,
      })
      if (!api.ok) {
        setErr(api.message)
        setBusy(false)
        return
      }
      // Mirror locally so the widget stays hidden across reloads.
      submitTypeVote(parkingId, type)
      setThanks(true)
      setBusy(false)
      window.setTimeout(() => setHidden(true), 1200)
    })()
  }

  if (thanks) {
    return (
      <div
        data-testid="type-map-widget"
        className={`mb-2.5 rounded-xl border px-3 py-2.5 text-[13px] font-bold text-[#248A3D] ${box}`}
      >
        Aitäh!
      </div>
    )
  }

  return (
    <div
      data-testid="type-map-widget"
      className={`mb-2.5 rounded-xl border px-3 py-2.5 ${box}`}
    >
      <div className="mb-2 flex items-start gap-2">
        <HelpCircle
          className={`mt-0.5 h-4 w-4 shrink-0 ${dark ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}
        />
        <div className="min-w-0 flex-1">
          <p className={`text-[13px] font-bold leading-snug ${ink}`}>
            Aita kaardistada: mis parkla see on?
          </p>
          <p className={`mt-0.5 text-[12px] font-medium ${muted}`}>
            Vali sobiv tüüp — üks hääl sellelt seadmelt.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            data-testid={`type-vote-${opt.id.toLowerCase()}`}
            onClick={() => onVote(opt.id)}
            disabled={busy}
            className={`tap-scale inline-flex min-h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-bold transition active:scale-[0.98] disabled:opacity-55 ${opt.className}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {err ? (
        <p className="mt-2 text-[12px] font-semibold text-[#D70015]">{err}</p>
      ) : null}
    </div>
  )
}
