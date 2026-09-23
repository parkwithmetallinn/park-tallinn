import { DISTRICT_ZONES } from './districts'
import type { ParkingSpot } from '../types'
import { pointInPolygon } from '../lib/geojson'

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
 * Dense synthetic street-side spots inside free/mixed districts.
 * Keeps curated PARKING_SPOTS as landmarks; this layer demonstrates
 * zoom clustering at city scale (thousands of pins).
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

    // Deterministic pseudo-random from index
    const a = ((i * 1103515245 + 12345) >>> 0) / 0xffffffff
    const b = ((i * 1664525 + 1013904223) >>> 0) / 0xffffffff
    const lat = minLat + a * (maxLat - minLat)
    const lng = minLng + b * (maxLng - minLng)
    if (!pointInPolygon(lat, lng, d.coords)) continue

    const inPaidCore = lat > 59.428 && lat < 59.442 && lng > 24.735 && lng < 24.765
    // In paid core only keep sparse timed / 30-min spots (not free street spam)
    if (inPaidCore && i % 7 !== 0) continue

    const timed = inPaidCore || i % 11 === 0
    const street = STREET_NAMES[i % STREET_NAMES.length]
    const n = 1 + (i % 80)

    spots.push({
      id: `gen-street-${spots.length}`,
      name: timed
        ? `${street} tn ${n} (kellaga)`
        : `${street} tn ${n} tänavaäär`,
      type: timed ? 'timed' : 'free',
      kind: 'street',
      badge: timed
        ? inPaidCore
          ? i % 3 === 0
            ? '15 min'
            : '30 min'
          : i % 2 === 0
            ? '30 min'
            : '2h'
        : 'TÄNAV',
      timeLimit: timed
        ? inPaidCore
          ? 'Tasuline tsoon · esimesed 15–30 min kellaga'
          : i % 2 === 0
            ? '30 min parkimiskellaga'
            : '2 tundi kellaga'
        : 'Piiranguta (vaata märke)',
      lat,
      lng,
      address: `${street} tn ${n}, ${d.name}`,
      desc: timed
        ? inPaidCore
          ? 'Kesklinna tasuline tänav. Pane kell — lühike tasuta aeg, siis tariif.'
          : 'Tänavaäärne ajapiiranguga koht. Pane kell esiklaasile.'
        : 'Tänavaäärne tasuta parkimine väljaspool tasulist tsooni.',
      landmark: false,
    })
  }

  return spots
}
