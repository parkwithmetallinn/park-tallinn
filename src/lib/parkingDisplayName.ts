/**
 * Human-facing parking lot titles — never show generic OSM structure words
 * like "Surface" / "Zone" as the primary name.
 * Never expose internal spot IDs or ugly index suffixes ("KESKLINN - 2").
 */

import type { ParkingLayerKey, ParkingSpot } from '../types'

const GENERIC_NAME_RE =
  /^(surface|underground|multi[-_\s]?storey|multi[-_\s]?level|zone|parkla|parking|parking\s*lot|car\s*park|unknown|tänav|street|lot|maapealne|maa-alune)$/i

const GENERIC_PREFIX_RE =
  /^(zone|surface|underground|multi[-_\s]?storey|parkla\s*-\s*)/i

/** Names that are too generic to distinguish spots in a list. */
const WEAK_AREA_ONLY_RE = /^parkla\s*[-–,]\s*(tallinn|pärnu|parnu|tartu|narva)$/i

const CITY_ONLY_RE = /^(tallinn|pärnu|parnu|tartu|narva)$/i

/** Tallinn municipal paid-zone labels — areas, not unique lot titles. */
const AREA_ZONE_LABELS: Record<string, string> = {
  KESKLINN: 'Kesklinn',
  VANALINN: 'Vanalinn',
  SÜDALINN: 'Südalinn',
  SUDALINN: 'Südalinn',
  PIRITA: 'Pirita',
}

const AREA_ZONE_NAME_RE =
  /^(kesklinn|vanalinn|südalinn|sudalinn|pirita)(\s*(parkla|tsoon))?$/i

export function isGenericParkingName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return true
  if (GENERIC_NAME_RE.test(n)) return true
  if (WEAK_AREA_ONLY_RE.test(n)) return true
  if (AREA_ZONE_NAME_RE.test(n)) return true
  if (AREA_ZONE_LABELS[n.toUpperCase()]) return true
  if (GENERIC_PREFIX_RE.test(n) && n.length <= 24) return true
  return false
}

function cleanZoneCode(zone: string | null | undefined): string {
  const z = (zone ?? '').trim()
  if (!z) return ''
  if (/^(ZONE|FREE|PAID|P|UNKNOWN|TASUTA|TASULINE|KELL)$/i.test(z)) return ''
  return z
}

/** Operator / municipal area label (Kesklinn), or '' for real lot codes (EP264). */
function areaLabelFromZone(zone: string | null | undefined): string {
  const z = cleanZoneCode(zone)
  if (!z) return ''
  return AREA_ZONE_LABELS[z.toUpperCase()] ?? ''
}

/** Real lot/operator codes — EP264, SN1, CP-ST — not municipal area names. */
function lotZoneCode(zone: string | null | undefined): string {
  const z = cleanZoneCode(zone)
  if (!z) return ''
  if (AREA_ZONE_LABELS[z.toUpperCase()]) return ''
  return z
}

function titleCaseStreet(street: string): string {
  const s = street.trim()
  if (!s) return ''
  // Keep short acronyms; soften ALL-CAPS street blobs
  if (s === s.toUpperCase() && s.length > 3 && !/^[A-Z]{1,4}\d/.test(s)) {
    return s
      .toLowerCase()
      .replace(/(^|[\s/-])(\S)/g, (_, p, c) => `${p}${c.toUpperCase()}`)
  }
  return s
}

/** "Liivalaia tn" / "Liivalaia / Gonsiori" → "Liivalaia" */
function shortStreetLabel(street: string): string {
  let s = titleCaseStreet(street)
  if (!s) return ''
  // Prefer left side of "A / B"
  s = s.split('/')[0]?.trim() || s
  // Drop trailing type words
  s = s
    .replace(
      /\s+(tn|tee|pst|puiestee|mnt|maantee|tänav|street|rd|road)\.?$/i,
      '',
    )
    .trim()
  // Drop house number for short label in parentheses
  s = s.replace(/\s+\d+[A-Za-z]?$/u, '').trim()
  return s
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

function operatorLabel(
  operator: string | null | undefined,
  layer?: ParkingLayerKey | string | null,
): string {
  const op = (operator ?? '').trim()
  if (op && !/^unknown$/i.test(op) && !/^tallinna\s+linn$/i.test(op)) return op
  switch (layer) {
    case 'europark':
      return 'EuroPark'
    case 'snabb':
      return 'Snabb'
    case 'citypark':
      return 'Citypark'
    case 'uhisteenused':
      return 'Ühisteenused'
    case 'parkit':
      return 'Parkit'
    case 'park_ride':
      return 'Pargi ja Reisi'
    default:
      return ''
  }
}

function streetFromAddress(address: string | null | undefined): string {
  const a = (address ?? '').trim()
  if (!a) return ''
  const first = a.split(',')[0]?.trim() || a
  if (CITY_ONLY_RE.test(first)) return ''
  if (AREA_ZONE_NAME_RE.test(first)) return ''
  return first
}

/**
 * Prefer "Kesklinn (Liivalaia)" / "Kesklinn (EP264)" over bare "KESKLINN"
 * or collision junk like "KESKLINN (KESKLINN · 2)".
 */
function areaWithQualifier(
  area: string,
  street: string,
  lotCode: string,
  operator: string,
): string {
  const streetShort = shortStreetLabel(street)
  if (streetShort && !area.toLowerCase().includes(streetShort.toLowerCase())) {
    return `${area} (${streetShort})`
  }
  if (lotCode && !area.includes(lotCode)) {
    return `${area} (${lotCode})`
  }
  if (operator && !area.toLowerCase().includes(operator.toLowerCase())) {
    return `${area} (${operator})`
  }
  return area
}

/**
 * Title fallback chain (human-readable only):
 * 1. Real distinct `name` (not just "Kesklinn")
 * 2. Street (+ house) + "parkla"
 * 3. Area + street / lot code  e.g. "Kesklinn (Liivalaia)" / "Kesklinn (EP264)"
 * 4. Lot zone code alone (EP264)
 * 5. Operator parkla
 * Never invent streets; never show index numbers.
 */
export function parkingDisplayName(input: ParkingNameInput): string {
  const rawName = (input.name ?? '').trim()
  const zoneRaw = input.zone_code || input.zone
  const area = areaLabelFromZone(zoneRaw)
  const lotCode = lotZoneCode(zoneRaw)
  const streetTag = (input['addr:street'] ?? '').trim()
  const hn = (input['addr:housenumber'] ?? '').trim()
  const fromAddr = streetFromAddress(input.address)
  const district = districtFromAddress(input.address)
  const op = operatorLabel(input.operator, input.layer)

  // Keep rich names like "Kesklinn · Liivalaia" / "EuroPark Solaris"
  if (rawName && !isGenericParkingName(rawName)) {
    // Soft-clean accidental ugly index suffixes from older caches
    const cleaned = rawName
      .replace(/\s*\(([^)]+)\s*[·\-]\s*\d+\)\s*$/u, ' ($1)')
      .replace(/\s*[·\-]\s*\d+\s*$/u, '')
      .trim()
    return cleaned || rawName
  }

  if (streetTag && hn) return `${titleCaseStreet(streetTag)} ${hn} parkla`
  if (streetTag) {
    const base = `${titleCaseStreet(streetTag)} parkla`
    if (lotCode) return `${base} (${lotCode})`
    if (area) return `${area} (${shortStreetLabel(streetTag)})`
    return base
  }

  if (fromAddr && !CITY_ONLY_RE.test(fromAddr)) {
    const streetOnly = fromAddr.replace(/\s+\d+[A-Za-z]?$/u, '').trim()
    const hasHouse = streetOnly.length >= 3 && streetOnly !== fromAddr
    if (hasHouse) {
      return lotCode
        ? `${titleCaseStreet(fromAddr)} parkla (${lotCode})`
        : `${titleCaseStreet(fromAddr)} parkla`
    }
    const streetLabel = shortStreetLabel(streetOnly || fromAddr)
    if (area && streetLabel) return `${area} (${streetLabel})`
    if (streetLabel) {
      return lotCode
        ? `${streetLabel} parkla (${lotCode})`
        : `${streetLabel} parkla`
    }
  }

  if (area) {
    return areaWithQualifier(area, fromAddr || streetTag, lotCode, op)
  }

  if (district && lotCode) return `${district} (${lotCode})`
  if (lotCode) return lotCode
  if (district) return `${district} parkla`

  if (op) {
    return lotCode ? `${op} (${lotCode})` : `${op} parkla`
  }

  if (fromAddr) return `Parkla, ${titleCaseStreet(fromAddr)}`
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
    'addr:street': (spot as { 'addr:street'?: string })['addr:street'],
    'addr:housenumber': (spot as { 'addr:housenumber'?: string })[
      'addr:housenumber'
    ],
  })
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Ensure every spot in a list gets a unique human-readable display name.
 * Prefer street / lot zone code — never "KESKLINN (KESKLINN · 2)".
 */
export function uniquifySpotDisplayNames(
  spots: readonly ParkingSpot[],
): Map<string, string> {
  const base = spots.map((s) => {
    const zoneRaw = s.zone_code
    return {
      id: s.id,
      name: spotDisplayName(s),
      area: areaLabelFromZone(zoneRaw) || districtFromAddress(s.address),
      lotCode: lotZoneCode(zoneRaw),
      street: shortStreetLabel(
        streetFromAddress(s.address) ||
          ((s as { 'addr:street'?: string })['addr:street'] ?? ''),
      ),
      operator: operatorLabel(s.operator, s.layer),
    }
  })

  const counts = new Map<string, number>()
  for (const row of base) {
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  }

  const used = new Set<string>()
  const out = new Map<string, string>()

  for (const row of base) {
    let name = row.name

    if ((counts.get(row.name) ?? 0) > 1) {
      // Rebuild collisions with street / lot code — never repeat the same token
      if (row.area && row.street && !sameText(row.area, row.street)) {
        name = `${row.area} (${row.street})`
      } else if (row.area && row.lotCode) {
        name = `${row.area} (${row.lotCode})`
      } else if (row.street && row.lotCode) {
        name = `${row.street} (${row.lotCode})`
      } else if (row.street && !name.toLowerCase().includes(row.street.toLowerCase())) {
        name = `${name} (${row.street})`
      } else if (row.lotCode && !name.includes(row.lotCode)) {
        name = `${name} (${row.lotCode})`
      } else if (
        row.operator &&
        !name.toLowerCase().includes(row.operator.toLowerCase())
      ) {
        name = `${name} (${row.operator})`
      }
    }

    // Strip accidental ugly index forms
    name = name
      .replace(/\s*\(([^)]+)\s*[·\-]\s*\d+\)\s*$/u, ' ($1)')
      .replace(/\s*[·\-]\s*\d+\s*$/u, '')
      .trim()

    // If still "Area (Area)", fall back to street or lot code alone
    const paren = name.match(/^(.+?)\s*\((.+?)\)\s*$/)
    if (paren && sameText(paren[1], paren[2])) {
      if (row.street) name = `${paren[1]} (${row.street})`
      else if (row.lotCode) name = `${paren[1]} (${row.lotCode})`
      else if (row.operator) name = `${paren[1]} (${row.operator})`
      else name = paren[1]
    }

    let final = name
    // Last-resort uniqueness without raw indexes: append unused street/lot/op pieces
    const extras = [row.street, row.lotCode, row.operator, row.area].filter(
      (x): x is string => Boolean(x && x.trim()),
    )
    let ei = 0
    while (used.has(final) && ei < extras.length) {
      const extra = extras[ei++]
      if (!final.toLowerCase().includes(extra.toLowerCase())) {
        final = `${name} (${extra})`
      }
    }
    // Absolute last resort — still human, no " - 2"
    if (used.has(final)) {
      final = row.lotCode
        ? row.lotCode
        : row.street
          ? `${row.street} parkla`
          : `${name} parkla`
      let k = 0
      while (used.has(final) && k < extras.length) {
        const extra = extras[k++]
        if (extra && !final.toLowerCase().includes(extra.toLowerCase())) {
          final = `${final.replace(/\s*parkla$/i, '').trim()} (${extra})`
        }
      }
    }

    used.add(final)
    out.set(row.id, final)
  }
  return out
}
