/**
 * Nominatim (OSM) + Photon geocoding — Estonia addresses AND POI landmarks.
 * Nominatim goes through /api/nominatim (Vite proxy / Vercel rewrite).
 * Photon is called directly (CORS-enabled) as a POI-friendly complement.
 */

export type GeocodeResult = {
  id: string
  /** Short display name (POI / street) */
  name: string
  label: string
  lat: number
  lng: number
  kind: string
  /** Higher = preferred (POIs / exact name matches) */
  rank?: number
}

/** Dropped / selected place for the location info sheet (search or map pick). */
export type SearchLocation = {
  id: string
  name: string
  label: string
  lat: number
  lng: number
  kind?: string
}

/** Estonia-wide Nominatim bias (west,south,east,north) — not hard-bounded. */
export const ESTONIA_VIEWBOX = '21.5,57.5,28.3,59.75'

/** Soft bias box around a point so nearby places rank first (still Estonia-wide). */
export function viewboxAround(
  lat: number,
  lng: number,
  padDeg = 0.45,
): string {
  const west = (lng - padDeg).toFixed(4)
  const south = (lat - padDeg).toFixed(4)
  const east = (lng + padDeg).toFixed(4)
  const north = (lat + padDeg).toFixed(4)
  return `${west},${south},${east},${north}`
}

/** Named Estonian cities — when the query mentions one, bias Nominatim there. */
const CITY_QUERY_CENTERS: Array<{ re: RegExp; lat: number; lng: number }> = [
  { re: /\bpärnu\b|\bparnu\b/i, lat: 58.3859, lng: 24.4971 },
  { re: /\btartu\b/i, lat: 58.3776, lng: 26.729 },
  { re: /\bnarva\b/i, lat: 59.3793, lng: 28.1791 },
  { re: /\btallinn\b/i, lat: 59.437, lng: 24.7535 },
  { re: /\bviljandi\b/i, lat: 58.3639, lng: 25.59 },
  { re: /\brakvere\b/i, lat: 59.3464, lng: 26.3558 },
  { re: /\bkuressaare\b/i, lat: 58.253, lng: 22.4919 },
]

/**
 * Pick a Nominatim viewbox: prefer an explicit city name in the query,
 * otherwise soft-bias around the user's current location.
 */
export function viewboxForQuery(
  query: string,
  userLat: number,
  userLng: number,
): string {
  for (const c of CITY_QUERY_CENTERS) {
    if (c.re.test(query)) return viewboxAround(c.lat, c.lng, 0.55)
  }
  return viewboxAround(userLat, userLng)
}

const POI_CLASSES = new Set([
  'tourism',
  'amenity',
  'leisure',
  'historic',
  'building',
  'shop',
  'office',
  'craft',
  'railway',
  'aeroway',
])

function stripCountry(label: string): string {
  return label.replace(/, Eesti$/i, '').replace(/, Estonia$/i, '')
}

function shortName(label: string, named?: string): string {
  if (named?.trim()) return named.trim()
  return label.split(',')[0]?.trim() || label
}

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const toR = (d: number) => (d * Math.PI) / 180
  const dLat = toR(lat2 - lat1)
  const dLng = toR(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function dedupeNearby(results: GeocodeResult[], meters = 45): GeocodeResult[] {
  const out: GeocodeResult[] = []
  for (const r of results) {
    const hit = out.find(
      (o) => haversineM(o.lat, o.lng, r.lat, r.lng) < meters,
    )
    if (!hit) {
      out.push(r)
      continue
    }
    // Keep higher-ranked / POI-preferring entry
    if ((r.rank ?? 0) > (hit.rank ?? 0)) {
      out[out.indexOf(hit)] = r
    }
  }
  return out
}

async function searchNominatim(
  query: string,
  viewbox: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    namedetails: '1',
    extratags: '1',
    limit: '12',
    countrycodes: 'ee',
    viewbox,
    bounded: '0',
  })

  const res = await fetch(`/api/nominatim/search?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const data = (await res.json()) as Array<{
    place_id: number
    display_name: string
    lat: string
    lon: string
    type?: string
    class?: string
    importance?: number
    namedetails?: Record<string, string> | null
  }>

  const qLower = query.trim().toLowerCase()
  return data.map((r) => {
    const label = stripCountry(r.display_name)
    const named =
      r.namedetails?.name ||
      r.namedetails?.['name:et'] ||
      r.namedetails?.['name:en']
    const name = shortName(label, named)
    const isPoi = POI_CLASSES.has(String(r.class || ''))
    const exact =
      name.toLowerCase() === qLower ||
      name.toLowerCase().includes(qLower) ||
      qLower.includes(name.toLowerCase())
    return {
      id: `nom-${r.place_id}`,
      name,
      label,
      lat: Number(r.lat),
      lng: Number(r.lon),
      kind: r.type || r.class || 'place',
      rank:
        (isPoi ? 40 : 10) +
        (exact ? 30 : 0) +
        Math.round((r.importance ?? 0) * 20),
    }
  })
}

async function searchPhoton(
  query: string,
  biasLat: number,
  biasLng: number,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q: query,
    lang: 'default',
    limit: '10',
    lat: String(biasLat),
    lon: String(biasLng),
  })
  // Photon has browser CORS; keep Estonia-ish by discarding far outliers later
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return []
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] }
      properties?: {
        osm_id?: number | string
        osm_type?: string
        name?: string
        street?: string
        housenumber?: string
        city?: string
        countrycode?: string
        type?: string
        osm_key?: string
        osm_value?: string
      }
    }>
  }

  const qLower = query.trim().toLowerCase()
  const out: GeocodeResult[] = []
  for (const f of data.features ?? []) {
    const p = f.properties || {}
    const coords = f.geometry?.coordinates
    if (!coords || coords.length < 2) continue
    const [lng, lat] = coords
    const cc = String(p.countrycode || '').toLowerCase()
    if (cc && cc !== 'ee') continue
    const name =
      p.name ||
      [p.street, p.housenumber].filter(Boolean).join(' ') ||
      'Koht'
    const label = [name, p.street && p.name ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '', p.city]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ')
    const isPoi = POI_CLASSES.has(String(p.osm_key || '')) || Boolean(p.name)
    const exact =
      name.toLowerCase() === qLower || name.toLowerCase().includes(qLower)
    out.push({
      id: `ph-${p.osm_type || 'n'}-${p.osm_id || `${lat},${lng}`}`,
      name,
      label: stripCountry(label),
      lat,
      lng,
      kind: p.osm_value || p.type || 'place',
      rank: (isPoi ? 45 : 12) + (exact ? 35 : 0),
    })
  }
  return out
}

function parseViewboxCenter(viewbox: string): { lat: number; lng: number } {
  const parts = viewbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return { lat: 59.437, lng: 24.7535 }
  }
  const [west, south, east, north] = parts
  return { lat: (south + north) / 2, lng: (west + east) / 2 }
}

/**
 * Search Estonia for addresses AND named POIs / landmarks
 * (e.g. Kultuurikatel). Merges Nominatim + Photon, dedupes, ranks POIs first.
 */
export async function searchAddress(
  query: string,
  signal?: AbortSignal,
  viewbox = ESTONIA_VIEWBOX,
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const { lat, lng } = parseViewboxCenter(viewbox)

  const [nom, photon] = await Promise.all([
    searchNominatim(q, viewbox, signal).catch(() => [] as GeocodeResult[]),
    searchPhoton(q, lat, lng, signal).catch(() => [] as GeocodeResult[]),
  ])

  const merged = dedupeNearby([...photon, ...nom])
  merged.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
  return merged.slice(0, 10)
}

export function navLinks(lat: number, lng: number) {
  return {
    waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    /** Native iOS / macOS Apple Maps scheme */
    appleNative: `maps://maps.apple.com/?daddr=${lat},${lng}`,
    /** HTTPS fallback for desktop / when native scheme is unavailable */
    apple: `https://maps.apple.com/?daddr=${lat},${lng}`,
  }
}

/** Open Apple Maps via native scheme with HTTPS fallback. */
export function openAppleMaps(lat: number, lng: number) {
  const links = navLinks(lat, lng)
  const started = Date.now()
  window.location.href = links.appleNative
  window.setTimeout(() => {
    // If the page is still visible shortly after, native app likely did not open
    if (Date.now() - started < 1600 && !document.hidden) {
      window.open(links.apple, '_blank', 'noopener,noreferrer')
    }
  }, 700)
}

export function geocodeToSearchLocation(r: GeocodeResult): SearchLocation {
  return {
    id: r.id,
    name: r.name || r.label.split(',')[0]?.trim() || r.label,
    label: r.label,
    lat: r.lat,
    lng: r.lng,
    kind: r.kind,
  }
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}
