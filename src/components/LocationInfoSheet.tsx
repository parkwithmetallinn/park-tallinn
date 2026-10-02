import { MapPin, Navigation, X } from 'lucide-react'
import type { AlternativeParking } from '../lib/alternatives'
import {
  formatCoords,
  navLinks,
  openAppleMaps,
  type SearchLocation,
} from '../lib/geocode'
import type { ParkingSpot } from '../types'
import { FindParkingActions } from './FindParkingActions'
import { InfoSidePanelShell } from './InfoSidePanel'

export function LocationInfoSheet({
  location,
  dark,
  onClose,
  onClear,
  alternatives = [],
  noAlternatives = false,
  onFindNearest,
  onWidenRadius,
  onSelectAlternative,
}: {
  location: SearchLocation
  dark?: boolean
  onClose: () => void
  /** Clears the search pin and resets search UI */
  onClear: () => void
  alternatives?: AlternativeParking[]
  noAlternatives?: boolean
  onFindNearest?: () => void
  onWidenRadius?: () => void
  onSelectAlternative?: (spot: ParkingSpot) => void
}) {
  const links = navLinks(location.lat, location.lng)
  const coords = formatCoords(location.lat, location.lng)
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const soft = dark ? 'text-[#EBEBF5]/80' : 'text-[#636366]'
  const chip = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'

  return (
    <InfoSidePanelShell title={location.name} dark={dark} onClose={onClose}>
      {({ requestClose }) => (
        <>
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className={`text-[10px] font-semibold tracking-wide uppercase ${muted}`}>
                Valitud asukoht
              </p>
              <h3 className="mt-0.5 text-[15px] leading-snug font-bold tracking-tight">
                {location.name}
              </h3>
              <p className={`mt-1 flex items-start gap-1 text-[12px] leading-snug ${soft}`}>
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#007AFF]" />
                <span className="line-clamp-2">{location.label}</span>
              </p>
              <p className={`mt-1 font-mono text-[11px] font-semibold tracking-wide ${muted}`}>
                {coords}
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

          <p className={`mb-1.5 text-[10px] font-semibold tracking-wide uppercase ${muted}`}>
            Navigeeri
          </p>
          <div className="mb-2.5 grid grid-cols-3 gap-1.5">
            <a
              href={links.waze}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#33CCFF] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <Navigation className="h-4 w-4 text-[#053B4A]" strokeWidth={2.5} />
              <span className="text-[11px] font-bold text-[#053B4A]">Waze</span>
            </a>
            <a
              href={links.google}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#4285F4] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4 text-white" strokeWidth={2.5} />
              <span className="text-[11px] font-bold text-white">Google</span>
            </a>
            <button
              type="button"
              onClick={() => openAppleMaps(location.lat, location.lng)}
              className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-[#1C1C1E] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
              aria-label="Ava Apple Maps"
            >
              <MapPin className="h-4 w-4 text-white" strokeWidth={2.5} />
              <span className="text-[11px] font-bold text-white">Apple</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onClear()}
            className="mb-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF3B30]/10 px-3 py-2.5 text-[12px] font-semibold text-[#D70015] transition active:scale-[0.99]"
            aria-label="Tühjenda otsing"
          >
            <X className="h-3.5 w-3.5" />
            Tühjenda otsing
          </button>

          {onFindNearest && onSelectAlternative ? (
            <FindParkingActions
              dark={dark}
              primaryLabel="Leia lähim parkla"
              onFindAnother={onFindNearest}
              alternatives={alternatives}
              noResults={noAlternatives}
              onWidenRadius={onWidenRadius}
              onSelectAlternative={onSelectAlternative}
            />
          ) : null}
        </>
      )}
    </InfoSidePanelShell>
  )
}
