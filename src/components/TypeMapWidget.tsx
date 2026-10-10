/**
 * Crowdsource widget for unknown-price lots:
 * "Aita kaardistada: mis parkla see on?"
 */

import { HelpCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  postTypeVote,
  type ProposedParkingType,
  type TypeVoteVerification,
} from '../lib/typeVotes'

const OPTIONS: {
  id: ProposedParkingType
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
  onVerified,
}: {
  parkingId: string
  dark?: boolean
  onVerified?: (payload: {
    verifiedType: ProposedParkingType | null
    verified: boolean
    message: string
    results: TypeVoteVerification[]
  }) => void
}) {
  const [busy, setBusy] = useState<ProposedParkingType | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const box = dark
    ? 'border-white/12 bg-white/6'
    : 'border-black/8 bg-[#F2F4F7]'

  const onVote = async (proposedType: ProposedParkingType) => {
    if (busy) return
    setBusy(proposedType)
    setErr(null)
    setMsg(null)
    const res = await postTypeVote({ parkingId, proposedType })
    setBusy(null)
    if (!res.ok) {
      setErr(res.message)
      return
    }
    setMsg(res.message)
    onVerified?.({
      verifiedType: res.verifiedType,
      verified: res.verified,
      message: res.message,
      results: res.results,
    })
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
            Kaks sama tüüpi häält kinnitivad parkla automaatselt.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            data-testid={`type-vote-${opt.id.toLowerCase()}`}
            disabled={busy != null}
            onClick={() => void onVote(opt.id)}
            className={`tap-scale inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 text-[13px] font-bold transition active:scale-[0.98] disabled:opacity-55 ${opt.className}`}
          >
            {busy === opt.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {opt.label}
          </button>
        ))}
      </div>
      {msg ? (
        <p className="mt-2 text-[12px] font-semibold text-[#248A3D]">{msg}</p>
      ) : null}
      {err ? (
        <p className="mt-2 text-[12px] font-semibold text-[#D70015]">{err}</p>
      ) : null}
    </div>
  )
}
