/**
 * “Lemmikud & Asukohad” — local favorites + Home / Work (Waze-style).
 * All state is device-local (localStorage); no network.
 */

import { Briefcase, Heart, Home, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import { useFavorites } from '../hooks/useFavorites'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { categoryPaintColor } from '../lib/parkingClassification'
import { spotDisplayName } from '../lib/parkingDisplayName'
import type { SavedPlace, SavedPlaceKind } from '../utils/favorites'
import type { ParkingSpot } from '../types'
import { parkingPriceBadge } from './NearestParkingPanel'
import { InfoSidePanelShell } from './InfoSidePanel'
import { useI18n } from '../i18n'

export type DraftPlace = {
  lat: number
  lng: number
  name: string
  address?: string
  label?: string
}

export function FavoritesPanel({
  spots,
  dark,
  draftLocation,
  onClose,
  onSelect,
  onSelectPlace,
}: {
  /** Known parking spots used to resolve favorite ids → display rows. */
  spots: ParkingSpot[]
  dark?: boolean
  /** Current search destination — used to set Home / Work. */
  draftLocation?: DraftPlace | null
  onClose: () => void
  onSelect?: (spot: ParkingSpot) => void
  /** Jump to a saved Home / Work place. */
  onSelectPlace?: (place: SavedPlace & { kind: SavedPlaceKind }) => void
}) {
  const { t } = useI18n()
  const { favoriteIds, isFavorite, toggleFavorite, clearFavorites, count } =
    useFavorites()
  const { home, work, setHome, setWork, clearHome, clearWork } =
    useSavedPlaces()

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
  const soft = dark ? 'text-[#EBEBF5]/80' : 'text-[#636366]'
  const chipBg = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const rowBg = dark
    ? 'border-white/10 bg-white/6 hover:bg-white/10'
    : 'border-black/5 bg-white/70 hover:bg-white/95'

  const applyDraft = (kind: SavedPlaceKind) => {
    if (!draftLocation) return
    const payload = {
      lat: draftLocation.lat,
      lng: draftLocation.lng,
      name: draftLocation.name,
      address: draftLocation.address || draftLocation.label || '',
      label: draftLocation.label,
    }
    if (kind === 'home') setHome(payload)
    else setWork(payload)
  }

  const renderPlaceCard = (
    kind: SavedPlaceKind,
    place: SavedPlace | null,
  ) => {
    const Icon = kind === 'home' ? Home : Briefcase
    const title = kind === 'home' ? t('places.home') : t('places.work')
    const empty =
      kind === 'home' ? t('places.homeEmpty') : t('places.workEmpty')
    const setLabel = kind === 'home' ? t('places.setHome') : t('places.setWork')
    const clearLabel =
      kind === 'home' ? t('places.clearHome') : t('places.clearWork')

    return (
      <div
        key={kind}
        data-testid={`saved-place-${kind}`}
        className={`rounded-2xl border px-3 py-2.5 ${rowBg}`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${chipBg}`}
            aria-hidden
          >
            <Icon className={`h-4 w-4 ${ink}`} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-[12px] font-semibold uppercase tracking-wide ${muted}`}>
              {title}
            </p>
            {place ? (
              <>
                <p className={`truncate text-[14px] font-bold ${ink}`}>
                  {place.name}
                </p>
                {place.address ? (
                  <p className={`mt-0.5 line-clamp-2 text-[12px] ${soft}`}>
                    {place.address}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-testid={`go-place-${kind}`}
                    onClick={() => onSelectPlace?.({ ...place, kind })}
                    className="tap-scale rounded-full bg-[#007AFF] px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-95"
                  >
                    {t('places.go')}
                  </button>
                  <button
                    type="button"
                    data-testid={`clear-place-${kind}`}
                    onClick={() =>
                      kind === 'home' ? clearHome() : clearWork()
                    }
                    className={`tap-scale rounded-full px-3 py-1.5 text-[12px] font-semibold transition active:scale-95 ${chipBg} ${muted}`}
                    aria-label={clearLabel}
                  >
                    {clearLabel}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={`text-[13px] font-medium ${soft}`}>{empty}</p>
                <button
                  type="button"
                  data-testid={`set-place-${kind}`}
                  disabled={!draftLocation}
                  onClick={() => applyDraft(kind)}
                  className={`tap-scale mt-2 rounded-full px-3 py-1.5 text-[12px] font-bold transition active:scale-95 disabled:opacity-40 ${
                    draftLocation
                      ? 'bg-[#007AFF] text-white'
                      : `${chipBg} ${muted}`
                  }`}
                >
                  {draftLocation ? t('places.setFromSearch') : setLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <InfoSidePanelShell
      title={t('places.title')}
      dark={dark}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <div data-testid="favorites-panel" className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}
              >
                {t('places.eyebrow')}
              </p>
              <h2 className={`text-[17px] font-bold tracking-tight ${ink}`}>
                {t('places.title')}
              </h2>
              <p className={`mt-0.5 text-[12px] ${muted}`}>
                {count === 0
                  ? t('places.noneYet')
                  : count === 1
                    ? t('places.countOne')
                    : t('places.countMany', { n: count })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {count > 0 ? (
                <button
                  type="button"
                  data-testid="favorites-clear-all"
                  onClick={() => clearFavorites()}
                  className={`flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold transition active:scale-95 ${chipBg} ${muted}`}
                  aria-label={t('places.clearAll')}
                  title={t('places.clearAll')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('places.clearAll')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={requestClose}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 ${chipBg} ${muted}`}
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <section aria-label={t('places.locations')} className="space-y-2">
            <h3
              className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}
            >
              {t('places.locations')}
            </h3>
            {renderPlaceCard('home', home)}
            {renderPlaceCard('work', work)}
            {!draftLocation && !home && !work ? (
              <p className={`text-[12px] leading-relaxed ${soft}`}>
                {t('places.needSearch')}
              </p>
            ) : null}
          </section>

          <section aria-label={t('places.favorites')} className="space-y-2">
            <h3
              className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}
            >
              {t('places.favorites')}
            </h3>

            {rows.length === 0 ? (
              <div
                data-testid="favorites-empty"
                className={`rounded-2xl px-4 py-8 text-center ${
                  dark ? 'bg-white/5' : 'bg-[#F2F2F7]/80'
                }`}
              >
                <Heart
                  className={`mx-auto mb-3 h-8 w-8 ${muted}`}
                  strokeWidth={1.5}
                />
                <p className={`text-[13px] leading-relaxed font-medium ${ink}`}>
                  {t('places.emptyFavorites')}
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
                              ? t('places.removeFavorite')
                              : t('places.addFavorite')
                          }
                          aria-pressed={favorited}
                          title={
                            favorited
                              ? t('places.removeFavorite')
                              : t('places.addFavorite')
                          }
                        >
                          <Heart
                            className={`h-5 w-5 ${
                              favorited
                                ? 'fill-[#FF2D55] text-[#FF2D55]'
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
          </section>
        </div>
      )}
    </InfoSidePanelShell>
  )
}
