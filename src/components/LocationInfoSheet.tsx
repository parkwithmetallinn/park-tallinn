import { MapPin, Navigation, X } from 'lucide-react'
import { useCallback } from 'react'
import {
  formatCoords,
  navLinks,
  openAppleMaps,
  type SearchLocation,
} from '../lib/geocode'
import { useSheetClose } from './AnimatedBottomSheet'

export function LocationInfoSheet({
  location,
  onClose,
  onClear,
}: {
  location: SearchLocation
  onClose: () => void
  /** Clears the search pin and resets search UI */
  onClear: () => void
}) {
  const stableClose = useCallback(() => onClose(), [onClose])
  const { requestClose, sheetClassName } = useSheetClose(stableClose)
  const links = navLinks(location.lat, location.lng)
  const coords = formatCoords(location.lat, location.lng)

  return (
    <div
      className={`${sheetClassName} absolute inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4`}
      role="dialog"
      aria-modal="true"
      aria-label={location.name}
    >
      <div className="mx-auto max-w-lg overflow-hidden rounded-[1.75rem] border border-black/5 bg-white/92 shadow-[0_16px_48px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <div className="flex justify-center pt-2.5 pb-1">
          <button
            type="button"
            onClick={requestClose}
            className="flex w-full justify-center py-1"
            aria-label="Sulge"
          >
            <span className="h-1 w-9 rounded-full bg-black/15" />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pt-1 pb-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
              Valitud asukoht
            </p>
            <h3 className="mt-1 text-[22px] leading-tight font-bold tracking-tight text-[#1C1C1E]">
              {location.name}
            </h3>
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-[#636366]">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#007AFF]" />
              <span>{location.label}</span>
            </p>
            <p className="mt-2 font-mono text-[12px] font-semibold tracking-wide text-[#8E8E93]">
              {coords}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F2F2F7] text-[#8E8E93] transition active:scale-95"
            aria-label="Sulge"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 px-5 pb-3">
          <p className="text-[11px] font-semibold tracking-wide text-[#8E8E93] uppercase">
            Navigate To
          </p>
          <div className="grid grid-cols-3 gap-2">
            <a
              href={links.waze}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#33CCFF] px-2 py-4 text-center shadow-sm transition active:scale-[0.98]"
            >
              <Navigation className="h-5 w-5 text-[#053B4A]" strokeWidth={2.5} />
              <span className="text-[13px] font-bold text-[#053B4A]">Waze</span>
            </a>
            <a
              href={links.google}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#4285F4] px-2 py-4 text-center shadow-sm transition active:scale-[0.98]"
            >
              <MapPin className="h-5 w-5 text-white" strokeWidth={2.5} />
              <span className="text-[13px] font-bold text-white">Google Maps</span>
            </a>
            <button
              type="button"
              onClick={() => openAppleMaps(location.lat, location.lng)}
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#1C1C1E] px-2 py-4 text-center shadow-sm transition active:scale-[0.98]"
            >
              <MapPin className="h-5 w-5 text-white" strokeWidth={2.5} />
              <span className="text-[13px] font-bold text-white">Apple Maps</span>
            </button>
          </div>
          <p className="text-center text-[11px] text-[#8E8E93]">
            Avab Waze’i, Google Mapsi või Apple Mapsi koordinaatidega
          </p>
        </div>

        <div className="border-t border-black/5 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              onClear()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF3B30]/10 px-4 py-3.5 text-[15px] font-semibold text-[#D70015] transition active:scale-[0.99]"
          >
            <X className="h-4 w-4" />
            Clear Search / Close
          </button>
        </div>
      </div>
    </div>
  )
}
