import { DISTRICT_ZONES } from './districts'
import { pointInPolygon } from '../lib/geojsonPolygons'
import { normalizeSpot } from '../lib/geojson'
import type { ParkingLayerKey, ParkingSpot } from '../types'

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
 * Mixes free streets, timed, EuroPark, Snabb, Citypark so layer filters are testable.
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

    const roll = i % 24
    let layer: ParkingLayerKey
    let type: ParkingSpot['type']
    let kind: ParkingSpot['kind']
    let badge: string
    let timeLimit: string
    let desc: string
    let free_minutes = 0
    let price_per_hour = 0
    let zone_code = 'FREE'

    if (inPaidCore || roll === 0 || roll === 1) {
      layer = 'timed'
      type = 'timed'
      kind = 'street'
      badge = inPaidCore ? (i % 3 === 0 ? '15 min' : '30 min') : roll === 0 ? '30 min' : '2h'
      free_minutes = badge.includes('15') ? 15 : badge.includes('30') ? 30 : 120
      price_per_hour = 2.5
      zone_code = 'KESKLINN'
      timeLimit = 'Ajapiirang · parkimiskell'
      desc = 'Tänavaäärne kellaga / ajapiiranguga koht.'
    } else if (roll === 2) {
      layer = 'europark'
      type = 'paid'
      kind = 'lot'
      badge = 'EuroPark'
      zone_code = 'EP'
      price_per_hour = 3.5
      timeLimit = 'Tasuline (EuroPark)'
      desc = 'EuroPark eraparkla — kontrolli tariifi äpis / kohapeal.'
    } else if (roll === 3) {
      layer = 'snabb'
      type = 'paid'
      kind = 'lot'
      badge = 'Snabb'
      zone_code = 'SN'
      price_per_hour = 3.2
      timeLimit = 'Tasuline (Snabb)'
      desc = 'Snabb eraparkla — digitaalne piletid.'
    } else if (roll === 4) {
      layer = 'citypark'
      type = 'paid'
      kind = 'lot'
      badge = 'Citypark'
      zone_code = 'CP'
      price_per_hour = 3.0
      timeLimit = 'Tasuline (Citypark)'
      desc = 'Citypark eraparkla.'
    } else if (roll === 5) {
      layer = 'ev'
      type = 'timed'
      kind = 'lot'
      badge = 'EV'
      zone_code = 'EV'
      timeLimit = 'Elektrilaadija'
      desc = 'Sünteetiline EV-laadija demo.'
    } else {
      layer = 'free_street'
      type = 'free'
      kind = 'street'
      badge = 'TÄNAV'
      timeLimit = 'Piiranguta (vaata märke)'
      desc = 'Tänavaäärne tasuta parkimine.'
    }

    const street = STREET_NAMES[i % STREET_NAMES.length]
    const n = 1 + (i % 80)

    spots.push(
      normalizeSpot({
        id: `gen-street-${spots.length}`,
        name:
          layer === 'europark' || layer === 'snabb' || layer === 'citypark'
            ? badge
            : `${street} tn ${n}`,
        type,
        kind,
        layer,
        zone_code,
        free_minutes,
        price_per_hour,
        badge,
        timeLimit,
        lat,
        lng,
        address: `${street} tn ${n}, ${d.name}`,
        desc,
        landmark: false,
      }),
    )
  }

  return spots
}
