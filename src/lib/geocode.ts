/**
 * Nominatim (OSM) geocoding — Tallinn / Estonia address search.
 * Browser calls go through /api/nominatim (Vite proxy / Vercel rewrite)
 * because Nominatim does not send CORS headers to arbitrary origins.
 */

export type GeocodeResult = {
  id: string
  label: string
  lat: number
  lng: number
  kind: string
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

export async function searchAddress(
  query: string,
  signal?: AbortSignal,
  viewbox = ESTONIA_VIEWBOX,
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '0',
    limit: '8',
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
  }>

  return data.map((r) => ({
    id: String(r.place_id),
    label: r.display_name.replace(/, Eesti$/i, '').replace(/, Estonia$/i, ''),
    lat: Number(r.lat),
    lng: Number(r.lon),
    kind: r.type || r.class || 'place',
  }))
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
  const short = r.label.split(',')[0]?.trim() || r.label
  return {
    id: r.id,
    name: short,
    label: r.label,
    lat: r.lat,
    lng: r.lng,
    kind: r.kind,
  }
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}
