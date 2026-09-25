import { DISTRICT_ZONES } from './districts'
import { pointInPolygon } from '../lib/geojsonPolygons'
import type { ParkingProvider, ParkingSpot } from '../types'

const STREET_NAMES = [
  'Pikk',
  'Lai',
  'Tamme',
  'Kase',
  'Männi',
  'Sõpruse',
  'Ehitajate',
  'Akadeemia',
  'Laagna',
  'Pae',
  'Ümera',
  'Mooni',
  'Tedre',
  'Tööstuse',
  'Sõle',
  'Kopli',
  'Paldiski',
  'Pärnu',
  'Tartu',
  'Narva',
]

/**
 * Dense synthetic spots for scalability demos (thousands of points).
 * Mixes free streets, timed, EuroPark & Snabb so layer filters are testable.
 */
export function generateDenseStreetSpots(count = 2800): ParkingSpot[] {
  const districts = DISTRICT_ZONES.filter((d) => d.kind !== 'paid')
  const spots: ParkingSpot[] = []
  let i = 0

  while (spots.length < count && i < count * 8) {
    i++
    const d = districts[i % districts.length]
    const lats = d.coords.map((c) => c[0])
    const lngs = d.coords.map((c) => c[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)

    const a = ((i * 1103515245 + 12345) >>> 0) / 0xffffffff
    const b = ((i * 1664525 + 1013904223) >>> 0) / 0xffffffff
    const lat = minLat + a * (maxLat - minLat)
    const lng = minLng + b * (maxLng - minLng)
    if (!pointInPolygon(lat, lng, d.coords)) continue

    const inPaidCore = lat > 59.428 && lat < 59.442 && lng > 24.735 && lng < 24.765
    if (inPaidCore && i % 7 !== 0) continue

    const roll = i % 20
    let provider: ParkingProvider
    let type: ParkingSpot['type']
    let kind: ParkingSpot['kind']
    let badge: string
    let timeLimit: string
    let desc: string

    if (inPaidCore || roll === 0 || roll === 1) {
      provider = 'timed'
      type = 'timed'
      kind = 'street'
      badge = inPaidCore ? (i % 3 === 0 ? '15 min' : '30 min') : roll === 0 ? '30 min' : '2h'
      timeLimit = 'Ajapiirang · parkimiskell'
      desc = 'Tänavaäärne kellaga / ajapiiranguga koht.'
    } else if (roll === 2) {
      provider = 'europark'
      type = 'paid'
      kind = 'lot'
      badge = 'EuroPark'
      timeLimit = 'Tasuline (EuroPark)'
      desc = 'EuroPark eraparkla — kontrolli tariifi äpis / kohapeal.'
    } else if (roll === 3) {
      provider = 'snabb'
      type = 'paid'
      kind = 'lot'
      badge = 'Snabb'
      timeLimit = 'Tasuline (Snabb)'
      desc = 'Snabb eraparkla — digitaalne piletid.'
    } else {
      provider = 'free_street'
      type = 'free'
      kind = 'street'
      badge = 'TÄNAV'
      timeLimit = 'Piiranguta (vaata märke)'
      desc = 'Tänavaäärne tasuta parkimine.'
    }

    const street = STREET_NAMES[i % STREET_NAMES.length]
    const n = 1 + (i % 80)

    spots.push({
      id: `gen-street-${spots.length}`,
      name: `${provider === 'europark' || provider === 'snabb' ? badge : street + ' tn ' + n}`,
      type,
      kind,
      provider,
      badge,
      timeLimit,
      lat,
      lng,
      address: `${street} tn ${n}, ${d.name}`,
      desc,
      landmark: false,
    })
  }

  return spots
}
