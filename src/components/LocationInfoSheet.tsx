import { Loader2, MapPin, Navigation, X } from 'lucide-react'
import {
  formatCoords,
  navLinks,
  openAppleMaps,
  type SearchLocation,
} from '../lib/geocode'
import { InfoSidePanelShell } from './InfoSidePanel'

export function LocationInfoSheet({
  location,
  dark,
  onClose,
  onClear,
  onStartRoute,
  routeLoading,
}: {
  location: SearchLocation
  dark?: boolean
  onClose: () => void
  /** Clears the search pin and resets search UI */
  onClear: () => void
  onStartRoute?: () => void
  routeLoading?: boolean
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
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${chip} ${muted}`}
              aria-label="Sulge"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {onStartRoute ? (
            <button
              type="button"
              onClick={onStartRoute}
              disabled={routeLoading}
              aria-label="Marsruut"
              className="tap-scale mb-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-3 py-2.5 text-[14px] font-semibold text-white disabled:opacity-55"
            >
              {routeLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" strokeWidth={2.5} />
              )}
              Marsruut
            </button>
          ) : null}

          <p className={`mb-1.5 text-[10px] font-semibold tracking-wide uppercase ${muted}`}>
            Navigeeri
          </p>
          <div className="mb-2.5 grid grid-cols-3 gap-1.5">
            <a
              href={links.waze}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#33CCFF] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <Navigation className="h-4 w-4 text-[#053B4A]" strokeWidth={2.5} />
              <span className="text-[11px] font-bold text-[#053B4A]">Waze</span>
            </a>
            <a
              href={links.google}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#4285F4] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4 text-white" strokeWidth={2.5} />
              <span className="text-[11px] font-bold text-white">Google</span>
            </a>
            <button
              type="button"
              onClick={() => openAppleMaps(location.lat, location.lng)}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#1C1C1E] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4 text-white" strokeWidth={2.5} />
              <span className="text-[11px] font-bold text-white">Apple</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onClear()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF3B30]/10 px-3 py-2.5 text-[12px] font-semibold text-[#D70015] transition active:scale-[0.99]"
          >
            <X className="h-3.5 w-3.5" />
            Tühjenda otsing
          </button>
        </>
      )}
    </InfoSidePanelShell>
  )
}
