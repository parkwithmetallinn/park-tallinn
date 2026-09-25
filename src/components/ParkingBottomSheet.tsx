import { MapPin, Navigation, X } from 'lucide-react'
import type { ParkingSpot } from '../types'
import { navLinks } from '../lib/geocode'
import { PARKING_LAYER_META } from '../map/parkingLayers'
import { streetLineColor } from '../map/streetLineTheme'

export function ParkingBottomSheet({
  spot,
  distanceLabel,
  onClose,
  onTimer,
}: {
  spot: ParkingSpot
  distanceLabel?: string | null
  onClose: () => void
  onTimer?: () => void
}) {
  const links = navLinks(spot.lat, spot.lng)
  const color =
    spot.line || spot.featureType === 'on-street-line'
      ? streetLineColor(spot)
      : (PARKING_LAYER_META[spot.layer]?.color ?? '#0B6E4F')
  const price =
    spot.price_per_hour > 0 ? `${spot.price_per_hour.toFixed(2)} €/h` : 'Tasuta'
  const free =
    spot.free_minutes > 0 ? `${spot.free_minutes} min tasuta` : null

  return (
    <div
      className="animate-slide-up absolute inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label={spot.name}
    >
      <div className="mx-auto max-w-lg overflow-hidden rounded-[1.75rem] border border-white/40 bg-white/80 shadow-[0_12px_40px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-lg px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase"
                style={{ backgroundColor: color }}
              >
                {spot.badge}
              </span>
              {distanceLabel ? (
                <span className="rounded-lg bg-sea/10 px-2 py-0.5 text-[11px] font-bold text-sea">
                  {distanceLabel}
                </span>
              ) : null}
            </div>
            <h3 className="truncate text-[17px] font-bold tracking-tight text-ink">
              {spot.name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-soft">
              <MapPin className="h-3 w-3 shrink-0 opacity-60" />
              {spot.address}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-ink/5 p-2 text-ink-soft transition hover:bg-ink/10"
            aria-label="Sulge"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1 px-5 pb-3 text-xs text-ink-soft">
          <p className="font-semibold text-moss">
            {spot.operator} · {spot.zone_code} · {price}
            {free ? ` · ${free}` : ''}
          </p>
          <p>{spot.timeLimit}</p>
          <p className="leading-relaxed text-ink-soft/90">{spot.desc}</p>
        </div>

        <div className="space-y-2 border-t border-ink/6 px-5 py-4">
          <p className="text-[10px] font-bold tracking-wider text-ink-soft uppercase">
            Navigeeri
          </p>
          <a
            href={links.waze}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-between rounded-2xl bg-[#33CCFF] px-4 py-3.5 text-sm font-bold text-[#053B4A] shadow-sm transition hover:brightness-105 active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <Navigation className="h-4 w-4" />
              Navigeeri Waze’iga
            </span>
            <span className="opacity-60">→</span>
          </a>
          <a
            href={links.google}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-between rounded-2xl bg-[#4285F4] px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Google Maps
            </span>
            <span className="opacity-70">→</span>
          </a>
          <a
            href={links.apple}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-between rounded-2xl bg-ink px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Apple Maps
            </span>
            <span className="opacity-70">→</span>
          </a>
          {spot.layer === 'timed' || spot.free_minutes > 0 ? (
            <button
              type="button"
              onClick={onTimer}
              className="mt-1 w-full rounded-2xl border border-sea/25 bg-sea/8 py-2.5 text-xs font-semibold text-sea transition hover:bg-sea/12"
            >
              Sea parkimiskella taimer
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
