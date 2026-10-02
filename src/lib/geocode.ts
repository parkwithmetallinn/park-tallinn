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

export async function searchAddress(
  query: string,
  signal?: AbortSignal,
  viewbox = '24.55,59.35,25.00,59.55',
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '0',
    limit: '6',
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
