/**
 * OSRM routes via same-origin `/api/osrm` proxy (Vite / Vercel).
 * App coords are [lat, lng]; OSRM wants lng,lat in the URL and GeoJSON.
 */

export type LonLat = [number, number]

export type RouteProfile = 'driving' | 'foot'

/** App-facing route geometry — [lat, lng] for drawing helpers / camera. */
export type RouteResult = {
  coords: [number, number][]
  distanceMeters: number
  durationSeconds: number
  profile: RouteProfile
}

/** Drive to parking + optional walk from parking to the house destination. */
export type NavRouteBundle = {
  /** Driving leg: user → parking */
  drive: RouteResult
  /** Walking leg: parking → house (null when parking is the destination) */
  walk: RouteResult | null
  /** Selected parking [lat, lng] */
  parking: [number, number]
  /** Final destination house / address [lat, lng] */
  house: [number, number]
  /** Label for the parking target */
  label: string
}

/** @deprecated Prefer RouteResult — kept for any leftover call sites. */
export interface DrivingRoute {
  coordinates: LonLat[]
  callouts: Array<{ id: string; name: string; lng: number; lat: number }>
  distanceMeters: number
  durationSeconds: number
  bearing: number
}

interface OsrmResponse {
  code: string
  message?: string
  routes?: Array<{
    distance: number
    duration: number
    geometry?: { coordinates?: LonLat[] }
  }>
}

const cache = new Map<string, RouteResult>()

function round5(n: number) {
  return Math.round(n * 1e5) / 1e5
}

function cacheKey(
  from: [number, number],
  to: [number, number],
  profile: RouteProfile,
) {
  return `${profile}:${round5(from[0])},${round5(from[1])}->${round5(to[0])},${round5(to[1])}`
}

/** Initial bearing from A → B in degrees (0 = north, clockwise). */
export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const φ1 = (fromLat * Math.PI) / 180
  const φ2 = (toLat * Math.PI) / 180
  const Δλ = ((toLng - fromLng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const mins = Math.round(s / 60)
  if (mins < 60) return `${Math.max(1, mins)} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Rough urban drive ETA for search suggestion meta (no OSRM round-trip). */
export function estimateDriveMinutes(meters: number): number {
  const km = Math.max(0, meters) / 1000
  // ~32 km/h city average → minutes
  return Math.max(1, Math.round((km / 32) * 60))
}

/** Convert RouteResult [lat,lng][] → GeoJSON LineString [lng,lat][]. */
export function routeCoordsToLngLat(coords: [number, number][]): LonLat[] {
  return coords.map(([lat, lng]) => [lng, lat])
}

/**
 * Fetch an OSRM route for a given profile.
 * Throws Estonian Error messages (except AbortError).
 */
export async function fetchRouteProfile(
  from: [number, number],
  to: [number, number],
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const key = cacheKey(from, to, profile)
  const hit = cache.get(key)
  if (hit) return hit

  const [fromLat, fromLng] = from
  const [toLat, toLng] = to
  const path =
    `/api/osrm/route/v1/${profile}/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&steps=false`

  let res: Response
  try {
    res = await fetch(path, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error('Marsruuti ei õnnestunud leida (võrguviga)')
  }

  if (!res.ok) {
    throw new Error('Marsruuti ei õnnestunud leida')
  }

  let data: OsrmResponse
  try {
    data = (await res.json()) as OsrmResponse
  } catch {
    throw new Error('Marsruuti ei õnnestunud leida (tühi vastus)')
  }

  if (data.code !== 'Ok' || !data.routes?.[0]) {
    if (data.code === 'NoRoute') {
      throw new Error('Sihtkoht on liiga kaugel või teed ei leitud')
    }
    throw new Error('Marsruuti ei õnnestunud leida')
  }

  const route = data.routes[0]
  const lngLat = route.geometry?.coordinates
  if (!lngLat || lngLat.length < 2) {
    throw new Error('Marsruuti ei õnnestunud leida (tühi vastus)')
  }

  const result: RouteResult = {
    coords: lngLat.map(([lng, lat]) => [lat, lng] as [number, number]),
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    profile,
  }
  cache.set(key, result)
  return result
}

/** Driving route (user → parking / destination). */
export async function fetchRoute(
  from: [number, number],
  to: [number, number],
  signal?: AbortSignal,
): Promise<RouteResult> {
  return fetchRouteProfile(from, to, 'driving', signal)
}

/** Walking route (parking → house). Falls back to a straight segment if OSRM fails. */
export async function fetchWalkingRoute(
  from: [number, number],
  to: [number, number],
  signal?: AbortSignal,
): Promise<RouteResult> {
  try {
    return await fetchRouteProfile(from, to, 'foot', signal)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    // Straight-line fallback so the walk leg still renders
    const distM = haversineMeters(from[0], from[1], to[0], to[1])
    return {
      coords: [from, to],
      distanceMeters: distM,
      durationSeconds: Math.max(60, Math.round((distM / 1.4) * 1)), // ~1.4 m/s walk
      profile: 'foot',
    }
  }
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Legacy wrapper — returns null on failure (older call sites). */
export async function fetchDrivingRoute(
  from: [number, number],
  to: [number, number],
): Promise<DrivingRoute | null> {
  try {
    const r = await fetchRoute(from, to)
    const coordinates = routeCoordsToLngLat(r.coords)
    const [lng0, lat0] = coordinates[0]
    const look = coordinates[Math.min(8, coordinates.length - 1)]
    return {
      coordinates,
      callouts: [],
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
      bearing: bearingDegrees(lat0, lng0, look[1], look[0]),
    }
  } catch {
    return null
  }
}
