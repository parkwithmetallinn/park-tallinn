/**
 * Multi-city registry. Tallinn remains the default; other cities are additive layers.
 */

export type CityId = 'tallinn' | 'parnu'

export type CityConfig = {
  id: CityId
  /** Short UI label */
  label: string
  /** Map default center [lat, lng] */
  center: [number, number]
  /** Default fly zoom */
  zoom: number
  /** Nominatim viewbox: west,south,east,north */
  viewbox: string
  /** Parking master GeoJSON (lots + streets). Tallinn uses the Estonia master. */
  parkingUrl: string
  /** When true, show Tallinn district GIS overlays */
  showTallinnDistricts: boolean
}

export const CITIES: Record<CityId, CityConfig> = {
  tallinn: {
    id: 'tallinn',
    label: 'Tallinn',
    center: [59.437, 24.7535],
    zoom: 12.2,
    viewbox: '24.55,59.35,25.00,59.55',
    parkingUrl: '/data/ee_parking_max.geojson',
    showTallinnDistricts: true,
  },
  parnu: {
    id: 'parnu',
    label: 'Pärnu',
    center: [58.3859, 24.4971],
    zoom: 13.1,
    viewbox: '24.40,58.33,24.65,58.45',
    parkingUrl: '/data/parnu_parking_master.geojson',
    showTallinnDistricts: false,
  },
}

export const CITY_LIST: CityConfig[] = [CITIES.tallinn, CITIES.parnu]

export const CITY_STORAGE_KEY = 'parktallinn:city:v1'

export function getInitialCity(): CityId {
  try {
    const raw = localStorage.getItem(CITY_STORAGE_KEY)
    if (raw === 'parnu' || raw === 'tallinn') return raw
  } catch {
    /* ignore */
  }
  return 'tallinn'
}

export function persistCity(id: CityId) {
  try {
    localStorage.setItem(CITY_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

/** Infer active parking layer from a destination (no manual city toggle). */
export function cityFromCoords(lat: number, lng: number): CityId {
  // Pärnu metro approx.
  if (lat >= 58.3 && lat <= 58.5 && lng >= 24.35 && lng <= 24.7) return 'parnu'
  return 'tallinn'
}
