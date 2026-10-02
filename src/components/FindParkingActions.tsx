import { Ban, ChevronDown, ChevronUp, Navigation, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { AlternativeParking } from '../lib/alternatives'
import { formatDistance } from '../lib/geo'
import type { ParkingSpot } from '../types'

/**
 * Always-visible "find another parking" actions + collapsible alternatives list.
 * Used by ParkingBottomSheet and LocationInfoSheet.
 */
export function FindParkingActions({
  dark,
  primaryLabel,
  onFindAnother,
  onMarkFull,
  showMarkFull,
  alternatives,
  noResults,
  onWidenRadius,
  onSelectAlternative,
  isCurrentFull,
}: {
  dark?: boolean
  /** e.g. "Leia teine parkla läheduses" or "Leia lähim parkla" */
  primaryLabel: string
  onFindAnother: () => void
  onMarkFull?: () => void
  showMarkFull?: boolean
  alternatives: AlternativeParking[]
  noResults?: boolean
  onWidenRadius?: () => void
  onSelectAlternative: (spot: ParkingSpot) => void
  isCurrentFull?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const stickyBg = dark
    ? 'bg-[#1C1C1E]/95 border-white/10'
    : 'bg-white/95 border-black/6'
  const rowHover = dark ? 'hover:bg-white/10' : 'hover:bg-black/[0.04]'
  const others = alternatives.slice(1, 6)
  const n = others.length

  return (
    <div
      className={`sticky bottom-0 z-10 -mx-3.5 mt-2 border-t px-3.5 pt-2.5 pb-1 backdrop-blur-md ${stickyBg}`}
    >
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="find-another-parking"
          onClick={onFindAnother}
          className={`tap-scale flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${
            dark
              ? 'bg-[#007AFF]/20 text-[#64B5FF]'
              : 'bg-[#007AFF]/10 text-[#007AFF]'
          }`}
          aria-label={primaryLabel}
        >
          <Navigation className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          <span className="text-left leading-tight">{primaryLabel}</span>
        </button>
        {showMarkFull && onMarkFull ? (
          <button
            type="button"
            data-testid="mark-lot-full"
            onClick={onMarkFull}
            disabled={isCurrentFull}
            className={`tap-scale flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12px] font-bold transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF3B30] disabled:cursor-not-allowed disabled:opacity-45 ${
              dark
                ? 'bg-[#FF3B30]/20 text-[#FF6961]'
                : 'bg-[#FF3B30]/10 text-[#FF3B30]'
            }`}
            aria-label="Parkla on täis"
            title={isCurrentFull ? 'Juba märgitud täis' : 'Parkla on täis'}
          >
            <Ban className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <span className="hidden min-[360px]:inline">Täis</span>
          </button>
        ) : null}
      </div>

      {noResults ? (
        <div
          data-testid="no-alternatives"
          className={`mt-2 rounded-xl px-3 py-2.5 text-[12px] font-semibold leading-snug ${
            dark ? 'bg-white/8 text-[#EBEBF5]' : 'bg-[#F2F2F7] text-[#3A3A3C]'
          }`}
        >
          <p>Läheduses pole teisi parklaid</p>
          {onWidenRadius ? (
            <button
              type="button"
              onClick={onWidenRadius}
              className={`tap-scale mt-2 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-bold ${
                dark
                  ? 'bg-[#007AFF]/20 text-[#64B5FF]'
                  : 'bg-[#007AFF]/10 text-[#007AFF]'
              }`}
              aria-label="Proovi suuremat raadiust"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Proovi suuremat raadiust
            </button>
          ) : null}
        </div>
      ) : null}

      {n > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={`tap-scale flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-[12px] font-bold ${muted} ${
              dark ? 'hover:bg-white/8' : 'hover:bg-black/[0.03]'
            }`}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? 'Peida teised variandid'
                : `Näita teisi variante (${n})`
            }
          >
            <span>
              {expanded
                ? 'Peida teised variandid'
                : `Näita teisi variante (${n})`}
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {expanded ? (
            <ul className="mt-1 space-y-0.5" data-testid="alternatives-list">
              {others.map((alt) => (
                <li key={alt.spot.id}>
                  <button
                    type="button"
                    onClick={() => onSelectAlternative(alt.spot)}
                    className={`tap-scale flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${rowHover} ${ink}`}
                    aria-label={`Vali ${alt.spot.name}`}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white"
                      style={{
                        backgroundColor:
                          alt.outsideFilter ? '#8E8E93' : '#007AFF',
                      }}
                    >
                      {alt.spot.badge || alt.spot.zone_code.slice(0, 3)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">
                        {alt.spot.name}
                      </span>
                      <span className={`block text-[11px] font-medium ${muted}`}>
                        {formatDistance(alt.distanceM)}
                        {alt.outsideFilter ? ' · Filtrist väljaspool' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
