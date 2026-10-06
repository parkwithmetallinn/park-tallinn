/**
 * Audit Tallinn parking classification — Arena greens + paid-zone leaks.
 * Run: npx tsx scripts/audit-tallinn-classification.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { splitMasterCollection } from '../src/lib/estoniaParkingMaster'
import {
  isUnlimitedFreeParking,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
  PARKING_COLOR_UNKNOWN,
} from '../src/lib/parkingClassification'
import { prepareParkingPolygons } from '../src/lib/preciseParkingPolygons'
import { prepareStreetParking } from '../src/lib/streetParkingLines'
import { lookupTallinnPaidZone } from '../src/lib/tallinnZoneEnrichment'

const ROOT = resolve(import.meta.dirname, '..')
const master = JSON.parse(
  readFileSync(resolve(ROOT, 'public/data/ee_parking_max.geojson'), 'utf8'),
)

const { lotRaw, streetRaw } = splitMasterCollection(master)
const lots = prepareParkingPolygons(lotRaw as never)
const streets = prepareStreetParking(streetRaw as never)

function centroid(f: {
  geometry: { type: string; coordinates: unknown }
}): { lng: number; lat: number } | null {
  const g = f.geometry
  try {
    if (g.type === 'LineString') {
      const coords = g.coordinates as number[][]
      const c = coords[Math.floor(coords.length / 2)]
      return { lng: c[0], lat: c[1] }
    }
    if (g.type === 'Polygon') {
      const ring = (g.coordinates as number[][][])[0]
      let sx = 0
      let sy = 0
      const n = Math.max(1, ring.length - 1)
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return { lng: sx / n, lat: sy / n }
    }
    if (g.type === 'MultiPolygon') {
      const ring = (g.coordinates as number[][][][])[0][0]
      let sx = 0
      let sy = 0
      const n = Math.max(1, ring.length - 1)
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return { lng: sx / n, lat: sy / n }
    }
  } catch {
    return null
  }
  return null
}

const arenaLat = 59.4212
const arenaLng = 24.7325
function distM(lat: number, lng: number) {
  return Math.hypot(
    (lat - arenaLat) * 111320,
    (lng - arenaLng) * 111320 * Math.cos((arenaLat * Math.PI) / 180),
  )
}

function isGreen(p: {
  color?: string
  verified_free?: boolean
  layer?: string
  free_minutes?: number
  price_per_hour?: number
  type?: string
  timeLimit?: string
  badge?: string
  name?: string
  desc?: string
  zone_code?: string
}) {
  return (
    p.color === PARKING_COLOR_FREE ||
    isUnlimitedFreeParking(p) ||
    Boolean(p.verified_free && p.layer === 'free_street')
  )
}

const nearLots = lots.features.filter((f) => {
  const c = centroid(f)
  return c && distM(c.lat, c.lng) <= 350
})
const nearStreets = streets.features.filter((f) => {
  const c = centroid(f)
  return c && distM(c.lat, c.lng) <= 350
})

const greenLots = nearLots.filter((f) => isGreen(f.properties))
const greenStreets = nearStreets.filter((f) => isGreen(f.properties))

console.log('=== Arena / Jalgpalli 350m ===')
console.log('lots', nearLots.length, 'green', greenLots.length)
console.log('streets', nearStreets.length, 'green', greenStreets.length)
for (const f of [...greenLots, ...greenStreets]) {
  const c = centroid(f)!
  console.log(
    ' GREEN',
    f.id,
    f.properties.layer,
    f.properties.color,
    f.properties.zone_code,
    f.properties.name,
    `d=${distM(c.lat, c.lng).toFixed(0)}`,
  )
}

const pLots = nearLots.filter((f) =>
  /^P[1-6]$/i.test(String(f.properties.zone_code || '')),
)
console.log('P1-P6 near arena', pLots.length)
for (const f of pLots) {
  console.log(
    ' ',
    f.id,
    f.properties.layer,
    f.properties.color,
    f.properties.zone_code,
    `€${f.properties.price_per_hour}`,
    `${f.properties.free_minutes}m`,
  )
}

let greensInPaid = 0
const samples: Array<Record<string, unknown>> = []
for (const f of [...lots.features, ...streets.features]) {
  if (!isGreen(f.properties)) continue
  const c = centroid(f)
  if (!c) continue
  const zone = lookupTallinnPaidZone(c.lat, c.lng)
  if (!zone) continue
  greensInPaid++
  if (samples.length < 20) {
    samples.push({
      id: f.id,
      name: f.properties.name,
      zone: zone.zone_code,
      layer: f.properties.layer,
      color: f.properties.color,
      mins: f.properties.free_minutes,
      price: f.properties.price_per_hour,
      lat: c.lat,
      lng: c.lng,
    })
  }
}
console.log('\n=== Greens inside municipal paid zones ===', greensInPaid)
console.log(samples)

const hist: Record<string, number> = {
  [PARKING_COLOR_FREE]: 0,
  [PARKING_COLOR_TIMED]: 0,
  [PARKING_COLOR_PAID]: 0,
  [PARKING_COLOR_UNKNOWN]: 0,
  other: 0,
}
for (const f of [...lots.features, ...streets.features]) {
  const c = f.properties.color || '?'
  if (c in hist) hist[c]++
  else hist.other++
}
console.log('\n=== Color hist ===', hist)

// Kesklinn streets that are green (should be 0)
let keskGreen = 0
for (const f of streets.features) {
  if (!isGreen(f.properties)) continue
  const c = centroid(f)
  if (!c) continue
  const z = lookupTallinnPaidZone(c.lat, c.lng)
  if (z && /kesklinn|südalinn|vanalinn|süda/i.test(z.name + z.zone_code)) {
    keskGreen++
  }
}
console.log('Kesklinn-area green streets', keskGreen)

const arenaOk = greenLots.length === 0 && greenStreets.length === 0
const paidOk = greensInPaid === 0
console.log('\n' + (arenaOk && paidOk ? 'AUDIT PASS' : 'AUDIT FAIL'))
if (!arenaOk || !paidOk) process.exitCode = 1
