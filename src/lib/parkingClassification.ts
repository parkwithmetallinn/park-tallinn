/**
 * Strict free-parking classification shared by polygon + roadside layers.
 * Green ("Tasuta") is reserved for unlimited free public parking only —
 * no time limit, no parking clock. Clock-limited free stays → "Kellaga".
 */

/** Unlimited free — Tasuta (strict green). */
export const PARKING_COLOR_FREE = '#00FF00'
/** Unclassified / private / unknown — not free public parking. */
export const PARKING_COLOR_UNKNOWN = '#A0AEC0'
/** Paid parking — Tasuline (strict red). */
export const PARKING_COLOR_PAID = '#FF0000'
/** Clock / time-limited free — Kellaga (strict yellow). */
export const PARKING_COLOR_TIMED = '#FFCC00'

/** Spot-like fields used by Tasuta / Kellaga filter helpers. */
export type FreeClockFields = {
  layer?: string
  type?: string
  free_minutes?: number
  price_per_hour?: number
  verified_free?: boolean
  timeLimit?: string
  zone_code?: string
  badge?: string
  name?: string
  desc?: string
}

function strField(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** Parse OSM maxstay / duration strings into minutes. */
export function parseMaxstayMinutes(maxstay: unknown): number {
  const raw = strField(maxstay)
  if (!raw) return 0
  const s = raw.toLowerCase()
  if (s === 'unlimited' || s === 'no') return 0
  const hours = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/)
  if (hours) return Math.round(parseFloat(hours[1]) * 60)
  const mins = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/)
  if (mins) return parseInt(mins[1], 10)
  const combo = s.match(/(\d+(?:\.\d+)?)\s*hours?/)
  if (combo) return Math.round(parseFloat(combo[1]) * 60)
  const comboM = s.match(/(\d+)\s*minutes?/)
  if (comboM) return parseInt(comboM[1], 10)
  // "30 minutes @ Mo-Fr …" / bare number
  const leading = s.match(/^(\d+(?:\.\d+)?)/)
  if (leading && /min/.test(s)) return Math.round(parseFloat(leading[1]))
  return 0
}

/**
 * Detect clock / time-limit signals from OSM + curated text fields.
 * Returns inferred free-window minutes (0 if none).
 */
export function extractClockMinutes(
  ...parts: Array<unknown>
): number {
  let mins = 0
  const texts: string[] = []
  for (const part of parts) {
    if (part && typeof part === 'object' && !Array.isArray(part)) {
      const rec = part as Record<string, unknown>
      for (const [k, v] of Object.entries(rec)) {
        if (
          k === 'maxstay' ||
          k.startsWith('maxstay:') ||
          k.startsWith('maxstay:conditional')
        ) {
          mins = mins || parseMaxstayMinutes(v)
        }
        if (
          k === 'name' ||
          k === 'description' ||
          k === 'desc' ||
          k === 'timeLimit' ||
          k === 'badge' ||
          k === 'zone_code' ||
          k === 'zone' ||
          k === 'rules' ||
          k.includes('parking:condition')
        ) {
          texts.push(strField(v))
        }
      }
    } else {
      texts.push(strField(part))
    }
  }
  const text = texts.join(' ')
  if (!mins) {
    const minMatch = text.match(/\b(\d{1,3})\s*min(?:utes?)?\b/i)
    if (minMatch) mins = parseInt(minMatch[1], 10)
  }
  if (!mins) {
    const hourMatch = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:ours?|undi)?\b/i)
    if (hourMatch) mins = Math.round(parseFloat(hourMatch[1]) * 60)
  }
  if (
    !mins &&
    /parkimiskell|ajapiirang|\bkellaga\b|\bdisc\b|parking\s*clock/i.test(text)
  ) {
    mins = 15
  }
  return mins
}

/** True when text/tags clearly indicate a parking-clock / time limit. */
export function hasClockKeyword(...parts: Array<unknown>): boolean {
  if (extractClockMinutes(...parts) > 0) return true
  const text = parts.map(strField).join(' ')
  return /parkimiskell|ajapiirang|\bkellaga\b|\bdisc\b|\bKELL\b/i.test(text)
}

/**
 * Unlimited free public parking — the only features that belong in "Tasuta".
 * Must be free (€0), have no free-minute window, and not be on the timed layer.
 */
export function isUnlimitedFreeParking(p: FreeClockFields): boolean {
  const layer = String(p.layer || '')
  const mins = Number(p.free_minutes ?? 0)
  const price = Number(p.price_per_hour ?? 0)
  if (mins > 0) return false
  if (price > 0) return false
  if (layer === 'timed') return false
  if (p.type === 'timed') return false
  if (hasClockKeyword(p.timeLimit, p.badge, p.name, p.desc, p.zone_code)) {
    return false
  }
  if (layer === 'free_street') return true
  if (p.verified_free) return true
  if (p.type === 'free' && layer !== 'municipal') return true
  return false
}

/**
 * Time-limited / parking-clock free parking — "Kellaga" filter.
 * Includes layer=timed, €0 spots with a free window (15/60/120…), KELL/ZONE
 * clock curb, and keyword signals (Parkimiskellaga, Ajapiiranguga, …).
 * Paid hourly zones with a short grace period stay under "Tasuline".
 */
export function isClockLimitedParking(p: FreeClockFields): boolean {
  const layer = String(p.layer || '')
  const mins = Number(p.free_minutes ?? 0)
  const price = Number(p.price_per_hour ?? 0)
  const zone = String(p.zone_code || '').toUpperCase()
  const badge = String(p.badge || '').toUpperCase()
  if (layer === 'timed' || p.type === 'timed') return true
  if (zone === 'KELL' || badge === 'KELL') return true
  // Free (or effectively free) with an explicit clock window
  if (mins > 0 && price <= 0) return true
  if (price > 0) return false
  if (hasClockKeyword(p.timeLimit, p.badge, p.name, p.desc)) return true
  return false
}

/** Detail-sheet headline for clock-limited free parking. */
export function clockFreeHeadline(freeMinutes: number): string {
  const mins = Math.max(0, Math.round(freeMinutes))
  if (mins > 0) return `Parkimiskellaga / Ajapiiranguga · ${mins} min`
  return 'Parkimiskellaga / Ajapiiranguga'
}

const PAID_LAYERS = new Set([
  'europark',
  'snabb',
  'citypark',
  'uhisteenused',
  'parkit',
  'park_ride',
  'loading',
  'municipal',
])

/**
 * Strict category paint for map geometry (Kõik / filters):
 * Green = unlimited free · Yellow = clock-limited free · Red = paid · Gray = other.
 */
export function categoryPaintColor(p: FreeClockFields): string {
  if (isUnlimitedFreeParking(p)) return PARKING_COLOR_FREE
  if (isClockLimitedParking(p)) return PARKING_COLOR_TIMED
  const layer = String(p.layer || '')
  const price = Number(p.price_per_hour ?? 0)
  if (price > 0) return PARKING_COLOR_PAID
  if (PAID_LAYERS.has(layer)) {
    // Municipal with no price and no free/clock signal → unclassified gray
    if (
      layer === 'municipal' &&
      isUnclassifiedParking({
        layer,
        price_per_hour: price,
        zone_code: p.zone_code,
        verified_free: p.verified_free,
        type: p.type,
      })
    ) {
      return PARKING_COLOR_UNKNOWN
    }
    if (layer === 'municipal' && price <= 0) return PARKING_COLOR_UNKNOWN
    return PARKING_COLOR_PAID
  }
  return PARKING_COLOR_UNKNOWN
}

const KNOWN_OPERATOR_LAYERS = new Set([
  'europark',
  'snabb',
  'citypark',
  'uhisteenused',
  'parkit',
  'ev',
  'inva',
  'loading',
  'park_ride',
  'free_street',
  'timed',
])

/**
 * Grey / private / unclassified parking — no clear operator pricing.
 * Used by the "Other / Private" filter and detail-panel warning.
 */
export function isUnclassifiedParking(p: {
  layer?: string
  verified_free?: boolean
  price_per_hour?: number
  zone_code?: string
  operator?: string
  color?: string
  type?: string
}): boolean {
  const layer = String(p.layer || '')
  if (p.verified_free || layer === 'free_street') return false
  if (KNOWN_OPERATOR_LAYERS.has(layer) && layer !== 'municipal') return false
  if (layer === 'timed') return false
  // Kellaga / clock curb is never "Muud / Era"
  if (
    isClockLimitedParking({
      layer,
      type: p.type,
      price_per_hour: p.price_per_hour,
      zone_code: p.zone_code,
      verified_free: p.verified_free,
    })
  ) {
    return false
  }
  // Paid with a known hourly rate is classified municipal
  if ((p.price_per_hour ?? 0) > 0) return false
  const zone = String(p.zone_code || '').toUpperCase()
  const op = String(p.operator || '')
  if (p.color === PARKING_COLOR_UNKNOWN) return true
  if (zone === 'ZONE' || zone === '' || zone === 'UNKNOWN') return true
  if (!op || op === 'Unknown') return true
  // Municipal with no fee tags falls into the grey bucket
  return layer === 'municipal'
}
function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** Access values that are never shown as free public parking. */
const BLOCKED_ACCESS = new Set([
  'private',
  'customers',
  'permit',
  'residents',
  'employees',
  'no',
  'destination',
  'bus',
  'taxi',
])

export function isPaidFeeTag(feeRaw: unknown, chargeRaw?: unknown): boolean {
  const fee = str(feeRaw).toLowerCase()
  if (!fee && !str(chargeRaw)) return false
  if (fee === 'no' || fee === 'free') return false
  if (fee === 'yes' || fee === 'private' || fee.includes('€') || fee.includes('eur')) return true
  if (str(chargeRaw)) return true
  // Numeric / schedule fee strings from OSM
  if (/\d/.test(fee) && (fee.includes('€') || fee.includes('eur') || fee.includes('/'))) return true
  return false
}

export function isExplicitFreeFee(feeRaw: unknown): boolean {
  const fee = str(feeRaw).toLowerCase()
  return fee === 'no' || fee === 'free'
}

export function isFreeZoneCode(zoneRaw: unknown): boolean {
  return str(zoneRaw).toUpperCase() === 'FREE'
}

/**
 * Verified free public parking — the only features allowed to use green (#22C55E).
 *
 * True when an explicit free signal is present:
 *   - fee === 'no' | 'free'
 *   - zone / zone_code === 'FREE'
 *   - curated rules === 'free'
 * and access is not private/customers/restricted.
 *
 * access=yes/public alone is NOT enough (avoids painting paid public lots green).
 */
export function isVerifiedFreeParking(p: {
  fee?: unknown
  access?: unknown
  zone?: unknown
  zone_code?: unknown
  ref?: unknown
  rules?: unknown
  charge?: unknown
}): boolean {
  const access = str(p.access).toLowerCase()
  if (access && BLOCKED_ACCESS.has(access)) return false

  if (isPaidFeeTag(p.fee, p.charge)) return false

  const rules = str(p.rules).toLowerCase()
  if (rules === 'free') return true

  const zone = p.zone ?? p.zone_code ?? p.ref
  if (isFreeZoneCode(zone)) return true

  if (isExplicitFreeFee(p.fee)) return true

  // Public access with an explicit free fee already handled above.
  // access=yes|public without fee/zone free tags → not verified free.
  return false
}

/** Public / yes access (optional gate helpers for UI copy). */
export function isPublicAccess(accessRaw: unknown): boolean {
  const access = str(accessRaw).toLowerCase()
  return access === 'yes' || access === 'public' || access === 'permissive' || access === ''
}

export type ParkingExclusionReason =
  | 'private_access'
  | 'private_parking'
  | 'underground'

/** Commercial / brand operators whose underground garages stay on the map. */
function isCommercialParkingOperator(operatorRaw: unknown): boolean {
  const op = str(operatorRaw).toLowerCase()
  if (!op) return false
  return (
    op.includes('europark') ||
    op.includes('euro park') ||
    op.includes('snabb') ||
    op.includes('citypark') ||
    op.includes('city park') ||
    op.includes('parkit') ||
    op.includes('ühisteenused') ||
    op.includes('uhisteenused') ||
    op.includes('q-park') ||
    op.includes('apcoa')
  )
}

/** Numeric OSM `layer=*` (building level). Ignores app layer keys like "europark". */
export function osmLevelLayer(layerRaw: unknown): number | null {
  if (typeof layerRaw === 'number' && Number.isFinite(layerRaw)) return layerRaw
  const s = str(layerRaw)
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Map-canvas exclusion — drop private yards / resident-only and phantom
 * underground building parking. Public/commercial garages are kept.
 *
 * Returns a reason string when the feature must be purged, otherwise null.
 */
export function getParkingExclusionReason(
  p: Record<string, unknown>,
): ParkingExclusionReason | null {
  const access = str(p.access).toLowerCase()
  const parking = str(p.parking).toLowerCase()
  const location = str(p.location).toLowerCase()

  // Resident-only & private yards — hard exclude (never gray, never green)
  if (
    access === 'private' ||
    access === 'destination' ||
    access === 'residents'
  ) {
    return 'private_access'
  }
  if (parking === 'private' || parking === 'residential') {
    return 'private_parking'
  }

  const level = osmLevelLayer(p.layer)
  const isUnderground =
    location === 'underground' ||
    parking === 'underground' ||
    parking === 'garage' ||
    (level != null && level < 0)

  if (!isUnderground) return null

  // Keep explicitly public / commercial underground garages
  if (access === 'public' || access === 'yes') return null
  if (isCommercialParkingOperator(p.operator)) return null

  return 'underground'
}

export function shouldExcludeParkingFeature(p: Record<string, unknown>): boolean {
  return getParkingExclusionReason(p) != null
}

export type ParkingPrepPurgeStats = {
  input: number
  kept: number
  purgedTotal: number
  purged: Record<ParkingExclusionReason, number>
}

export function emptyPurgeStats(): ParkingPrepPurgeStats {
  return {
    input: 0,
    kept: 0,
    purgedTotal: 0,
    purged: {
      private_access: 0,
      private_parking: 0,
      underground: 0,
    },
  }
}

export function tallyParkingPurge(
  features: Array<{ properties?: Record<string, unknown> | null } | null | undefined>,
): ParkingPrepPurgeStats {
  const stats = emptyPurgeStats()
  for (const f of features) {
    stats.input++
    const reason = getParkingExclusionReason(f?.properties ?? {})
    if (reason) {
      stats.purged[reason]++
      stats.purgedTotal++
    } else {
      stats.kept++
    }
  }
  return stats
}
