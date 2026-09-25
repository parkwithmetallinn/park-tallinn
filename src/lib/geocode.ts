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

export async function searchAddress(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '0',
    limit: '6',
    countrycodes: 'ee',
    viewbox: '24.55,59.35,25.00,59.55',
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
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
  }
}
