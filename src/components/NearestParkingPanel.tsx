import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { formatDistance } from '../lib/geo'
import {
  categoryPaintColor,
  isClockLimitedParking,
  isUnlimitedFreeParking,
} from '../lib/parkingClassification'
import type { ParkingSpot } from '../types'
import { InfoSidePanelShell } from './InfoSidePanel'

export type NearestParkingOption = {
  spot: ParkingSpot
  distanceM: number
}

type PanelFilter = 'all' | 'free' | 'clock' | 'paid'

const TABS: { id: PanelFilter; label: string }[] = [
  { id: 'all', label: 'Kõik' },
  { id: 'free', label: 'Odavaim / Tasuta' },
  { id: 'clock', label: 'Kellaga' },
  { id: 'paid', label: 'Tasuline' },
]

/** ~1.4 m/s urban walking pace */
function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / 1.4 / 60))
}

export function parkingPriceBadge(spot: ParkingSpot): string {
  if (isUnlimitedFreeParking(spot)) return 'TASUTA'
  if (isClockLimitedParking(spot)) {
    const mins = Math.max(1, Math.round(spot.free_minutes || 15))
    return `${mins} MIN`
  }
  if (spot.price_per_hour > 0) {
    return `${spot.price_per_hour.toFixed(2)} €/h`
  }
  if (spot.badge === 'PAID' || spot.zone_code) {
    return spot.zone_code && spot.zone_code !== 'ZONE'
      ? spot.zone_code
      : 'TASULINE'
  }
  return '—'
}

/** Compact map pill label (no numbers 1/2/3 — price/type only). */
export function parkingMapPillLabel(spot: ParkingSpot): string {
  if (isUnlimitedFreeParking(spot)) return 'FREE'
  if (isClockLimitedParking(spot)) {
    const mins = Math.max(1, Math.round(spot.free_minutes || 15))
    return `${mins} MIN`
  }
  if (spot.price_per_hour > 0) {
    return `${spot.price_per_hour.toFixed(2)} €/h`
  }
  return 'PAID'
}

export function parkingMapPillTone(
  spot: ParkingSpot,
): 'free' | 'clock' | 'paid' | 'other' {
  if (isUnlimitedFreeParking(spot)) return 'free'
  if (isClockLimitedParking(spot)) return 'clock'
  if (spot.price_per_hour > 0 || spot.badge === 'PAID') return 'paid'
  return 'other'
}

function badgeTone(spot: ParkingSpot, dark?: boolean): string {
  if (isUnlimitedFreeParking(spot)) {
    return dark
      ? 'bg-[#22C55E]/25 text-[#86EFAC]'
      : 'bg-[#22C55E]/15 text-[#15803D]'
  }
  if (isClockLimitedParking(spot)) {
    return dark
      ? 'bg-[#FFD60A]/20 text-[#FFD60A]'
      : 'bg-[#FFD60A]/25 text-[#8A6D00]'
  }
  if (spot.price_per_hour > 0 || spot.badge === 'PAID') {
    return dark
      ? 'bg-[#FF3B30]/25 text-[#FCA5A5]'
      : 'bg-[#FF3B30]/12 text-[#D70015]'
  }
  return dark ? 'bg-white/10 text-[#98989D]' : 'bg-[#F2F2F7] text-[#636366]'
}

function matchesPanelFilter(spot: ParkingSpot, filter: PanelFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'free') {
    return isUnlimitedFreeParking(spot) || spot.price_per_hour <= 0
  }
  if (filter === 'clock') return isClockLimitedParking(spot)
  // paid
  return (
    spot.price_per_hour > 0 ||
    spot.badge === 'PAID' ||
    ['europark', 'snabb', 'citypark', 'uhisteenused', 'parkit', 'municipal'].includes(
      spot.layer,
    )
  )
}

export function NearestParkingPanel({
  targetName,
  options,
  dark,
  selectedPreviewId,
  onPreview,
  onConfirm,
  onClose,
}: {
  targetName: string
  options: NearestParkingOption[]
  dark?: boolean
  /** Active tap/click preview — no hover (mobile has none). */
  selectedPreviewId?: string | null
  /** Instant preview only — never opens detail or fetches routes. */
  onPreview: (id: string) => void
  /** Explicit confirmation — opens detail + starts navigation. */
  onConfirm: (spot: ParkingSpot) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<PanelFilter>('all')
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const soft = dark ? 'text-[#EBEBF5]/80' : 'text-[#636366]'
  const chip = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'

  const filtered = useMemo(() => {
    const list = options.filter((o) => matchesPanelFilter(o.spot, filter))
    if (filter === 'free') {
      // Cheapest first: free → clock → lowest €/h
      return [...list].sort((a, b) => {
        const score = (s: ParkingSpot) => {
          if (isUnlimitedFreeParking(s)) return 0
          if (isClockLimitedParking(s)) return 1
          return 2 + (s.price_per_hour || 99)
        }
        const d = score(a.spot) - score(b.spot)
        return d !== 0 ? d : a.distanceM - b.distanceM
      })
    }
    return list
  }, [options, filter])

  // Keep list card in view when preview comes from a map pill tap
  useEffect(() => {
    if (!selectedPreviewId) return
    const el = cardRefs.current.get(selectedPreviewId)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedPreviewId])

  const previewSpot = useMemo(() => {
    if (!selectedPreviewId) return null
    return (
      filtered.find((o) => o.spot.id === selectedPreviewId)?.spot ??
      options.find((o) => o.spot.id === selectedPreviewId)?.spot ??
      null
    )
  }, [selectedPreviewId, filtered, options])

  return (
    <InfoSidePanelShell
      title="Lähimad parklad"
      dark={dark}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <div data-testid="nearest-parking-panel">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[10px] font-semibold tracking-wide uppercase ${muted}`}
              >
                Lähimad parklad
              </p>
              <h3 className={`mt-0.5 text-[15px] font-bold tracking-tight ${ink}`}>
                Vali parkla sihtkoha juurde
              </h3>
              <p className={`mt-1 flex items-start gap-1 text-[12px] ${soft}`}>
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#007AFF]" />
                <span className="line-clamp-2">{targetName}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${chip} ${muted}`}
              aria-label="Sulge"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className="mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Parkla filter"
          >
            {TABS.map((tab) => {
              const active = filter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(tab.id)}
                  className={`tap-scale shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                    active
                      ? dark
                        ? 'bg-white text-[#1C1C1E]'
                        : 'bg-[#1C1C1E] text-white'
                      : dark
                        ? 'bg-white/10 text-[#EBEBF5]'
                        : 'bg-[#F2F2F7] text-[#3A3A3C]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {filtered.length === 0 ? (
            <p className={`py-4 text-center text-[13px] font-medium ${muted}`}>
              Selle filtriga parklaid ei leitud.
            </p>
          ) : (
            <ul className="space-y-1.5" role="listbox" aria-label="Lähimad parklad">
              {filtered.map(({ spot, distanceM }) => {
                const active = selectedPreviewId === spot.id
                const badge = parkingPriceBadge(spot)
                const walk = walkMinutes(distanceM)
                return (
                  <li
                    key={spot.id}
                    ref={(node) => {
                      if (node) cardRefs.current.set(spot.id, node)
                      else cardRefs.current.delete(spot.id)
                    }}
                  >
                    <div
                      role="option"
                      aria-selected={active}
                      tabIndex={0}
                      data-testid={`nearest-parking-card-${spot.id}`}
                      onClick={() => onPreview(spot.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onPreview(spot.id)
                        }
                      }}
                      className={`tap-scale w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                        active
                          ? dark
                            ? 'border-[#0A84FF]/70 bg-[#0A84FF]/18 shadow-[0_0_0_1px_rgba(10,132,255,0.35)]'
                            : 'border-[#007AFF]/60 bg-[#007AFF]/10 shadow-[0_0_0_1px_rgba(0,122,255,0.25)]'
                          : dark
                            ? 'border-white/10 bg-white/5'
                            : 'border-black/6 bg-white/55'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: categoryPaintColor(spot) }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span
                              className={`truncate text-[13px] font-bold ${ink}`}
                            >
                              {spot.name || spot.zone_code || 'Parkla'}
                            </span>
                            <span
                              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${badgeTone(spot, dark)}`}
                            >
                              {badge}
                            </span>
                          </span>
                          <span
                            className={`mt-0.5 block text-[11px] font-medium ${muted}`}
                          >
                            {formatDistance(distanceM)}
                            {' · '}
                            {walk} min kõndi
                            {spot.zone_code && spot.zone_code !== 'ZONE'
                              ? ` · ${spot.zone_code}`
                              : ''}
                          </span>
                        </span>
                      </div>

                      {active ? (
                        <button
                          type="button"
                          data-testid="confirm-parking-selection"
                          onClick={(e) => {
                            e.stopPropagation()
                            onConfirm(spot)
                          }}
                          className="tap-scale mt-2.5 w-full rounded-xl bg-[#007AFF] px-3 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition active:scale-[0.98] active:bg-[#0066D6]"
                        >
                          Vali see parkla
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Sticky confirm when preview is outside current filter list */}
          {previewSpot &&
          !filtered.some((o) => o.spot.id === previewSpot.id) ? (
            <button
              type="button"
              data-testid="confirm-parking-selection"
              onClick={() => onConfirm(previewSpot)}
              className="tap-scale mt-3 w-full rounded-xl bg-[#007AFF] px-3 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition active:scale-[0.98]"
            >
              Vali see parkla
            </button>
          ) : null}
        </div>
      )}
    </InfoSidePanelShell>
  )
}
