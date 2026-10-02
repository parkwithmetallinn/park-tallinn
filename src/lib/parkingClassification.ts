/**
 * Strict free-parking classification shared by polygon + roadside layers.
 * Green is reserved for verified free public parking only.
 */

export const PARKING_COLOR_FREE = '#22C55E'
/** Unclassified / ZONE / private / unknown — not free public parking. */
export const PARKING_COLOR_UNKNOWN = '#A0AEC0'

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
/** Explicitly paid municipal / curb (when no operator brand color). */
export const PARKING_COLOR_PAID = '#FF3B30'
/** Clock / maxstay free window. */
export const PARKING_COLOR_TIMED = '#0A84FF'

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
