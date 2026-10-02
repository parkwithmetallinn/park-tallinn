import { Bolt, MapPin, X, Zap } from 'lucide-react'
import { navLinks, openAppleMaps } from '../lib/geocode'
import {
  EV_COLOR_BLUE,
  EV_COLOR_CYAN,
  type EvChargerFeature,
} from '../lib/evChargers'
import { InfoSidePanelShell } from './InfoSidePanel'

export function EvChargerSheet({
  feature,
  dark,
  onClose,
}: {
  feature: EvChargerFeature
  dark?: boolean
  onClose: () => void
}) {
  const p = feature.properties
  const [lng, lat] = feature.geometry.coordinates
  const links = navLinks(lat, lng)
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const soft = dark ? 'text-[#EBEBF5]/80' : 'text-[#636366]'
  const chip = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const free = p.feeKind === 'free'

  const powerBits = [
    p.maxPowerKw ? `${p.maxPowerKw} kW` : null,
    p.capacity != null && String(p.capacity) !== ''
      ? `${p.capacity} kohta`
      : null,
    ...p.sockets,
  ].filter(Boolean) as string[]

  return (
    <InfoSidePanelShell title={p.name} dark={dark} onClose={onClose}>
      {({ requestClose }) => (
        <div data-testid="ev-charger-sheet">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-[#042F2E]"
                  style={{
                    background: `linear-gradient(135deg, ${EV_COLOR_CYAN}, ${EV_COLOR_BLUE})`,
                  }}
                >
                  <Bolt className="h-3 w-3" strokeWidth={2.6} />
                  EV
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${
                    free
                      ? dark
                        ? 'bg-[#00FF00]/20 text-[#86EFAC]'
                        : 'bg-[#00FF00]/15 text-[#15803D]'
                      : dark
                        ? 'bg-[#FF0000]/20 text-[#FCA5A5]'
                        : 'bg-[#FF0000]/12 text-[#D70015]'
                  }`}
                >
                  {p.priceLabel}
                </span>
              </div>
              <h3 className={`text-[16px] font-bold tracking-tight ${ink}`}>
                {p.name}
              </h3>
              <p className={`mt-0.5 text-[13px] font-semibold ${soft}`}>
                {p.operator}
              </p>
              {p.address ? (
                <p className={`mt-1.5 flex items-start gap-1.5 text-[12px] ${muted}`}>
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0284C7]" />
                  <span>{p.address}</span>
                </p>
              ) : null}
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

          {powerBits.length > 0 ? (
            <div
              className={`mb-3 rounded-2xl border px-3.5 py-3 ${
                dark
                  ? 'border-[#00F0FF]/25 bg-[#00F0FF]/10'
                  : 'border-[#0284C7]/20 bg-[#E0F2FE]/70'
              }`}
            >
              <p
                className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-wide uppercase ${
                  dark ? 'text-[#67E8F9]' : 'text-[#0284C7]'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                Võimsus / pistikud
              </p>
              <div className="flex flex-wrap gap-1.5">
                {powerBits.map((bit) => (
                  <span
                    key={bit}
                    className={`rounded-lg px-2 py-1 text-[12px] font-bold ${
                      dark
                        ? 'bg-[#0C4A6E]/60 text-[#E0F2FE]'
                        : 'bg-white/90 text-[#0C4A6E]'
                    }`}
                  >
                    {bit}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {p.opening_hours ? (
            <p className={`mb-3 text-[12px] font-medium ${muted}`}>
              Lahtiolekuajad: {p.opening_hours}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <a
              href={links.waze}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-scale flex flex-col items-center justify-center gap-1 rounded-2xl bg-[#33CCFF] px-2 py-3 text-[12px] font-bold text-white"
            >
              Waze
            </a>
            <a
              href={links.google}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-scale flex flex-col items-center justify-center gap-1 rounded-2xl bg-[#4285F4] px-2 py-3 text-[12px] font-bold text-white"
            >
              Google
            </a>
            <button
              type="button"
              onClick={() => openAppleMaps(lat, lng)}
              className="tap-scale flex flex-col items-center justify-center gap-1 rounded-2xl bg-[#1C1C1E] px-2 py-3 text-[12px] font-bold text-white"
            >
              Apple
            </button>
          </div>

          {p.website ? (
            <a
              href={p.website}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 block text-center text-[12px] font-semibold ${
                dark ? 'text-[#67E8F9]' : 'text-[#0284C7]'
              }`}
            >
              Ava operaatori leht
            </a>
          ) : null}
        </div>
      )}
    </InfoSidePanelShell>
  )
}
