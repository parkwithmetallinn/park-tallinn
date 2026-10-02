/**
 * Lazy parking-spot address resolution.
 * Priority: source field → In-AKS (Maa-amet) → Nominatim → Photon → "Aadress puudub".
 */

import pointOnFeature from '@turf/point-on-feature'
import { polygon as turfPolygon, lineString as turfLine } from '@turf/helpers'
import type { ParkingSpot } from '../types'
import { getCachedAddress, setCachedAddress } from './addressCache'
import { isRealAddress } from './isRealAddress'
import { wgs84ToLest97 } from './lest97'

export const MISSING_ADDRESS = 'Aadress puudub'

export type ResolvedSpotAddress = {
  address: string
  source: 'source' | 'inaks' | 'nominatim' | 'photon' | 'missing' | 'cache'
}

/** Global polite throttle for public reverse endpoints (≤1 req/s). */
let lastNetworkAt = 0
const MIN_GAP_MS = 1100

async function throttle(signal?: AbortSignal): Promise<void> {
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastNetworkAt))
  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, wait)
      const onAbort = () => {
        window.clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }
  lastNetworkAt = Date.now()
}

/** Representative point for reverse geocoding. */
export function representativePoint(spot: ParkingSpot): {
  lat: number
  lng: number
} {
  try {
    if (spot.polygon && spot.polygon.length >= 3) {
      const ring = spot.polygon.map(
        ([lat, lng]) => [lng, lat] as [number, number],
      )
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]])
      }
      const pt = pointOnFeature(turfPolygon([ring]))
      const [lng, lat] = pt.geometry.coordinates
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    }
    if (spot.line && spot.line.length >= 2) {
      const coords = spot.line.map(
        ([lat, lng]) => [lng, lat] as [number, number],
      )
      const mid = coords[Math.floor(coords.length / 2)]
      if (mid) return { lat: mid[1], lng: mid[0] }
      const pt = pointOnFeature(turfLine(coords))
      const [lng, lat] = pt.geometry.coordinates
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    }
  } catch {
    /* fall through to centroid */
  }
  return { lat: spot.lat, lng: spot.lng }
}

/** Normalize In-AKS / Nominatim district labels toward short Tallinn names. */
export function normalizeDistrict(raw?: string | null): string | undefined {
  if (!raw) return undefined
  let d = raw.trim()
  if (!d) return undefined
  d = d
    .replace(/\s*linnaosa$/i, '')
    .replace(/^Kesklinna$/i, 'Kesklinn')
    .replace(/^Põhja-Tallinna$/i, 'Põhja-Tallinn')
    .replace(/^City center$/i, 'Kesklinn')
    .trim()
  return d || undefined
}

export function formatAddressLine(parts: {
  street?: string
  houseNumber?: string
  district?: string
  city?: string
  nearOnly?: boolean
}): string | null {
  const street = parts.street?.trim()
  if (!street) return null
  const district = normalizeDistrict(parts.district)
  const hn = parts.houseNumber?.trim()
  const city = (parts.city || 'Tallinn').trim() || 'Tallinn'

  let head: string
  if (parts.nearOnly || !hn) {
    head = `${street} lähedal`
  } else {
    head = `${street} ${hn}`
  }

  const tail = [district, city].filter(Boolean).join(', ')
  return `${head}, ${tail}`
}

function splitStreetAndNumber(text: string): {
  street: string
  house?: string
} {
  const t = text.trim()
  const m = t.match(/^(.+?)\s+(\d+\w*)$/u)
  if (m) return { street: m[1].trim(), house: m[2] }
  return { street: t }
}

type InaksAddress = {
  aadresstekst?: string
  liikluspind?: string
  aadress_nr?: string
  asustusyksus?: string
  omavalitsus?: string
  asum?: string
  liik?: string
  liikVal?: string
  ipikkaadress?: string
}

async function reverseInaks(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const { easting, northing } = wgs84ToLest97(lon, lat)
  // In-AKS: x = easting (~6 digits), y = northing (~7 digits); nearest=1
  const params = new URLSearchParams({
    x: easting.toFixed(2),
    y: northing.toFixed(2),
    nearest: '1',
    results: '5',
    unik: '0',
  })
  await throttle(signal)
  // Prefer same-origin proxy (Vite/Vercel injects User-Agent). Direct URL as fallback.
  const urls = [
    `/api/inaks/gazetteer?${params}`,
    `https://aks.geoportaal.ee/inaks/inaadress/gazetteer?${params}`,
  ]
  let data: { addresses?: InaksAddress[]; error?: string } | null = null
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal,
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue
      const text = await res.text()
      if (!text || text.trimStart().startsWith('<')) continue
      data = JSON.parse(text) as { addresses?: InaksAddress[]; error?: string }
      break
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
    }
  }
  if (!data || data.error || !data.addresses?.length) return null

  // Prefer building / plot with house number over street / EHAK
  const ranked = [...data.addresses].sort((a, b) => {
    const score = (x: InaksAddress) => {
      let s = 0
      if (x.aadress_nr) s += 4
      if (x.liikluspind) s += 2
      if (x.liik === '3' || /HOONE|EHITIS/i.test(x.liikVal ?? '')) s += 3
      if (x.liik === 'E' || /KATASTER|KÜ/i.test(x.liikVal ?? '')) s += 1
      return s
    }
    return score(b) - score(a)
  })

  for (const a of ranked) {
    let house = (a.aadress_nr || '').trim()
    let streetOnly = ''

    if (a.liikluspind?.trim()) {
      const split = splitStreetAndNumber(a.liikluspind)
      streetOnly = split.street
      if (!house && split.house) house = split.house
    } else if (a.aadresstekst?.trim()) {
      const split = splitStreetAndNumber(a.aadresstekst)
      streetOnly = split.street
      if (!house && split.house) house = split.house
    }

    if (!streetOnly) continue
    // Skip pure park / place names without a house number
    if (/park$/i.test(streetOnly) && !house) continue

    streetOnly = streetOnly.replace(/\s+T\d+$/i, '').trim()
    const district = a.asustusyksus || a.asum
    const city = /tallinn/i.test(a.omavalitsus ?? '')
      ? 'Tallinn'
      : a.omavalitsus?.trim() || 'Tallinn'
    const line = formatAddressLine({
      street: streetOnly,
      houseNumber: house,
      district,
      city,
      nearOnly: !house,
    })
    if (line && isRealAddress(line)) return line
  }
  return null
}

async function reverseNominatim(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'json',
    addressdetails: '1',
    zoom: '18',
  })
  await throttle(signal)
  const res = await fetch(`/api/nominatim/reverse?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    address?: {
      road?: string
      pedestrian?: string
      footway?: string
      house_number?: string
      suburb?: string
      city_district?: string
      quarter?: string
      city?: string
      town?: string
    }
  }
  const addr = data.address
  if (!addr) return null
  const street = addr.road || addr.pedestrian || addr.footway
  const district =
    addr.suburb || addr.city_district || addr.quarter
  return formatAddressLine({
    street,
    houseNumber: addr.house_number,
    district,
    nearOnly: !addr.house_number,
  })
}

async function reversePhoton(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const params = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    lang: 'en',
  })
  await throttle(signal)
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?${params}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      features?: Array<{
        properties?: {
          street?: string
          housenumber?: string
          district?: string
          locality?: string
          city?: string
          name?: string
        }
      }>
    }
    const p = data.features?.[0]?.properties
    if (!p) return null
    const street = p.street || p.name
    return formatAddressLine({
      street,
      houseNumber: p.housenumber,
      district: p.locality || p.district,
      nearOnly: !p.housenumber,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return null
  }
}

/**
 * Resolve a display address for the bottom-sheet line.
 * Uses cache; cancels via AbortSignal when the user opens another spot.
 */
export async function resolveSpotAddress(
  spot: ParkingSpot,
  signal?: AbortSignal,
): Promise<ResolvedSpotAddress> {
  const cached = getCachedAddress(spot.id)
  if (cached && cached.source !== 'missing') {
    return { address: cached.address, source: 'cache' }
  }

  if (
    isRealAddress(spot.address, { name: spot.name, code: spot.zone_code })
  ) {
    const address = spot.address.trim()
    setCachedAddress(spot.id, address, 'source')
    return { address, source: 'source' }
  }

  const { lat, lng } = representativePoint(spot)

  try {
    const inaks = await reverseInaks(lng, lat, signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (inaks) {
      setCachedAddress(spot.id, inaks, 'inaks')
      return { address: inaks, source: 'inaks' }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
  }

  try {
    const nom = await reverseNominatim(lng, lat, signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (nom && isRealAddress(nom, { name: spot.name, code: spot.zone_code })) {
      setCachedAddress(spot.id, nom, 'nominatim')
      return { address: nom, source: 'nominatim' }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
  }

  try {
    const ph = await reversePhoton(lng, lat, signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (ph && isRealAddress(ph, { name: spot.name, code: spot.zone_code })) {
      setCachedAddress(spot.id, ph, 'photon')
      return { address: ph, source: 'photon' }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
  }

  // Memory-only; not written to localStorage (see addressCache).
  setCachedAddress(spot.id, MISSING_ADDRESS, 'missing')
  return { address: MISSING_ADDRESS, source: 'missing' }
}
