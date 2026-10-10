import {
  Flag,
  MapPin,
  Navigation,
  RefreshCw,
  Square,
  Star,
  X,
} from 'lucide-react'
import { FullIndicator } from './FullIndicator'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react'
import type { ActiveParkingSession } from '../lib/parkingSession'
import { formatHourlyRate, formatSessionInstant } from '../lib/parkingSession'
import { getCachedAddress } from '../lib/addressCache'
import type { AlternativeParking } from '../lib/alternatives'
import { formatDistance } from '../lib/geo'
import { isRealAddress } from '../lib/isRealAddress'
import {
  formatSpotAddressLine,
  MISSING_ADDRESS,
  resolveSpotAddress,
} from '../lib/resolveSpotAddress'
import {
  canStartParkingSession,
  sessionStartDisabledHint,
} from '../data/zones'
import type { ParkingSpot } from '../types'
import { formatFreeUntil } from '../lib/freeRules'
import { navLinks, openAppleMaps } from '../lib/geocode'
import { track } from '../lib/analytics'
import {
  categoryBadgeLabel,
  categoryPaintColor,
  clockFreeHeadline,
  isClockLimitedParking,
  isUnclassifiedParking,
  isUnlimitedFreeParking,
} from '../lib/parkingClassification'
import { spotDisplayName } from '../lib/parkingDisplayName'
import { formatDuration } from '../lib/routing'
import { streetLineColor } from '../map/streetLineTheme'
import { FindParkingActions } from './FindParkingActions'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { InfoSidePanelShell } from './InfoSidePanel'
import { TypeMapWidget } from './TypeMapWidget'
import { useI18n } from '../i18n'

export type PanelRouteSummary = {
  label: string
  driveDistanceM: number
  driveDurationS: number
  walkDistanceM?: number
  walkDurationS?: number
  walkIsFallback?: boolean
  longWalk?: boolean
}

function blockNav(e: MouseEvent | FormEvent) {
  e.preventDefault()
  e.stopPropagation()
}

function priceSummary(spot: ParkingSpot): { headline: string; detail: string } {
  // Kellaga: explicit clock-limited free window — never "Määramata ZONE"
  if (isClockLimitedParking(spot)) {
    return {
      headline: clockFreeHeadline(spot.free_minutes || 15),
      detail:
        spot.timeLimit && !/Määramata/i.test(spot.timeLimit)
          ? spot.timeLimit
          : 'Parkimiskellaga / Ajapiiranguga',
    }
  }
  // Tasuta: unlimited free, no clock — never treat paid/municipal as free
  if (isUnlimitedFreeParking(spot)) {
    return {
      headline: 'Tasuta',
      detail: spot.timeLimit || 'Piiramatu · kellata',
    }
  }
  // Paid zone with a short free grace (still Tasuline)
  if (spot.free_minutes > 0 && spot.price_per_hour > 0) {
    return {
      headline: `${spot.free_minutes} min tasuta`,
      detail: `edasi ${spot.price_per_hour.toFixed(2)} €/h`,
    }
  }
  if (spot.price_per_hour > 0) {
    return {
      headline: `${spot.price_per_hour.toFixed(2)} €/h`,
      detail: spot.timeLimit || spot.operator,
    }
  }
  return {
    headline: 'Hind teadmata',
    detail: spot.operator || 'Kontrolli silti kohapeal',
  }
}

export function ParkingBottomSheet({
  spot,
  distanceLabel,
  sessionLoading,
  sessionAction,
  activeSession,
  sessionNotice,
  priceEstimate,
  routeSummary,
  onClearRoute,
  dark,
  onClose,
  onBackToList,
  onStartSession,
  onStopSession,
  onCheckStatus,
  onExtendMinutes,
  onReportInvalid,
  alternatives = [],
  noAlternatives = false,
  isFull = false,
  communityReportLabel = null,
  reportCooldownActive = false,
  onFindAnother,
  onMarkFull,
  onReportOther,
  onWidenRadius,
  onSelectAlternative,
  isFavorite = false,
  onToggleFavorite,
}: {
  spot: ParkingSpot
  distanceLabel?: string | null
  sessionLoading?: boolean
  sessionAction?: 'start' | 'stop' | 'status' | 'extend' | null
  activeSession?: ActiveParkingSession | null
  sessionNotice?: { kind: 'success' | 'error' | 'info' | 'loading'; text: string } | null
  /** Live price estimate while session is active (hinnang, mitte arve). */
  priceEstimate?: string | null
  /** Drive/walk summary lives in the panel — never floats over filter pills. */
  routeSummary?: PanelRouteSummary | null
  onClearRoute?: () => void
  dark?: boolean
  onClose: () => void
  /** Return to nearest-parking picker (2-step search flow). */
  onBackToList?: () => void
  onStartSession: () => void
  onStopSession: () => void
  onCheckStatus: () => void
  onExtendMinutes?: (minutes: number) => void
  /** Crowdsource: queue REPORT_INVALID (does not mutate GeoJSON). */
  onReportInvalid?: () => void
  alternatives?: AlternativeParking[]
  noAlternatives?: boolean
  isFull?: boolean
  /** e.g. "Kogukonna raport: Täis (5 min tagasi)" */
  communityReportLabel?: string | null
  /** Local 5-min cooldown after submitting a report for this lot. */
  reportCooldownActive?: boolean
  onFindAnother?: () => void
  onMarkFull?: () => void
  /** Detailed report modal (not one-tap full). */
  onReportOther?: () => void
  onWidenRadius?: () => void
  onSelectAlternative?: (spot: ParkingSpot) => void
  /** Lemmikparkla — filled yellow star when saved. */
  isFavorite?: boolean
  onToggleFavorite?: () => void
}) {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const sessionNetBlocked = !online
  const links = navLinks(spot.lat, spot.lng)
  const color =
    spot.line || spot.featureType === 'on-street-line'
      ? streetLineColor(spot)
      : categoryPaintColor(spot)
  const pricing = priceSummary(spot)
  const unclassified = isUnclassifiedParking({
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
  const categoryBadge = categoryBadgeLabel(spot)
  const hasActive = Boolean(activeSession?.zone)
  const startedLabel = formatSessionInstant(activeSession?.startedAt)
  const title = `${spot.zone_code} — ${spotDisplayName(spot)}`

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(() => {
    const cached = getCachedAddress(spot.id)
    if (cached?.address) {
      return formatSpotAddressLine(cached.address, cached.source)
    }
    if (isRealAddress(spot.address, { name: spot.name, code: spot.zone_code })) {
      return spot.address.trim()
    }
    return null
  })
  const [addressLoading, setAddressLoading] = useState(
    () => !getCachedAddress(spot.id) && !isRealAddress(spot.address, {
      name: spot.name,
      code: spot.zone_code,
    }),
  )
  const [copiedHint, setCopiedHint] = useState(false)
  const longPressTimer = useRef<number | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    const cached = getCachedAddress(spot.id)
    if (cached?.address) {
      setResolvedAddress(formatSpotAddressLine(cached.address, cached.source))
      setAddressLoading(false)
      return () => ac.abort()
    }
    if (isRealAddress(spot.address, { name: spot.name, code: spot.zone_code })) {
      setResolvedAddress(spot.address.trim())
      setAddressLoading(false)
    } else {
      setResolvedAddress(null)
      setAddressLoading(true)
    }
    setCopiedHint(false)

    void resolveSpotAddress(spot, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setResolvedAddress(formatSpotAddressLine(r.address, r.source))
        setAddressLoading(false)
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError' || ac.signal.aborted) return
        setResolvedAddress(MISSING_ADDRESS)
        setAddressLoading(false)
      })

    return () => {
      ac.abort()
      if (longPressTimer.current) {
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }, [spot])

  const copyAddress = useCallback(async () => {
    const text = resolvedAddress?.trim()
    if (!text || text === MISSING_ADDRESS) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedHint(true)
      window.setTimeout(() => setCopiedHint(false), 1600)
    } catch {
      /* ignore clipboard failures */
    }
  }, [resolvedAddress])

  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const ink = dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'
  const soft = dark ? 'text-[#EBEBF5]/75' : 'text-[#636366]'
  const chipBg = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const blockBg = dark ? 'bg-white/8' : 'bg-[#F2F2F7]'

  return (
    <InfoSidePanelShell title={title} dark={dark} onClose={onClose}>
      {({ requestClose }) => (
        <>
        {onBackToList ? (
          <button
            type="button"
            data-testid="back-to-nearest-list"
            onClick={onBackToList}
            className={`mb-2.5 flex min-h-10 w-full cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition active:scale-[0.99] ${
              dark
                ? 'bg-white/10 text-[#0A84FF] hover:bg-white/14'
                : 'bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/14'
            }`}
          >
            <span aria-hidden>←</span>
            Tagasi nimekirja
          </button>
        ) : null}

        {routeSummary ? (
          <div
            data-testid="route-summary"
            className={`mb-2.5 rounded-xl px-3 py-2.5 ${blockBg}`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <p className={`truncate text-[12px] font-bold ${ink}`}>
                  {routeSummary.label}
                </p>
                {routeSummary.driveDistanceM > 0 ||
                routeSummary.driveDurationS > 0 ? (
                  <p className="text-[12px] font-semibold text-[#007AFF]">
                    Autoga · {formatDistance(routeSummary.driveDistanceM)}
                    {' · '}
                    {formatDuration(routeSummary.driveDurationS)}
                  </p>
                ) : null}
                {routeSummary.walkDistanceM != null &&
                routeSummary.walkDurationS != null ? (
                  <p
                    className={`flex flex-wrap items-center gap-1.5 text-[12px] font-semibold ${
                      routeSummary.walkIsFallback ? muted : 'text-[#FF9500]'
                    }`}
                  >
                    <span>
                      {routeSummary.walkIsFallback
                        ? 'Ligikaudne jalutuskäik'
                        : 'Jalgsi'}{' '}
                      · {formatDistance(routeSummary.walkDistanceM)}
                      {' · '}
                      {formatDuration(routeSummary.walkDurationS)}
                    </span>
                    {routeSummary.longWalk ? (
                      <span className="rounded-md bg-[#FF9500]/15 px-1.5 py-0.5 text-[12px] font-bold text-[#C93400]">
                        Pikk jalutuskäik
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <p className={`text-[12px] font-medium ${muted}`}>
                  Kokku ~{' '}
                  {formatDuration(
                    routeSummary.driveDurationS +
                      (routeSummary.walkDurationS ?? 0),
                  )}
                </p>
              </div>
              {onClearRoute ? (
                <button
                  type="button"
                  onClick={onClearRoute}
                  className={`tap-scale flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${chipBg} ${muted}`}
                  aria-label={t('chrome.hideRoute')}
                  title="Peida marsruut"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-[12px] font-bold tracking-wide text-white"
                style={{ backgroundColor: color }}
                data-testid="category-badge"
              >
                {categoryBadge}
              </span>
              {distanceLabel ? (
                <span className="rounded-full bg-[#007AFF]/10 px-2.5 py-0.5 text-[12px] font-semibold text-[#007AFF]">
                  {distanceLabel}
                </span>
              ) : null}
              {hasActive ? (
                <span className="rounded-full bg-[#34C759]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#248A3D]">
                  Aktiivne
                </span>
              ) : null}
              {isFull ? <FullIndicator variant="chip" /> : null}
            </div>
            {communityReportLabel ? (
              <p
                data-testid="community-report-status"
                className={`mb-2 text-[12px] font-semibold leading-snug ${
                  isFull
                    ? 'text-[#C62828]'
                    : communityReportLabel.includes('Vabu')
                      ? 'text-[#1B7A36]'
                      : muted
                }`}
              >
                {communityReportLabel}
              </p>
            ) : null}
            <div className="flex min-w-0 items-start gap-1.5">
              <h3
                className={`min-w-0 flex-1 truncate text-base leading-snug font-bold tracking-tight sm:text-lg ${ink}`}
                title={spotDisplayName(spot)}
              >
                {spotDisplayName(spot)}
              </h3>
              {onToggleFavorite ? (
                <button
                  type="button"
                  data-testid="favorite-toggle"
                  onClick={onToggleFavorite}
                  className="tap-scale -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95"
                  aria-label={
                    isFavorite ? 'Eemalda lemmikutest' : 'Lisa lemmikutesse'
                  }
                  aria-pressed={isFavorite}
                  title={
                    isFavorite ? 'Eemalda lemmikutest' : 'Lisa lemmikutesse'
                  }
                >
                  <Star
                    className={`h-5 w-5 ${
                      isFavorite
                        ? 'fill-[#FFCC00] text-[#FFCC00]'
                        : muted
                    }`}
                    strokeWidth={isFavorite ? 0 : 1.75}
                  />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="spot-address"
              title={
                resolvedAddress && resolvedAddress !== MISSING_ADDRESS
                  ? 'Kopeeri aadress'
                  : undefined
              }
              disabled={addressLoading || !resolvedAddress || resolvedAddress === MISSING_ADDRESS}
              onClick={() => void copyAddress()}
              onContextMenu={(e) => {
                e.preventDefault()
                void copyAddress()
              }}
              onPointerDown={() => {
                if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
                longPressTimer.current = window.setTimeout(() => {
                  void copyAddress()
                }, 480)
              }}
              onPointerUp={() => {
                if (longPressTimer.current) {
                  window.clearTimeout(longPressTimer.current)
                  longPressTimer.current = null
                }
              }}
              onPointerLeave={() => {
                if (longPressTimer.current) {
                  window.clearTimeout(longPressTimer.current)
                  longPressTimer.current = null
                }
              }}
              className={`mt-1 flex w-full min-w-0 items-center gap-1 truncate text-left text-[12px] ${muted} disabled:cursor-default`}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {addressLoading ? (
                <span
                  data-testid="spot-address-skeleton"
                  className="inline-block h-[14px] w-[min(100%,14rem)] max-w-full animate-pulse rounded bg-[#E5E5EA]"
                  aria-label={t('a11y.addressLoading')}
                />
              ) : (
                <span className="truncate">
                  {copiedHint ? 'Aadress kopeeritud' : resolvedAddress}
                </span>
              )}
            </button>
            {spot.featureType === 'on-street-line' || spot.kind === 'street' ? (
              <p className="mt-2 text-[12px] font-semibold text-[#636366]">
                Teeäärne tsoon · {spot.zone_code}
                {spot.free_minutes > 0 ? ` · +${spot.free_minutes} min` : ''}
                {spot.price_per_hour > 0
                  ? ` · ${spot.price_per_hour.toFixed(2)} €/h`
                  : spot.price_per_hour === 0 && spot.free_minutes === 0
                    ? ' · Tasuta'
                    : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            data-testid="detail-panel-close"
            onClick={requestClose}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${chipBg} ${muted}`}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {unclassified ? (
          <>
            <div
              data-testid="unclassified-warning"
              role="status"
              className={`mb-2.5 rounded-xl px-3 py-2.5 text-[12px] font-semibold leading-snug ${
                dark
                  ? 'bg-[#9CA3AF]/20 text-[#D1D5DB]'
                  : 'bg-[#9CA3AF]/22 text-[#4B5563]'
              }`}
            >
              Hind teadmata — kontrolli silti kohapeal või aita kaardistada.
            </div>
            <TypeMapWidget parkingId={spot.id} dark={dark} />
          </>
        ) : null}

        {spot.freeNow != null || spot.freeReason ? (
          <div
            className={`mb-2.5 rounded-xl px-3 py-2.5 ${
              spot.freeNow
                ? 'bg-[#34C759]/12 text-[#248A3D]'
                : 'bg-[#FF9F0A]/12 text-[#C93400]'
            }`}
          >
            <p className="text-[12px] font-semibold tracking-wide uppercase opacity-80">
              {spot.freeNow ? 'Praegu tasuta' : 'Praegu tasuline'}
            </p>
            <p className="mt-0.5 text-[13px] font-semibold">
              {spot.freeReason || (spot.freeNow ? 'Tasuta' : 'Tasuline')}
            </p>
            {formatFreeUntil(spot.freeUntil) ? (
              <p className="mt-0.5 text-[12px] font-medium opacity-90">
                {spot.freeNow ? 'Tasuta kuni' : 'Tasuline kuni'}{' '}
                {formatFreeUntil(spot.freeUntil)}
              </p>
            ) : null}
            {spot.exemptions?.includes('ev_m1') ? (
              <p className="mt-1 text-[12px] font-semibold">
                Elektriauto (M1) · mootorratas · invakaart — vabastus
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Price block — compact */}
        <div className={`mb-2.5 overflow-hidden rounded-xl ${blockBg}`}>
          <div className="flex items-stretch">
            <div className="flex-1 px-3 py-2.5">
              <p className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}>
                Hind
              </p>
              <p className={`mt-0.5 text-[15px] font-bold tracking-tight ${ink}`}>
                {pricing.headline}
              </p>
              <p className={`mt-0.5 text-[12px] font-medium ${soft}`}>{pricing.detail}</p>
            </div>
            <div className={`w-px ${dark ? 'bg-white/10' : 'bg-black/6'}`} />
            <div className="flex w-[38%] flex-col justify-center px-3 py-2.5">
              <p className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}>
                Operaator
              </p>
              <p className={`mt-0.5 text-[12px] font-semibold ${ink}`}>{spot.operator}</p>
            </div>
          </div>
          {spot.structureType || typeof spot.floors === 'number' ? (
            <div className={`flex items-center justify-between gap-3 border-t px-3 py-2 ${dark ? 'border-white/10' : 'border-black/6'}`}>
              <div>
                <p className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}>
                  Tüüp
                </p>
                <p className={`mt-0.5 text-[12px] font-semibold ${ink}`}>
                  {spot.structureType === 'underground'
                    ? 'Maa-alune'
                    : spot.structureType === 'multi_storey'
                      ? 'Mitmekorruseline'
                      : 'Maapealne'}
                  {spot.structureType === 'multi_storey' && spot.floors
                    ? ` · P+${spot.floors}`
                    : null}
                </p>
              </div>
              {spot.zone_code &&
              !/^(ZONE|FREE|PAID|TASUTA|TASULINE|UNKNOWN|P)$/i.test(
                spot.zone_code,
              ) ? (
                <span
                  className="rounded-full px-2.5 py-1 text-[12px] font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {spot.zone_code}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mb-2.5 space-y-1.5">
          <p className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}>
            Navigeeri
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <a
              href={links.waze}
              target="_blank"
              rel="noreferrer"
              onClick={() => track('navigate_clicked', { provider: 'waze' })}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#33CCFF] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <Navigation className="h-4 w-4 text-[#053B4A]" strokeWidth={2.5} />
              <span className="text-[12px] font-bold text-[#053B4A]">Waze</span>
            </a>
            <a
              href={links.google}
              target="_blank"
              rel="noreferrer"
              onClick={() => track('navigate_clicked', { provider: 'google' })}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#4285F4] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4 text-white" strokeWidth={2.5} />
              <span className="text-[12px] font-bold text-white">Google</span>
            </a>
            <button
              type="button"
              onClick={() => {
                track('navigate_clicked', { provider: 'apple' })
                openAppleMaps(spot.lat, spot.lng)
              }}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#1C1C1E] px-1.5 py-2.5 text-center transition active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4 text-white" strokeWidth={2.5} />
              <span className="text-[12px] font-bold text-white">Apple</span>
            </button>
          </div>
        </div>

        {onFindAnother && onSelectAlternative ? (
          <FindParkingActions
            dark={dark}
            primaryLabel="Leia teine parkla läheduses"
            onFindAnother={onFindAnother}
            onMarkFull={onMarkFull}
            onReportOther={onReportOther}
            showMarkFull
            alternatives={alternatives}
            noResults={noAlternatives}
            onWidenRadius={onWidenRadius}
            onSelectAlternative={onSelectAlternative}
            isCurrentFull={isFull || reportCooldownActive}
            markFullDisabledReason={
              reportCooldownActive
                ? 'Sama parkla jaoks oota 5 minutit'
                : isFull
                  ? 'Juba märgitud täis'
                  : undefined
            }
          />
        ) : null}

        {/* Sessiooni nupud — ühe puudutusega alustamine */}
        <div
          id="parking-session-section"
          className={`space-y-3 border-t pt-3 ${dark ? 'border-white/10' : 'border-black/5'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className={`text-[12px] font-semibold tracking-wide uppercase ${muted}`}>
              Parkimissessioon
            </p>
            {hasActive ? (
              <span className="shrink-0 rounded-full bg-[#34C759]/15 px-2 py-0.5 text-[12px] font-bold text-[#248A3D]">
                Aktiivne
              </span>
            ) : null}
          </div>
          {!hasActive && isUnlimitedFreeParking(spot) ? (
            <p
              data-testid="free-no-session"
              className={`rounded-xl px-3 py-2.5 text-[13px] font-semibold leading-snug ${
                dark ? 'bg-white/8 text-[#EBEBF5]' : 'bg-[#34C759]/10 text-[#248A3D]'
              }`}
            >
              Tasuta koht, sessiooni ei alustata
            </p>
          ) : (
            <>
          <p className={`text-[12px] leading-snug ${muted}`}>
            Tsoon{' '}
            <span className={`font-semibold ${ink}`}>
              {activeSession?.zone ?? spot.zone_code}
            </span>
            {hasActive && activeSession?.status
              ? ` · ${activeSession.status}`
              : ''}
            {hasActive && formatHourlyRate(activeSession?.hourlyRate)
              ? ` · ${formatHourlyRate(activeSession?.hourlyRate)}`
              : ''}
            {hasActive && startedLabel ? ` · alates ${startedLabel}` : ''}
          </p>

          {hasActive && priceEstimate ? (
            <p
              data-testid="price-estimate"
              className={`rounded-xl px-3 py-2 text-[12px] font-semibold leading-snug ${
                dark ? 'bg-white/8 text-[#EBEBF5]' : 'bg-[#007AFF]/08 text-[#007AFF]'
              }`}
            >
              {priceEstimate}
            </p>
          ) : null}

          {hasActive && onExtendMinutes ? (
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { minutes: 15, label: '+15m' },
                  { minutes: 30, label: '+30m' },
                  { minutes: 60, label: '+1h' },
                  { minutes: 120, label: '+2h' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  disabled={sessionLoading}
                  onClick={(e) => {
                    blockNav(e)
                    onExtendMinutes(opt.minutes)
                  }}
                  className="tap-scale rounded-xl bg-[#FF9F0A]/12 px-1 py-2.5 text-[12px] font-bold text-[#C93400] disabled:opacity-55"
                >
                  {sessionAction === 'extend' ? '…' : opt.label}
                </button>
              ))}
            </div>
          ) : null}

          {hasActive ? (
            <button
              type="button"
              disabled={sessionLoading || sessionNetBlocked}
              title={
                sessionNetBlocked
                  ? 'Parkimise peatamiseks on vaja internetti'
                  : undefined
              }
              onClick={(e) => {
                blockNav(e)
                onStopSession()
              }}
              className="tap-scale flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#FF3B30] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-55"
            >
              <Square className="h-4 w-4 fill-current" />
              {sessionAction === 'stop' ? 'Lõpetan…' : 'Lõpeta sessioon'}
            </button>
          ) : (
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={
                  sessionLoading ||
                  sessionNetBlocked ||
                  !canStartParkingSession(spot)
                }
                title={
                  sessionNetBlocked
                    ? 'Parkimise alustamiseks on vaja internetti'
                    : undefined
                }
                onClick={(e) => {
                  blockNav(e)
                  if (!canStartParkingSession(spot)) return
                  onStartSession()
                }}
                className="tap-scale flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-55"
              >
                {sessionAction === 'start' ? 'Alustan…' : 'Alusta sessiooni'}
              </button>
              {!canStartParkingSession(spot) ? (
                <p className={`px-1 text-[12px] font-medium ${muted}`}>
                  {sessionStartDisabledHint(spot)}
                </p>
              ) : null}
            </div>
          )}

          <button
            type="button"
            disabled={sessionLoading}
            onClick={(e) => {
              blockNav(e)
              onCheckStatus()
            }}
            className="tap-scale flex w-full items-center justify-center gap-2 rounded-2xl bg-[#007AFF]/10 px-4 py-3 text-[14px] font-semibold text-[#007AFF] disabled:opacity-55"
          >
            <RefreshCw className={`h-4 w-4 ${sessionAction === 'status' ? 'animate-spin' : ''}`} />
            {sessionAction === 'status' ? 'Kontrollin…' : 'Kontrolli staatust'}
          </button>
            </>
          )}

          {sessionNotice ? (
            <p
              data-testid="session-notice"
              className={`rounded-2xl p-3.5 text-[13px] font-medium leading-snug ${
                sessionNotice.kind === 'success'
                  ? 'bg-[#34C759]/12 text-[#248A3D]'
                  : sessionNotice.kind === 'error'
                    ? 'bg-[#FF3B30]/10 text-[#D70015]'
                    : sessionNotice.kind === 'loading'
                      ? dark
                        ? 'bg-white/10 text-[#98989D]'
                        : 'bg-[#F2F2F7] text-[#636366]'
                      : 'bg-[#007AFF]/10 text-[#007AFF]'
              }`}
            >
              {sessionNotice.text}
            </p>
          ) : null}

          {onReportInvalid ? (
            <button
              type="button"
              onClick={(e) => {
                blockNav(e)
                onReportInvalid()
              }}
              className="tap-scale flex w-full items-center justify-center gap-2 rounded-2xl bg-[#F2F2F7] px-4 py-2.5 text-[12px] font-semibold text-[#636366]"
            >
              <Flag className="h-3.5 w-3.5 text-[#FF3B30]" />
              Märgi olematuks / Teavita veast
            </button>
          ) : null}

          {spot.verifyOnSite || spot.source || spot.lastVerified ? (
            <div className={`mt-2 rounded-xl px-3 py-2.5 text-[12px] leading-snug ${blockBg} ${soft}`}>
              {spot.verifyOnSite ? (
                <p className={`font-bold ${ink}`}>Kontrolli kohapealt silti</p>
              ) : null}
              {spot.source ? (
                <p className="mt-0.5">
                  Allikas: {spot.source}
                </p>
              ) : null}
              {spot.lastVerified ? (
                <p className="mt-0.5">Viimati kontrollitud: {spot.lastVerified}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        </>
      )}
    </InfoSidePanelShell>
  )
}
