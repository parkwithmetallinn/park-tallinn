export type LonLat = [number, number]

export interface RouteCallout {
  id: string
  name: string
  lng: number
  lat: number
}

export interface DrivingRoute {
  coordinates: LonLat[]
  callouts: RouteCallout[]
  distanceMeters: number
  durationSeconds: number
  bearing: number
}

interface OsrmStep {
  name?: string
  maneuver?: {
    location?: [number, number]
    type?: string
    modifier?: string
    bearing_after?: number
  }
  geometry?: {
    coordinates?: LonLat[]
  }
}

interface OsrmResponse {
  code: string
  routes?: Array<{
    distance: number
    duration: number
    geometry: { coordinates: LonLat[] }
    legs?: Array<{ steps?: OsrmStep[] }>
  }>
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

export async function fetchDrivingRoute(
  from: [number, number],
  to: [number, number],
): Promise<DrivingRoute | null> {
  const [fromLat, fromLng] = from
  const [toLat, toLng] = to
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&steps=true&annotations=false`

  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as OsrmResponse
  if (data.code !== 'Ok' || !data.routes?.[0]) return null

  const route = data.routes[0]
  const coordinates = route.geometry.coordinates
  if (coordinates.length < 2) return null

  const callouts: RouteCallout[] = []
  const seen = new Set<string>()
  const steps = route.legs?.[0]?.steps ?? []

  for (const step of steps) {
    const name = (step.name || '').trim()
    const loc = step.maneuver?.location
    if (!name || !loc) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    // Prefer junctions / turns for callouts
    const kind = step.maneuver?.type
    if (kind && !['turn', 'new name', 'fork', 'end of road', 'continue', 'depart', 'arrive'].includes(kind)) {
      continue
    }
    seen.add(key)
    callouts.push({
      id: `c-${callouts.length}-${key.slice(0, 12)}`,
      name,
      lng: loc[0],
      lat: loc[1],
    })
    if (callouts.length >= 8) break
  }

  // Fallback: sample named points along geometry if OSRM gave few names
  if (callouts.length === 0 && coordinates.length > 2) {
    const mid = coordinates[Math.floor(coordinates.length / 2)]
    callouts.push({
      id: 'c-mid',
      name: 'Marsruut',
      lng: mid[0],
      lat: mid[1],
    })
  }

  const [lng0, lat0] = coordinates[0]
  const lookAhead = coordinates[Math.min(8, coordinates.length - 1)]
  const bearing = bearingDegrees(lat0, lng0, lookAhead[1], lookAhead[0])

  return {
    coordinates,
    callouts,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    bearing,
  }
}
