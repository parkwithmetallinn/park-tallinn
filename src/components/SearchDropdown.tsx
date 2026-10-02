import { Car, MapPin, Search } from 'lucide-react'
import { formatDistance } from '../lib/geo'
import { estimateDriveMinutes } from '../lib/routing'
import type { GeocodeResult } from '../lib/geocode'
import type { ParkingSpot } from '../types'

export type SearchSuggestion =
  | {
      kind: 'place'
      id: string
      name: string
      subtitle: string
      lat: number
      lng: number
      distanceM: number
      result: GeocodeResult
    }
  | {
      kind: 'parking'
      id: string
      name: string
      subtitle: string
      lat: number
      lng: number
      distanceM: number
      spot: ParkingSpot
    }

/** Split Nominatim display_name into a short title + secondary line. */
export function splitPlaceLabel(label: string): { name: string; subtitle: string } {
  const parts = label
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const name = parts[0] || label
  // Drop redundant Estonia / county noise; keep city + district when useful
  const rest = parts
    .slice(1)
    .filter(
      (p) =>
        !/^eesti$/i.test(p) &&
        !/^estonia$/i.test(p) &&
        !/maakond$/i.test(p) &&
        !/^\d{5}$/.test(p),
    )
  const subtitle = rest.slice(0, 4).join(', ')
  return { name, subtitle }
}

function metaLine(distanceM: number): string {
  const dist = formatDistance(distanceM)
  const mins = estimateDriveMinutes(distanceM)
  return `${dist} · ${mins} min`
}

export function SearchDropdown({
  loading,
  error,
  suggestions,
  dark,
  onSelect,
}: {
  loading: boolean
  error: string | null
  suggestions: SearchSuggestion[]
  dark?: boolean
  onSelect: (item: SearchSuggestion) => void
}) {
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const text = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/95 shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
    : 'border-white/60 bg-white/95 shadow-[0_12px_40px_rgba(15,23,42,0.16)]'
  const hover = dark ? 'hover:bg-white/10' : 'hover:bg-black/[0.04]'
  const divider = dark ? 'border-white/8' : 'border-black/6'

  if (!loading && !error && suggestions.length === 0) {
    return (
      <div
        className={`w-full overflow-hidden rounded-2xl border font-sans backdrop-blur-xl ${panel}`}
        role="listbox"
        aria-label="Otsingutulemused"
      >
        <p className={`px-4 py-3.5 text-[13px] font-medium ${muted}`}>
          Tulemusi ei leitud
        </p>
      </div>
    )
  }

  return (
    <div
      className={`w-full min-w-0 overflow-hidden rounded-2xl border font-sans backdrop-blur-xl ${panel}`}
      role="listbox"
      aria-label="Otsingutulemused"
    >
      <div className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain py-1">
        {loading ? (
          <p className={`px-4 py-3.5 text-[13px] font-medium ${muted}`}>Otsin…</p>
        ) : null}
        {error ? (
          <p className="px-4 py-3.5 text-[13px] font-semibold text-[#FF3B30]">
            {error}
          </p>
        ) : null}
        {suggestions.map((item, i) => {
          const Icon =
            item.kind === 'parking' ? Car : item.kind === 'place' ? MapPin : Search
          const iconColor =
            item.kind === 'parking' ? 'text-[#34C759]' : 'text-[#007AFF]'
          return (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              role="option"
              data-testid={`search-suggestion-${item.kind}-${item.id}`}
              onClick={() => onSelect(item)}
              className={`tap-scale flex w-full min-w-0 cursor-pointer items-start gap-3 px-3.5 py-3 text-left transition active:scale-[0.99] ${hover} ${
                i > 0 || loading || error ? `border-t ${divider}` : ''
              } ${text}`}
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
                }`}
              >
                <Icon className={`h-4 w-4 ${iconColor}`} strokeWidth={2.3} />
              </span>
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block text-[14px] leading-snug font-semibold break-words whitespace-normal">
                  {item.name}
                </span>
                <span
                  className={`mt-0.5 block text-[12px] leading-snug font-medium break-words whitespace-normal ${muted}`}
                >
                  {metaLine(item.distanceM)}
                  {item.subtitle ? ` · ${item.subtitle}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
