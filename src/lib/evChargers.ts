/**
 * Public EV chargers from public/data/ev_chargers.geojson (OSM Overpass extract).
 * Private access stations are excluded. Unified under "Elektriautolaadijad".
 */

import type { Map as MapLibreMapType } from 'maplibre-gl'
import { normalizeSpot } from './geojson'
import type { ParkingOperator, ParkingSpot } from '../types'

export const EV_CHARGERS_URL = '/data/ev_chargers.geojson'
export const EV_CHARGERS_SOURCE = 'ev-chargers'
export const EV_CHARGERS_GLOW_LAYER = 'ev-chargers-glow'
export const EV_CHARGERS_CIRCLE_LAYER = 'ev-chargers-circle'
export const EV_CHARGERS_SYMBOL_LAYER = 'ev-chargers-symbol'
export const EV_CHARGERS_HIT_LAYER = 'ev-chargers-hit'

/** Electric cyan / light blue — distinct from free-parking green. */
export const EV_COLOR_CYAN = '#00F0FF'
export const EV_COLOR_BLUE = '#0284C7'

export type EvChargerProps = {
  id: string
  name: string
  operator: string
  brand?: string
  access: string
  fee: string
  charge?: string
  capacity?: string | number
  sockets: string[]
  maxPowerKw: number | null
  priceLabel: string
  feeKind: 'free' | 'paid' | 'unknown'
  address: string
  website?: string
  opening_hours?: string
  description?: string
  color: string
}

export type EvChargerFeature = {
  type: 'Feature'
  id: string
  properties: EvChargerProps
  geometry: { type: 'Point'; coordinates: [number, number] }
}

export type EvChargerCollection = {
  type: 'FeatureCollection'
  features: EvChargerFeature[]
}

type RawFeature = {
  type?: string
  id?: string | number
  properties?: Record<string, unknown> | null
  geometry?: {
    type: string
    coordinates?: number[] | number[][] | number[][][]
  } | null
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function isPrivateAccess(accessRaw: unknown): boolean {
  const a = str(accessRaw).toLowerCase()
  return a === 'private' || a === 'no'
}

/** Parse socket:* tags into human labels + max kW. */
export function parseSocketsAndPower(p: Record<string, unknown>): {
  sockets: string[]
  maxPowerKw: number | null
} {
  const sockets: string[] = []
  let maxKw: number | null = null

  const take = (key: string, label: string) => {
    const count = str(p[key])
    const out = str(p[`${key}:output`] || p[`${key}:output:max`])
    if (!count && !out) return
    const n = parseInt(count, 10)
    const labelWithCount =
      Number.isFinite(n) && n > 1 ? `${label} ×${n}` : label
    sockets.push(labelWithCount)
    const kwMatch = out.match(/(\d+(?:\.\d+)?)\s*kW/i) || out.match(/^(\d+(?:\.\d+)?)$/)
    if (kwMatch) {
      const kw = parseFloat(kwMatch[1])
      if (Number.isFinite(kw)) maxKw = maxKw == null ? kw : Math.max(maxKw, kw)
    }
  }

  take('socket:type2_combo', 'CCS')
  take('socket:type2', 'Type 2')
  take('socket:chademo', 'CHAdeMO')
  take('socket:tesla_supercharger', 'Tesla SC')
  take('socket:nacs', 'NACS')
  take('socket:tesla_destination', 'Tesla Dest')
  take('socket:type2_cable', 'Type 2 cable')

  // Free-text fallbacks
  const desc = `${str(p.description)} ${str(p.name)}`
  if (!sockets.length) {
    if (/ccs|combo/i.test(desc)) sockets.push('CCS')
    if (/type\s*2|mennekes/i.test(desc)) sockets.push('Type 2')
    if (/chademo/i.test(desc)) sockets.push('CHAdeMO')
  }
  if (maxKw == null) {
    const m = desc.match(/(\d{2,3})\s*kW/i)
    if (m) maxKw = parseInt(m[1], 10)
  }

  return { sockets, maxPowerKw: maxKw }
}

export function parseEvFee(p: Record<string, unknown>): {
  feeKind: 'free' | 'paid' | 'unknown'
  priceLabel: string
} {
  const fee = str(p.fee).toLowerCase()
  const charge = str(p.charge)
  if (fee === 'no' || fee === 'free') {
    return { feeKind: 'free', priceLabel: 'TASUTA' }
  }
  if (charge) {
    // Prefer €/kWh style
    const kwh = charge.match(/(\d+(?:[.,]\d+)?)\s*(?:€|eur)?\s*\/?\s*kWh/i)
    if (kwh) {
      return {
        feeKind: 'paid',
        priceLabel: `${kwh[1].replace(',', '.')} €/kWh`,
      }
    }
    return { feeKind: 'paid', priceLabel: charge.slice(0, 28) }
  }
  if (fee === 'yes' || fee.includes('€') || fee.includes('eur')) {
    return { feeKind: 'paid', priceLabel: 'TASULINE' }
  }
  if (fee) return { feeKind: 'paid', priceLabel: 'TASULINE' }
  return { feeKind: 'unknown', priceLabel: 'TASULINE' }
}

function buildAddress(p: Record<string, unknown>): string {
  const street = str(p['addr:street'])
  const hn = str(p['addr:housenumber'])
  const city = str(p['addr:city'])
  const line = [street && hn ? `${street} ${hn}` : street || hn, city]
    .filter(Boolean)
    .join(', ')
  return line
}

function displayOperator(p: Record<string, unknown>): string {
  const op = str(p.operator) || str(p.brand) || str(p.network)
  if (!op) return 'Elektrilaadija'
  const lower = op.toLowerCase()
  if (lower.includes('enefit')) return 'Enefit Volt'
  if (lower.includes('eleport')) return 'Eleport'
  if (lower.includes('ignitis')) return 'Ignitis'
  if (lower.includes('alexela')) return 'Alexela'
  if (lower.includes('circle')) return 'Circle K'
  if (lower.includes('tesla')) return 'Tesla'
  if (lower.includes('neste')) return 'Neste'
  if (lower.includes('elektrum')) return 'Elektrum'
  if (lower.includes('elmo')) return 'Elmo'
  return op
}

function displayName(p: Record<string, unknown>, operator: string): string {
  const name = str(p.name) || str(p['name:et']) || str(p.brand)
  if (name) return name
  const street = str(p['addr:street'])
  if (street) return `${operator} · ${street}`
  return operator
}

/** Prepare raw GeoJSON — drop private access, normalize properties. */
export function prepareEvChargers(raw: {
  type?: string
  features?: RawFeature[]
}): EvChargerCollection {
  const features: EvChargerFeature[] = []
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {}
    if (str(p.amenity) && str(p.amenity) !== 'charging_station') continue
    if (isPrivateAccess(p.access)) continue

    const geom = f.geometry
    if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) continue
    const [lng, lat] = geom.coordinates as number[]
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const id = str(p.id ?? p['@id'] ?? f.id) || `ev-${features.length}`
    const operator = displayOperator(p)
    const name = displayName(p, operator)
    const { sockets, maxPowerKw } = parseSocketsAndPower(p)
    const { feeKind, priceLabel } = parseEvFee(p)
    const capacity = p.capacity

    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name,
        operator,
        brand: str(p.brand) || undefined,
        access: str(p.access) || 'yes',
        fee: str(p.fee),
        charge: str(p.charge) || undefined,
        capacity: capacity as string | number | undefined,
        sockets,
        maxPowerKw,
        priceLabel,
        feeKind,
        address: buildAddress(p) || name,
        website: str(p.website) || undefined,
        opening_hours: str(p.opening_hours) || undefined,
        description: str(p.description) || undefined,
        color: EV_COLOR_CYAN,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function evFeatureToSpot(f: EvChargerFeature): ParkingSpot {
  const [lng, lat] = f.geometry.coordinates
  const p = f.properties
  const power = p.maxPowerKw ? `${p.maxPowerKw} kW` : null
  const sockets = p.sockets.length ? p.sockets.join(', ') : null
  const capacity =
    p.capacity != null && str(p.capacity) !== ''
      ? `${p.capacity} kohta`
      : null

  return normalizeSpot({
    id: p.id,
    name: p.name,
    featureType: 'ev-charger',
    operator: p.operator as ParkingOperator,
    layer: 'ev',
    zone_code: 'EV',
    free_minutes: 0,
    price_per_hour: p.feeKind === 'free' ? 0 : 0,
    badge: 'EV',
    timeLimit: power || 'Elektrilaadija',
    lat,
    lng,
    address: p.address,
    desc: [p.priceLabel, capacity, sockets, power, p.description]
      .filter(Boolean)
      .join(' · '),
    type: p.feeKind === 'free' ? 'free' : 'paid',
    kind: 'lot',
    landmark: true,
    source: 'OSM charging_station',
    freeReason: 'Elektrilaadija',
    exemptions: ['ev_m1'],
    verifyOnSite: true,
  })
}

export function evCollectionToSpots(fc: EvChargerCollection): ParkingSpot[] {
  return fc.features.map(evFeatureToSpot)
}

let cached: Promise<EvChargerCollection> | null = null

export function loadEvChargers(): Promise<EvChargerCollection> {
  if (!cached) {
    cached = fetch(EV_CHARGERS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`EV chargers HTTP ${r.status}`)
        return r.json()
      })
      .then((raw) => prepareEvChargers(raw))
      .catch((err) => {
        console.warn('[ev] failed to load chargers', err)
        cached = null
        return { type: 'FeatureCollection' as const, features: [] }
      })
  }
  return cached
}

/** Filter collection for the active top chip. */
export function filterEvCollection(
  fc: EvChargerCollection,
  mode: 'all' | 'ev' | 'hide',
): EvChargerCollection {
  if (mode === 'hide') {
    return { type: 'FeatureCollection', features: [] }
  }
  // `all` and `ev` both show the full public set
  return fc
}

/**
 * Neighborhood / street zoom only — city-wide EV icon clutter is too dense
 * below this (district / whole-city views).
 */
export const EV_CHARGERS_MIN_ZOOM = 13

const EV_LAYER_IDS = [
  EV_CHARGERS_GLOW_LAYER,
  EV_CHARGERS_CIRCLE_LAYER,
  EV_CHARGERS_SYMBOL_LAYER,
  EV_CHARGERS_HIT_LAYER,
] as const

/** Soft cyan glow + bolt circle layers for EV chargers. */
export function ensureEvChargerLayers(map: MapLibreMapType) {
  if (!map.getSource(EV_CHARGERS_SOURCE)) {
    map.addSource(EV_CHARGERS_SOURCE, {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(EV_CHARGERS_GLOW_LAYER)) {
    map.addLayer({
      id: EV_CHARGERS_GLOW_LAYER,
      type: 'circle',
      source: EV_CHARGERS_SOURCE,
      minzoom: EV_CHARGERS_MIN_ZOOM,
      layout: { visibility: 'none' },
      paint: {
        'circle-color': EV_COLOR_CYAN,
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          13,
          10,
          15,
          18,
          17,
          26,
        ],
        'circle-opacity': 0.28,
        'circle-blur': 0.85,
      },
    })
  }

  if (!map.getLayer(EV_CHARGERS_CIRCLE_LAYER)) {
    map.addLayer({
      id: EV_CHARGERS_CIRCLE_LAYER,
      type: 'circle',
      source: EV_CHARGERS_SOURCE,
      minzoom: EV_CHARGERS_MIN_ZOOM,
      layout: { visibility: 'none' },
      paint: {
        'circle-color': EV_COLOR_BLUE,
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          13,
          5,
          15,
          8,
          17,
          11,
        ],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': EV_COLOR_CYAN,
        'circle-opacity': 0.95,
      },
    })
  }

  if (!map.getLayer(EV_CHARGERS_SYMBOL_LAYER)) {
    map.addLayer({
      id: EV_CHARGERS_SYMBOL_LAYER,
      type: 'symbol',
      source: EV_CHARGERS_SOURCE,
      minzoom: EV_CHARGERS_MIN_ZOOM,
      layout: {
        visibility: 'none',
        // Short "EV" label — emoji glyphs often 404 on OpenFreeMap fonts
        'text-field': 'EV',
        'text-font': ['Noto Sans Bold'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          13,
          9,
          15,
          11,
          17,
          12,
        ],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'icon-allow-overlap': true,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': EV_COLOR_BLUE,
        'text-halo-width': 0.8,
      },
    })
  }

  // Invisible hit target for easier taps
  if (!map.getLayer(EV_CHARGERS_HIT_LAYER)) {
    map.addLayer({
      id: EV_CHARGERS_HIT_LAYER,
      type: 'circle',
      source: EV_CHARGERS_SOURCE,
      minzoom: EV_CHARGERS_MIN_ZOOM,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 18,
        'circle-opacity': 0.01,
        'circle-color': '#000000',
      },
    })
  }

  // HMR / remount: keep minzoom in sync if layers already exist
  for (const id of EV_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayerZoomRange(id, EV_CHARGERS_MIN_ZOOM, 24)
    }
  }
}

export function setEvChargerVisibility(map: MapLibreMapType, visible: boolean) {
  const vis = visible ? 'visible' : 'none'
  for (const id of EV_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', vis)
    }
  }
}

export function setEvChargerData(map: MapLibreMapType, fc: EvChargerCollection) {
  const src = map.getSource(EV_CHARGERS_SOURCE)
  if (src && 'setData' in src && typeof src.setData === 'function') {
    src.setData(fc)
  }
}
