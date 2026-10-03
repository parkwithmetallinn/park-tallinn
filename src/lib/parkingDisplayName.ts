/**
 * Human-facing parking lot titles — never show generic OSM structure words
 * like "Surface" / "Zone" as the primary name.
 */

import type { ParkingLayerKey, ParkingSpot } from '../types'

const GENERIC_NAME_RE =
  /^(surface|underground|multi[-_\s]?storey|multi[-_\s]?level|zone|parkla|parking|parking\s*lot|car\s*park|unknown|tänav|street|lot)$/i

const GENERIC_PREFIX_RE =
  /^(zone|surface|underground|multi[-_\s]?storey)\s+/i

export function isGenericParkingName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return true
  if (GENERIC_NAME_RE.test(n)) return true
  if (GENERIC_PREFIX_RE.test(n) && n.length <= 24) return true
  return false
}

function cleanZoneCode(zone: string | null | undefined): string {
  const z = (zone ?? '').trim()
  if (!z) return ''
  if (/^(ZONE|FREE|KELL|PAID|P)$/i.test(z)) return ''
  return z
}

function operatorLabel(
  operator: string | null | undefined,
  layer?: ParkingLayerKey | string | null,
): string {
  const op = (operator ?? '').trim()
  if (op && !/^unknown$/i.test(op)) return op
  switch (layer) {
    case 'europark':
      return 'EuroPark'
    case 'snabb':
      return 'Snabb'
    case 'citypark':
      return 'Citypark'
    case 'uhisteenused':
      return 'AS Ühisteenused'
    case 'parkit':
      return 'Parkit'
    case 'park_ride':
      return 'Pargi ja Reisi'
    case 'municipal':
    case 'free_street':
    case 'timed':
      return 'Tallinna Linn'
    default:
      return ''
  }
}

function streetFromAddress(address: string | null | undefined): string {
  const a = (address ?? '').trim()
  if (!a) return ''
  // "Kursi 3, Tallinn" → "Kursi 3"
  const first = a.split(',')[0]?.trim() || a
  // Reject if it's just a city name
  if (/^(tallinn|pärnu|parnu|tartu|narva)$/i.test(first)) return ''
  return first
}

function areaHint(address: string | null | undefined, zoneCode?: string): string {
  const a = (address ?? '').trim()
  if (a) {
    const parts = a.split(',').map((p) => p.trim()).filter(Boolean)
    const city = parts.length > 1 ? parts[parts.length - 1] : ''
    if (city && !/^\d+$/.test(city)) return city
  }
  const z = cleanZoneCode(zoneCode)
  if (z && !/^[A-Z]{1,3}\d+$/i.test(z)) {
    // Human zone names like KESKLINN
    return z.charAt(0) + z.slice(1).toLowerCase()
  }
  return 'Tallinn'
}

export type ParkingNameInput = {
  name?: string | null
  operator?: string | null
  zone_code?: string | null
  zone?: string | null
  address?: string | null
  layer?: ParkingLayerKey | string | null
  /** Raw OSM-style fields when building from GeoJSON props */
  'addr:street'?: string | null
  'addr:housenumber'?: string | null
}

/**
 * Title fallback chain:
 * 1. Real `name`
 * 2. operator + zone (e.g. "EuroPark EP29", "Tallinna Linn - KESKLINN")
 * 3. street + housenumber / address line
 * 4. "Parkla - {area}"
 */
export function parkingDisplayName(input: ParkingNameInput): string {
  const rawName = (input.name ?? '').trim()
  if (rawName && !isGenericParkingName(rawName)) return rawName

  const op = operatorLabel(input.operator, input.layer)
  const zone = cleanZoneCode(input.zone_code || input.zone)
  if (op && zone) {
    // Compact codes like EP29 sit next to operator; longer zone names use a dash
    if (/^[A-Z]{1,3}\d+[A-Z]?$/i.test(zone) || zone.length <= 6) {
      return `${op} ${zone}`
    }
    return `${op} - ${zone}`
  }
  if (op && op !== 'Tallinna Linn') return `${op} parkla`
  if (zone) return zone

  const street = (input['addr:street'] ?? '').trim()
  const hn = (input['addr:housenumber'] ?? '').trim()
  if (street && hn) return `${street} ${hn}`
  if (street) return street

  const fromAddr = streetFromAddress(input.address)
  if (fromAddr) return fromAddr

  const area = areaHint(input.address, zone || input.zone_code || undefined)
  return `Parkla - ${area}`
}

/** Convenience for ParkingSpot / sidebar cards. */
export function spotDisplayName(spot: ParkingSpot): string {
  return parkingDisplayName({
    name: spot.name,
    operator: spot.operator,
    zone_code: spot.zone_code,
    address: spot.address,
    layer: spot.layer,
  })
}
