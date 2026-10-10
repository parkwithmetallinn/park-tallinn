/**
 * Human-facing parking lot titles — never show generic OSM structure words
 * like "Surface" / "Zone" as the primary name.
 */

import type { ParkingLayerKey, ParkingSpot } from '../types'

const GENERIC_NAME_RE =
  /^(surface|underground|multi[-_\s]?storey|multi[-_\s]?level|zone|parkla|parking|parking\s*lot|car\s*park|unknown|tänav|street|lot|maapealne|maa-alune)$/i

const GENERIC_PREFIX_RE =
  /^(zone|surface|underground|multi[-_\s]?storey|parkla\s*-\s*)/i

/** Names that are too generic to distinguish spots in a list. */
const WEAK_AREA_ONLY_RE = /^parkla\s*[-–,]\s*(tallinn|pärnu|parnu|tartu|narva)$/i

export function isGenericParkingName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return true
  if (GENERIC_NAME_RE.test(n)) return true
  if (WEAK_AREA_ONLY_RE.test(n)) return true
  if (GENERIC_PREFIX_RE.test(n) && n.length <= 24) return true
  return false
}

function cleanZoneCode(zone: string | null | undefined): string {
  const z = (zone ?? '').trim()
  if (!z) return ''
  if (/^(ZONE|FREE|PAID|P|UNKNOWN|TASUTA|TASULINE|KELL)$/i.test(z)) return ''
  return z
}

function shortSpotId(id: string | null | undefined): string {
  const raw = (id ?? '').trim()
  if (!raw) return ''
  const tail = raw.replace(/^.*[/:#_-]/, '')
  return (tail || raw).slice(-6)
}

function withDisambiguator(base: string, zone: string, id?: string | null): string {
  if (zone && !base.includes(zone)) return `${base} (${zone})`
  const short = shortSpotId(id)
  if (short && !base.includes(short)) return `${base} · ${short}`
  return base
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

/**
 * Title fallback chain (distinct names when data exists):
 * 1. Real `name`
 * 2. Street (+ house) + "parkla"  e.g. "Akadeemia tee 23 parkla"
 * 3. Street + parkla + zone/id when no house number (avoids duplicate list titles)
 * 4. Zone code alone (EP264)
 * 5. operator + zone
 * 6. "Parkla, <street or zone>" — never invent streets
 */
export function parkingDisplayName(input: ParkingNameInput): string {
  const rawName = (input.name ?? '').trim()
  if (rawName && !isGenericParkingName(rawName)) return rawName

  const zone = cleanZoneCode(input.zone_code || input.zone)
  const street = (input['addr:street'] ?? '').trim()
  const hn = (input['addr:housenumber'] ?? '').trim()
  const fromAddr = streetFromAddress(input.address)

  if (street && hn) return `${street} ${hn} parkla`
  if (street) return withDisambiguator(`${street} parkla`, zone, input.id)

  if (fromAddr && !/^(tallinn|pärnu|parnu)$/i.test(fromAddr)) {
    // Prefer "Akadeemia tee parkla" over bare address when no house number
    const streetOnly = fromAddr.replace(/\s+\d+[A-Za-z]?$/, '').trim()
    const hasHouse = streetOnly.length >= 3 && streetOnly !== fromAddr
    if (hasHouse) {
      // fromAddr already includes house number
      return `${fromAddr} parkla`
    }
    if (streetOnly && streetOnly.length >= 3) {
      return withDisambiguator(`${streetOnly} parkla`, zone, input.id)
    }
    return withDisambiguator(`${fromAddr} parkla`, zone, input.id)
  }

  if (zone) return zone

  const op = operatorLabel(input.operator, input.layer)
  if (op && op !== 'Tallinna Linn') {
    return withDisambiguator(`${op} parkla`, zone, input.id)
  }

  // Last resort — do not invent a street
  if (fromAddr) return withDisambiguator(`Parkla, ${fromAddr}`, zone, input.id)
  const short = shortSpotId(input.id)
  return short ? `Parkla · ${short}` : 'Parkla'
}

export type ParkingNameInput = {
  name?: string | null
  operator?: string | null
  zone_code?: string | null
  zone?: string | null
  address?: string | null
  layer?: ParkingLayerKey | string | null
  /** Spot id — used to uniquify street-only names */
  id?: string | null
  /** Raw OSM-style fields when building from GeoJSON props */
  'addr:street'?: string | null
  'addr:housenumber'?: string | null
}

/** Convenience for ParkingSpot / sidebar cards. */
export function spotDisplayName(spot: ParkingSpot): string {
  return parkingDisplayName({
    name: spot.name,
    operator: spot.operator,
    zone_code: spot.zone_code,
    address: spot.address,
    layer: spot.layer,
    id: spot.id,
  })
}

/**
 * Ensure every spot in a list gets a unique display name.
 * Appends zone code or a short id when collisions remain.
 */
export function uniquifySpotDisplayNames(
  spots: readonly ParkingSpot[],
): Map<string, string> {
  const base = spots.map((s) => ({
    id: s.id,
    name: spotDisplayName(s),
    zone: cleanZoneCode(s.zone_code),
    short: shortSpotId(s.id),
  }))

  const counts = new Map<string, number>()
  for (const row of base) {
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  }

  const used = new Set<string>()
  const out = new Map<string, string>()

  for (const row of base) {
    let name = row.name
    if ((counts.get(row.name) ?? 0) > 1) {
      if (row.zone && !name.includes(row.zone)) {
        name = `${row.name} (${row.zone})`
      } else if (row.short) {
        name = `${row.name} · ${row.short}`
      }
    }
    let final = name
    let n = 2
    while (used.has(final)) {
      final = `${name} · ${n++}`
    }
    used.add(final)
    out.set(row.id, final)
  }
  return out
}
