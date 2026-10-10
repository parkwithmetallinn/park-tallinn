/**
 * Glassmorphic "Salvestatud parklad" panel — lists localStorage favorites.
 */

import { Star, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import { useFavorites } from '../hooks/useFavorites'
import { categoryPaintColor } from '../lib/parkingClassification'
import { spotDisplayName } from '../lib/parkingDisplayName'
import type { ParkingSpot } from '../types'
import { parkingPriceBadge } from './NearestParkingPanel'
import { InfoSidePanelShell } from './InfoSidePanel'

const EMPTY_COPY =
  'Sinu lemmikparklad ilmuvad siia. Vajuta tärnile, et salvestada.'

export function FavoritesPanel({
  spots,
  dark,
  onClose,
  onSelect,
}: {
  /** Known parking spots used to resolve favorite ids → display rows. */
  spots: ParkingSpot[]
  dark?: boolean
  onClose: () => void
  onSelect?: (spot: ParkingSpot) => void
}) {
  const { favoriteIds, isFavorite, toggleFavorite, clearFavorites, count } =
    useFavorites()

  const byId = useMemo(() => {
    const map = new Map<string, ParkingSpot>()
    for (const s of spots) map.set(s.id, s)
    return map
  }, [spots])

  /** Newest favorites first; keep unresolved ids as stubs. */
  const rows = useMemo(() => {
    const list = [...favoriteIds].reverse()
    return list.map((id) => {
      const spot = byId.get(id)
      return {
        id,
        spot: spot ?? null,
        name: spot ? spotDisplayName(spot) : id,
        price: spot ? parkingPriceBadge(spot) : '—',
        color: spot ? categoryPaintColor(spot) : '#8E8E93',
      }
    })
  }, [favoriteIds, byId])

  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const chipBg = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const rowBg = dark
    ? 'border-white/10 bg-white/6 hover:bg-white/10'
    : 'border-black/5 bg-white/70 hover:bg-white/95'

  return (
    <InfoSidePanelShell
      title="Salvestatud parklad"
      dark={dark}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <div data-testid="favorites-panel" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}
              >
                Lemmikparklad
              </p>
              <h2 className={`text-[17px] font-bold tracking-tight ${ink}`}>
                Salvestatud parklad
              </h2>
              <p className={`mt-0.5 text-[12px] ${muted}`}>
                {count === 0
                  ? 'Pole veel lemmikuid'
                  : `${count} ${count === 1 ? 'koht' : 'kohta'}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {count > 0 ? (
                <button
                  type="button"
                  data-testid="favorites-clear-all"
                  onClick={() => clearFavorites()}
                  className={`flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold transition active:scale-95 ${chipBg} ${muted}`}
                  aria-label="Kustuta kõik"
                  title="Kustuta kõik"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Kustuta kõik
                </button>
              ) : null}
              <button
                type="button"
                onClick={requestClose}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 ${chipBg} ${muted}`}
                aria-label="Sulge"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div
              data-testid="favorites-empty"
              className={`rounded-2xl px-4 py-8 text-center ${
                dark ? 'bg-white/5' : 'bg-[#F2F2F7]/80'
              }`}
            >
              <Star
                className={`mx-auto mb-3 h-8 w-8 ${muted}`}
                strokeWidth={1.5}
              />
              <p className={`text-[13px] leading-relaxed font-medium ${ink}`}>
                {EMPTY_COPY}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2" role="list">
              {rows.map((row) => {
                const favorited = isFavorite(row.id)
                return (
                  <li key={row.id}>
                    <div
                      className={`flex items-center gap-2 rounded-2xl border px-2.5 py-2 transition ${rowBg}`}
                    >
                      <button
                        type="button"
                        data-testid={`favorite-row-${row.id}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        onClick={() => {
                          if (row.spot) {
                            onSelect?.(row.spot)
                            requestClose()
                          }
                        }}
                        disabled={!row.spot}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-[13px] font-semibold ${ink}`}
                          >
                            {row.name}
                          </span>
                          <span
                            className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[12px] font-bold tracking-wide ${
                              dark
                                ? 'bg-white/10 text-[#EBEBF5]/80'
                                : 'bg-[#F2F2F7] text-[#636366]'
                            }`}
                          >
                            {row.price}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        data-testid={`favorite-star-${row.id}`}
                        onClick={() => toggleFavorite(row.id)}
                        className="tap-scale flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-95"
                        aria-label={
                          favorited
                            ? 'Eemalda lemmikutest'
                            : 'Lisa lemmikutesse'
                        }
                        aria-pressed={favorited}
                        title={
                          favorited
                            ? 'Eemalda lemmikutest'
                            : 'Lisa lemmikutesse'
                        }
                      >
                        <Star
                          className={`h-5 w-5 ${
                            favorited
                              ? 'fill-[#FFCC00] text-[#FFCC00]'
                              : muted
                          }`}
                          strokeWidth={favorited ? 0 : 1.75}
                        />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </InfoSidePanelShell>
  )
}
