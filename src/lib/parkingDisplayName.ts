/**
 * Human-facing parking lot titles — never show generic OSM structure words
 * like "Surface" / "Zone" as the primary name.
 * Never expose internal spot IDs (spot-102, OSM way ids) in the UI.
 */

import type { ParkingLayerKey, ParkingSpot } from '../types'

const GENERIC_NAME_RE =
  /^(surface|underground|multi[-_\s]?storey|multi[-_\s]?level|zone|parkla|parking|parking\s*lot|car\s*park|unknown|tänav|street|lot|maapealne|maa-alune)$/i

const GENERIC_PREFIX_RE =
  /^(zone|surface|underground|multi[-_\s]?storey|parkla\s*-\s*)/i

/** Names that are too generic to distinguish spots in a list. */
const WEAK_AREA_ONLY_RE = /^parkla\s*[-–,]\s*(tallinn|pärnu|parnu|tartu|narva)$/i

const CITY_ONLY_RE = /^(tallinn|pärnu|parnu|tartu|narva)$/i

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

/** "Akadeemia tee 23, Mustamäe, Tallinn" → "Mustamäe" */
function districtFromAddress(address: string | null | undefined): string {
  const a = (address ?? '').trim()
  if (!a) return ''
  const parts = a.split(',').map((p) => p.trim()).filter(Boolean)
  for (let i = 1; i < parts.length; i++) {
    const d = parts[i]
      .replace(/\s*linnaosa$/i, '')
      .replace(/^Kesklinna$/i, 'Kesklinn')
      .trim()
    if (d && !CITY_ONLY_RE.test(d) && d.length >= 3) return d
  }
  return ''
}

function withHumanDisambiguator(
  base: string,
  zone: string,
  district: string,
): string {
  if (zone && !base.includes(zone)) return `${base} (${zone})`
  if (district && !base.includes(district)) return `${base} (${district})`
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
  if (CITY_ONLY_RE.test(first)) return ''
  return first
}

/**
 * Title fallback chain (human-readable only):
 * 1. Real `name`
 * 2. Street (+ house) + "parkla"
 * 3. Street + parkla + zone / linnaosa
 * 4. Zone code alone (EP264)
 * 5. District + zone  e.g. "Kesklinn (EP264)"
 * 6. Operator + zone
 * Never invent streets; never show internal spot IDs.
 */
export function parkingDisplayName(input: ParkingNameInput): string {
  const rawName = (input.name ?? '').trim()
  if (rawName && !isGenericParkingName(rawName)) return rawName

  const zone = cleanZoneCode(input.zone_code || input.zone)
  const street = (input['addr:street'] ?? '').trim()
  const hn = (input['addr:housenumber'] ?? '').trim()
  const fromAddr = streetFromAddress(input.address)
  const district = districtFromAddress(input.address)

  if (street && hn) return `${street} ${hn} parkla`
  if (street) return withHumanDisambiguator(`${street} parkla`, zone, district)

  if (fromAddr && !CITY_ONLY_RE.test(fromAddr)) {
    const streetOnly = fromAddr.replace(/\s+\d+[A-Za-z]?$/, '').trim()
    const hasHouse = streetOnly.length >= 3 && streetOnly !== fromAddr
    if (hasHouse) return `${fromAddr} parkla`
    if (streetOnly && streetOnly.length >= 3) {
      return withHumanDisambiguator(`${streetOnly} parkla`, zone, district)
    }
    return withHumanDisambiguator(`${fromAddr} parkla`, zone, district)
  }

  if (zone && district) return `${district} (${zone})`
  if (zone) return zone
  if (district) return `${district} parkla`

  const op = operatorLabel(input.operator, input.layer)
  if (op && op !== 'Tallinna Linn') {
    return withHumanDisambiguator(`${op} parkla`, zone, district)
  }

  if (fromAddr) return withHumanDisambiguator(`Parkla, ${fromAddr}`, zone, district)
  return 'Parkla'
}

export type ParkingNameInput = {
  name?: string | null
  operator?: string | null
  zone_code?: string | null
  zone?: string | null
  address?: string | null
  layer?: ParkingLayerKey | string | null
  id?: string | null
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
 * Ensure every spot in a list gets a unique human-readable display name.
 * Prefer zone code / linnaosa — never append internal spot IDs.
 */
export function uniquifySpotDisplayNames(
  spots: readonly ParkingSpot[],
): Map<string, string> {
  const base = spots.map((s) => ({
    id: s.id,
    name: spotDisplayName(s),
    zone: cleanZoneCode(s.zone_code),
    district: districtFromAddress(s.address),
    street: streetFromAddress(s.address),
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
      } else if (row.district && !name.includes(row.district)) {
        name = `${row.name} (${row.district})`
      } else if (row.street && !name.includes(row.street)) {
        name = `${row.street} parkla${row.zone ? ` (${row.zone})` : ''}`
      }
    }
    let final = name
    let n = 2
    while (used.has(final)) {
      // Human ordinal only — never OSM / spot ids
      final = row.zone
        ? `${name.replace(/\s*\([^)]*\)\s*$/, '')} (${row.zone} · ${n})`
        : `${name} · ${n}`
      n += 1
    }
    used.add(final)
    out.set(row.id, final)
  }
  return out
}
