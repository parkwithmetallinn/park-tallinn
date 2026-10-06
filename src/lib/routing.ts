/**
 * Dual-leg routing via same-origin proxies (Vite / Vercel).
 *
 * App coords are [lat, lng]; OSRM wants lng,lat in the URL and GeoJSON.
 *
 * Providers (community fair-use — replace for heavy production with Mapbox
 * Directions, Valhalla, OpenRouteService, or a self-hosted OSRM):
 *   car:  /api/route-car  → routing.openstreetmap.de/routed-car
 *         fallback        → router.project-osrm.org (car only)
 *   foot: /api/route-foot → routing.openstreetmap.de/routed-foot
 */

import { distanceMeters } from './geo'

export type LonLat = [number, number]

/** @deprecated Prefer RouteMode */
export type RouteProfile = 'driving' | 'foot'

export type RouteMode = 'driving' | 'walking'

/** App-facing route geometry — [lat, lng] for drawing helpers / camera. */
export type RouteResult = {
  coords: [number, number][]
  distanceMeters: number
  durationSeconds: number
  /** Present when this is a straight-line substitute for a failed walk request */
  isFallback?: boolean
  /** @deprecated Prefer RouteMode on the caller */
  profile?: RouteProfile
}

/** Drive to parking + optional walk from parking to the searched destination. */
export type RoutePlan = {
  /** Driving leg: user → parking (null if drive failed) */
  drive: RouteResult | null
  /** Walking leg: parking → destination (null when no separate destination) */
  walk: RouteResult | null
  parking: [number, number]
  destination: [number, number] | null
  /** True when walk distance warrants a "Pikk jalutuskäik" chip */
  longWalk?: boolean
  /** Toast hint when walk router failed and fallback was used */
  walkFailed?: boolean
}

/**
 * App bundle used by MapView / summary card.
 * Extends RoutePlan with a display label for the parking target.
 */
export type NavRouteBundle = RoutePlan & {
  /** Label for the parking / destination target */
  label: string
  /** @deprecated Alias of destination */
  house: [number, number]
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

interface OsrmNearestResponse {
  code: string
  waypoints?: Array<{
    location?: LonLat
    distance?: number
    name?: string
  }>
}

const routeCache = new Map<string, RouteResult>()
const nearestCache = new Map<string, [number, number]>()

const REQUEST_TIMEOUT_MS = 8_000
/** Skip walking request when parking is essentially at the destination. */
const WALK_SKIP_M = 30
/** Warn when the walk is long (≥ 1.5 km) or a big detour vs straight line. */
const LONG_WALK_M = 1_500
const LONG_WALK_DETOUR_RATIO = 4
const LONG_WALK_DETOUR_MIN_M = 800
/** Bridge tiny gaps between drive end and walk start. */
const CONNECTOR_GAP_M = 5

function round5(n: number) {
  return Math.round(n * 1e5) / 1e5
}

function cacheKey(
  from: [number, number],
  to: [number, number],
  mode: RouteMode,
) {
  return `${mode}:${round5(from[0])},${round5(from[1])}->${round5(to[0])},${round5(to[1])}`
}

function nearestKey(point: [number, number]) {
  return `near:${round5(point[0])},${round5(point[1])}`
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

function withTimeoutSignal(
  outer?: AbortSignal,
  ms = REQUEST_TIMEOUT_MS,
): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener('abort', onAbort, { once: true })
  }
  const timer = window.setTimeout(() => ctrl.abort(), ms)
  return {
    signal: ctrl.signal,
    clear: () => {
      window.clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    },
  }
}

function straightWalkFallback(
  from: [number, number],
  to: [number, number],
): RouteResult {
  const distM = distanceMeters(from[0], from[1], to[0], to[1])
  return {
    coords: [from, to],
    distanceMeters: distM,
    // ~1.4 m/s walking pace
    durationSeconds: Math.max(60, Math.round(distM / 1.4)),
    isFallback: true,
    profile: 'foot',
  }
}

function isLongWalk(walk: RouteResult, straightM: number): boolean {
  if (walk.distanceMeters >= LONG_WALK_M) return true
  return (
    walk.distanceMeters > LONG_WALK_DETOUR_MIN_M &&
    straightM > 0 &&
    walk.distanceMeters / straightM > LONG_WALK_DETOUR_RATIO
  )
}

/**
 * Snap a point to the nearest walkable OSRM node on the foot instance.
 * Returns [lat, lng]. Falls back to the original point on failure.
 */
export async function snapToWalkNetwork(
  point: [number, number],
  signal?: AbortSignal,
): Promise<[number, number]> {
  const key = nearestKey(point)
  const hit = nearestCache.get(key)
  if (hit) return hit

  const [lat, lng] = point
  const path = `/api/route-foot/nearest/v1/foot/${lng},${lat}?number=1`
  const { signal: timed, clear } = withTimeoutSignal(signal)
  try {
    const res = await fetch(path, {
      signal: timed,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return point
    const data = (await res.json()) as OsrmNearestResponse
    const loc = data.waypoints?.[0]?.location
    if (!loc || loc.length < 2) return point
    const snapped: [number, number] = [loc[1], loc[0]]
    nearestCache.set(key, snapped)
    return snapped
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return point
  } finally {
    clear()
  }
}

async function fetchOsrmRoute(
  url: string,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const { signal: timed, clear } = withTimeoutSignal(signal)
  try {
    let res: Response
    try {
      res = await fetch(url, {
        signal: timed,
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

    return {
      coords: lngLat.map(([lng, lat]) => [lat, lng] as [number, number]),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    }
  } finally {
    clear()
  }
}

/**
 * Fetch a single-leg route.
 * Driving prefers the OSM car instance, then project-osrm fallback.
 * Walking uses the OSM foot instance (pedestrian shortcuts).
 */
export async function fetchRoute(
  from: [number, number],
  to: [number, number],
  mode: RouteMode,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const key = cacheKey(from, to, mode)
  const hit = routeCache.get(key)
  if (hit) return hit

  const [fromLat, fromLng] = from
  const [toLat, toLng] = to
  const coords = `${fromLng},${fromLat};${toLng},${toLat}`
  const qs = 'overview=full&geometries=geojson&steps=false&alternatives=false'

  let result: RouteResult

  if (mode === 'walking') {
    // Path segment name is ignored by the OSM foot instance; keep `foot` for clarity.
    const url = `/api/route-foot/route/v1/foot/${coords}?${qs}`
    result = await fetchOsrmRoute(url, signal)
    result = { ...result, profile: 'foot' }
  } else {
    const primary = `/api/route-car/route/v1/driving/${coords}?${qs}`
    const fallback = `/api/osrm/route/v1/driving/${coords}?${qs}`
    try {
      result = await fetchOsrmRoute(primary, signal)
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      result = await fetchOsrmRoute(fallback, signal)
    }
    result = { ...result, profile: 'driving' }
  }

  routeCache.set(key, result)
  return result
}

/** @deprecated Prefer fetchRoute(..., 'driving') */
export async function fetchRouteProfile(
  from: [number, number],
  to: [number, number],
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const mode: RouteMode = profile === 'foot' ? 'walking' : 'driving'
  return fetchRoute(from, to, mode, signal)
}

/**
 * Prepend/append original endpoints so the polyline visually starts/ends
 * at the parking marker and destination pin (after network snapping).
 */
function stitchWalkEndpoints(
  walk: RouteResult,
  parking: [number, number],
  destination: [number, number],
): RouteResult {
  const coords = [...walk.coords]
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (
    !first ||
    distanceMeters(first[0], first[1], parking[0], parking[1]) > 0.5
  ) {
    coords.unshift(parking)
  } else {
    coords[0] = parking
  }
  if (
    !last ||
    distanceMeters(last[0], last[1], destination[0], destination[1]) > 0.5
  ) {
    coords.push(destination)
  } else {
    coords[coords.length - 1] = destination
  }
  return { ...walk, coords }
}

/** Tiny connector so the drive end meets the walk start when they diverge. */
function connectDriveToWalk(
  drive: RouteResult,
  walkStart: [number, number],
): RouteResult {
  const end = drive.coords[drive.coords.length - 1]
  if (!end) return drive
  const gap = distanceMeters(end[0], end[1], walkStart[0], walkStart[1])
  if (gap <= CONNECTOR_GAP_M) {
    // Snap the last drive vertex onto the walk start for a seamless join
    if (gap > 0.5) {
      return {
        ...drive,
        coords: [...drive.coords.slice(0, -1), walkStart],
      }
    }
    return drive
  }
  return {
    ...drive,
    coords: [...drive.coords, walkStart],
  }
}

/**
 * Build a full nav plan: drive user→parking + walk parking→destination.
 * Legs are requested in parallel. Walk failures yield a straight-line fallback.
 */
export async function fetchRoutePlan(args: {
  from: [number, number]
  parking: [number, number]
  destination: [number, number] | null
  signal?: AbortSignal
}): Promise<RoutePlan> {
  const { from, parking, destination, signal } = args

  const needWalk =
    destination != null &&
    distanceMeters(parking[0], parking[1], destination[0], destination[1]) >=
      WALK_SKIP_M

  const drivePromise = fetchRoute(from, parking, 'driving', signal).then(
    (r) => ({ ok: true as const, value: r }),
    (e) => {
      if ((e as Error).name === 'AbortError') throw e
      return { ok: false as const, error: e as Error }
    },
  )

  const walkPromise: Promise<{
    ok: boolean
    value?: RouteResult
    failed?: boolean
  }> = (async () => {
    if (!needWalk || !destination) {
      return { ok: true, value: undefined }
    }
    try {
      const [snapPark, snapDest] = await Promise.all([
        snapToWalkNetwork(parking, signal),
        snapToWalkNetwork(destination, signal),
      ])
      const raw = await fetchRoute(snapPark, snapDest, 'walking', signal)
      const stitched = stitchWalkEndpoints(raw, parking, destination)
      return { ok: true, value: stitched, failed: false }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      return {
        ok: true,
        value: straightWalkFallback(parking, destination),
        failed: true,
      }
    }
  })()

  const [driveSettled, walkSettled] = await Promise.all([
    drivePromise,
    walkPromise,
  ])

  let drive: RouteResult | null = driveSettled.ok ? driveSettled.value : null
  const walk = walkSettled.value ?? null
  const walkFailed = Boolean(walkSettled.failed)

  if (drive && walk && walk.coords.length > 0) {
    drive = connectDriveToWalk(drive, walk.coords[0])
  }

  const straightM =
    destination != null
      ? distanceMeters(
          parking[0],
          parking[1],
          destination[0],
          destination[1],
        )
      : 0

  return {
    drive,
    walk,
    parking,
    destination,
    longWalk: walk && !walk.isFallback ? isLongWalk(walk, straightM) : false,
    walkFailed,
  }
}

/** Walking route with straight-line fallback (legacy helper). */
export async function fetchWalkingRoute(
  from: [number, number],
  to: [number, number],
  signal?: AbortSignal,
): Promise<RouteResult> {
  const dist = distanceMeters(from[0], from[1], to[0], to[1])
  if (dist < WALK_SKIP_M) {
    return {
      coords: [from, to],
      distanceMeters: dist,
      durationSeconds: Math.max(30, Math.round(dist / 1.4)),
      profile: 'foot',
    }
  }
  try {
    const [snapFrom, snapTo] = await Promise.all([
      snapToWalkNetwork(from, signal),
      snapToWalkNetwork(to, signal),
    ])
    const raw = await fetchRoute(snapFrom, snapTo, 'walking', signal)
    return stitchWalkEndpoints(raw, from, to)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return straightWalkFallback(from, to)
  }
}

/** Legacy wrapper — returns null on failure (older call sites). */
export async function fetchDrivingRoute(
  from: [number, number],
  to: [number, number],
): Promise<DrivingRoute | null> {
  try {
    const r = await fetchRoute(from, to, 'driving')
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
