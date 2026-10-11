import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { formatDistance } from '../lib/geo'
import {
  categoryPaintColor,
  getParkingFilterCategory,
  isClockLimitedParking,
  isUnclassifiedParking,
  isUnlimitedFreeParking,
} from '../lib/parkingClassification'
import {
  spotDisplayName,
  uniquifySpotDisplayNames,
} from '../lib/parkingDisplayName'
import type { NearestParkingOption } from '../lib/nearestParking'
import {
  balanceNearestParkingMix,
  filterOdavaimTasuta,
  sortByProximity,
} from '../lib/nearestParking'

/** Rows shown after filter + sort (pool itself is the full radius set). */
const NEAREST_DISPLAY_LIMIT = 15
import type { ParkingSpot } from '../types'
import { InfoSidePanelShell } from './InfoSidePanel'
import { formatHourlyRate, getLocale, tKey, useI18n } from '../i18n'

export type { NearestParkingOption }

type PanelFilter = 'all' | 'free' | 'clock' | 'paid'

const TAB_META: { id: PanelFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'nearest.all' },
  { id: 'free', labelKey: 'nearest.odavaim' },
  { id: 'clock', labelKey: 'nearest.kellaga' },
  { id: 'paid', labelKey: 'nearest.tasuline' },
]

/** ~1.4 m/s urban walking pace */
function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / 1.4 / 60))
}

export function parkingPriceBadge(spot: ParkingSpot): string {
  const locale = getLocale()
  const category = getParkingFilterCategory(spot)
  if (category === 'free') return tKey('badge.free', undefined, locale)
  if (category === 'timed') {
    const mins = Math.max(1, Math.round(spot.free_minutes || 15))
    return `${mins} ${tKey('badge.min', undefined, locale)}`
  }
  if (category === 'paid') {
    if (spot.price_per_hour > 0) {
      return (
        formatHourlyRate(spot.price_per_hour, locale) ||
        `${spot.price_per_hour.toFixed(2)} €/h`
      )
    }
    if (spot.zone_code && spot.zone_code !== 'ZONE') return spot.zone_code
    return tKey('badge.paid', undefined, locale)
  }
  if (isUnclassifiedParking(spot)) return tKey('badge.unknown', undefined, locale)
  return '—'
}

/** Compact map pill label (no numbers 1/2/3 — price/type only). */
export function parkingMapPillLabel(spot: ParkingSpot): string {
  if (isUnlimitedFreeParking(spot)) return tKey('badge.free', undefined, getLocale())
  if (isClockLimitedParking(spot)) {
    const mins = Math.max(1, Math.round(spot.free_minutes || 15))
    // Narrow no-break space keeps "15 MIN" from gluing to nearby zone glyphs
    return `${mins}\u00A0${tKey('badge.min', undefined, getLocale())}`
  }
  if (
    isUnclassifiedParking({
      layer: spot.layer,
      price_per_hour: spot.price_per_hour,
      free_minutes: spot.free_minutes,
      zone_code: spot.zone_code,
      operator: spot.operator,
      verified_free: spot.layer === 'free_street',
      type: spot.type,
      timeLimit: spot.timeLimit,
      name: spot.name,
      desc: spot.desc,
      badge: spot.badge,
    })
  ) {
    return tKey('badge.unknown', undefined, getLocale())
  }
  if (spot.price_per_hour > 0) {
    return formatHourlyRate(spot.price_per_hour, getLocale()) || `${spot.price_per_hour.toFixed(2)} €/h`
  }
  return tKey('badge.paid', undefined, getLocale())
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
  const category = getParkingFilterCategory(spot)
  if (category === 'free') {
    return dark
      ? 'bg-[#00FF00]/25 text-[#86EFAC]'
      : 'bg-[#00FF00]/15 text-[#15803D]'
  }
  if (category === 'timed') {
    return dark
      ? 'bg-[#FFCC00]/20 text-[#FFCC00]'
      : 'bg-[#FFCC00]/25 text-[#8A6D00]'
  }
  if (category === 'paid') {
    return dark
      ? 'bg-[#FF0000]/25 text-[#FCA5A5]'
      : 'bg-[#FF0000]/12 text-[#D70015]'
  }
  return dark ? 'bg-white/10 text-[#98989D]' : 'bg-[#F2F2F7] text-[#636366]'
}

function applyPanelFilter(
  options: NearestParkingOption[],
  filter: PanelFilter,
): NearestParkingOption[] {
  // Filter the full radius pool first, then sort — display cap is applied later.
  // free / clock / paid use the same exclusive getParkingFilterCategory buckets
  // as the map chips (Odavaim/Tasuta may still fall back to cheapest paid).
  if (filter === 'free') {
    return filterOdavaimTasuta(options)
  }
  if (filter === 'clock') {
    return sortByProximity(
      options.filter((o) => getParkingFilterCategory(o.spot) === 'timed'),
    )
  }
  if (filter === 'paid') {
    return sortByProximity(
      options.filter((o) => getParkingFilterCategory(o.spot) === 'paid'),
    )
  }
  // Kõik — do NOT pure-distance sort then slice: dense Kellaga would fill all 15.
  // Interleave nearest free / timed / paid (then other) for a mixed list.
  return balanceNearestParkingMix(options, NEAREST_DISPLAY_LIMIT)
}

export function NearestParkingPanel({
  targetName,
  options,
  dark,
  selectedPreviewId,
  onPreview,
  onConfirm,
  onClose,
  onVisibleOptionsChange,
  onWidenRadius,
  canWidenRadius,
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
  /** Filtered option keys currently shown (for map pills / focus sync). */
  onVisibleOptionsChange?: (optionKeys: string[]) => void
  /** Expand search radius when the active filter matches nothing nearby. */
  onWidenRadius?: () => void
  canWidenRadius?: boolean
}) {
  const { t } = useI18n()
  const TABS = TAB_META.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))
  const [filter, setFilter] = useState<PanelFilter>('all')
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  const filterTouchedRef = useRef(false)
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const soft = dark ? 'text-[#EBEBF5]/80' : 'text-[#636366]'
  const chip = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'

  const filteredAll = useMemo(
    () => applyPanelFilter(options, filter),
    [options, filter],
  )

  const filtered = useMemo(
    () => filteredAll.slice(0, NEAREST_DISPLAY_LIMIT),
    [filteredAll],
  )

  const displayNames = useMemo(
    () => uniquifySpotDisplayNames(filtered.map((o) => o.spot)),
    [filtered],
  )

  // Tell parent which keys are visible so map pills match the filter
  useEffect(() => {
    onVisibleOptionsChange?.(filtered.map((o) => o.optionKey))
  }, [filtered, onVisibleOptionsChange])

  // Filter change → focus closest matching spot + route preview
  useEffect(() => {
    if (!filterTouchedRef.current) return
    const top = filtered[0]
    if (top) onPreview(top.optionKey)
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps -- only on filter tab change

  // If current preview is outside the filtered set, snap to closest match
  useEffect(() => {
    if (filtered.length === 0) return
    if (
      selectedPreviewId &&
      filtered.some((o) => o.optionKey === selectedPreviewId)
    ) {
      return
    }
    onPreview(filtered[0]!.optionKey)
  }, [filtered, selectedPreviewId, onPreview])

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
      filtered.find((o) => o.optionKey === selectedPreviewId)?.spot ??
      options.find((o) => o.optionKey === selectedPreviewId)?.spot ??
      null
    )
  }, [selectedPreviewId, filtered, options])

  return (
    <InfoSidePanelShell
      title={t("nearest.title")}
      dark={dark}
      onClose={onClose}
      variant="compact"
    >
      {({ requestClose }) => (
        <div data-testid="nearest-parking-panel">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}
              >
                {t("nearest.title")}
              </p>
              <h3 className={`mt-0.5 text-[15px] font-bold tracking-tight ${ink}`}>
                {t("nearest.subtitle")}
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
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className="mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label={t("nearest.filterAria")}
          >
            {TABS.map((tab) => {
              const active = filter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    filterTouchedRef.current = true
                    setFilter(tab.id)
                  }}
                  className={`tap-scale shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
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

          {filteredAll.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className={`text-center text-[13px] font-medium ${muted}`}>
                {t('nearest.emptyFilter')}
              </p>
              {canWidenRadius && onWidenRadius ? (
                <button
                  type="button"
                  data-testid="nearest-widen-radius"
                  onClick={onWidenRadius}
                  className="tap-scale rounded-xl bg-[#007AFF] px-3 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.98]"
                >
                  {t('nearest.widenRadius')}
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-1.5" role="listbox" aria-label={t("nearest.listAria")}>
              {filtered.map(({ spot, distanceM, optionKey }) => {
                const active = selectedPreviewId === optionKey
                const badge = parkingPriceBadge(spot)
                const walk = walkMinutes(distanceM)
                return (
                  <li
                    key={optionKey}
                    ref={(node) => {
                      if (node) cardRefs.current.set(optionKey, node)
                      else cardRefs.current.delete(optionKey)
                    }}
                  >
                    <div
                      role="option"
                      aria-selected={active}
                      aria-label={`${displayNames.get(spot.id) ?? spotDisplayName(spot)}, ${badge}`}
                      tabIndex={0}
                      data-testid={`nearest-parking-card-${optionKey}`}
                      onClick={() => onPreview(optionKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onPreview(optionKey)
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
                              {displayNames.get(spot.id) ?? spotDisplayName(spot)}
                            </span>
                            <span
                              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-bold tracking-wide ${badgeTone(spot, dark)}`}
                            >
                              {badge}
                            </span>
                          </span>
                          <span
                            className={`mt-0.5 block text-[12px] font-medium ${muted}`}
                          >
                            {formatDistance(distanceM)}
                            {' · '}
                            {t('nearest.walkMin', { n: walk })}
                            {spot.zone_code && spot.zone_code !== 'ZONE'
                              ? ` · ${spot.zone_code}`
                              : ''}
                            {isUnclassifiedParking(spot)
                              ? ` · ${t('nearest.checkOnSite')}`
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
                          {t("nearest.choose")}
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
              {t("nearest.choose")}
            </button>
          ) : null}
        </div>
      )}
    </InfoSidePanelShell>
  )
}
