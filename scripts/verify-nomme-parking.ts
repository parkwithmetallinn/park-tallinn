/**
 * Verify Nõmme enrichment: free street coverage + only verified lots.
 * Run: npx tsx scripts/verify-nomme-parking.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  pointInNomme,
} from '../src/lib/nommeEnrichment'
import { prepareParkingPolygons } from '../src/lib/preciseParkingPolygons'
import { prepareStreetParking } from '../src/lib/streetParkingLines'
import { isUnlimitedFreeParking } from '../src/lib/parkingClassification'
import { splitMasterCollection } from '../src/lib/estoniaParkingMaster'

const ROOT = resolve(import.meta.dirname, '..')

function loadJson(rel: string) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'))
}

// Stub fetch for enrichment overlay URLs used inside enrichNommeParking via
// prepare path — we verify overlays + master filter logic directly here.
const streetsRaw = loadJson('public/data/nomme_free_streets.geojson')
const lotsRaw = loadJson('public/data/nomme_verified_lots.geojson')
const master = loadJson('public/data/ee_parking_max.geojson')

const streets = prepareStreetParking(streetsRaw)
const lots = prepareParkingPolygons(lotsRaw)

const freeStreets = streets.features.filter(
  (f) => f.properties.verified_free && f.properties.rules === 'free',
)
const paidOrClockStreets = streets.features.filter(
  (f) => f.properties.rules === 'paid' || f.properties.rules === 'clock',
)

console.log('=== Nõmme free streets (road GIS) ===')
console.log('total', streets.features.length)
console.log('verified_free Tasuta', freeStreets.length)
console.log('paid/clock (should be 0)', paidOrClockStreets.length)

console.log('\n=== Nõmme verified lots ===')
console.log('total', lots.features.length)
for (const f of lots.features) {
  const p = f.properties
  const unlimited = isUnlimitedFreeParking({
    layer: p.layer,
    verified_free: p.verified_free,
    free_minutes: p.free_minutes,
    price_per_hour: p.price_per_hour,
  })
  console.log(
    `  ${f.id} layer=${p.layer} verified_free=${p.verified_free} unlimited=${unlimited} color=${p.color}`,
  )
}

// Master: count raw lots inside Nõmme vs what enrichment keeps
const { lotRaw, streetRaw } = splitMasterCollection(master)
let masterLotsInNomme = 0
for (const f of lotRaw.features ?? []) {
  const g = f.geometry
  if (!g) continue
  // rough centroid
  let lng = 0
  let lat = 0
  let n = 0
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      lng += c[0] as number
      lat += c[1] as number
      n++
      return
    }
    for (const x of c) walk(x)
  }
  walk(g.coordinates)
  if (n === 0) continue
  lng /= n
  lat /= n
  if (pointInNomme(lng, lat)) masterLotsInNomme++
}

let masterStreetsInNomme = 0
for (const f of streetRaw.features ?? []) {
  const g = f.geometry
  if (!g || g.type !== 'LineString') continue
  const coords = g.coordinates as number[][]
  const mid = coords[Math.floor(coords.length / 2)]
  if (pointInNomme(mid[0], mid[1])) masterStreetsInNomme++
}

console.log('\n=== Master before enrichment (Nõmme PIP) ===')
console.log('raw lots in Nõmme (will be dropped unless allowlisted)', masterLotsInNomme)
console.log('raw streets in Nõmme (replaced by road GIS)', masterStreetsInNomme)
console.log('injected streets', streets.features.length)
console.log('injected verified lots', lots.features.length)

const ok =
  freeStreets.length >= 500 &&
  paidOrClockStreets.length === 0 &&
  lots.features.length === 5 &&
  lots.features.every(
    (f) =>
      f.properties.layer === 'park_ride' ||
      (f.properties.verified_free && f.properties.layer === 'free_street'),
  )

console.log('\n' + (ok ? 'PASS' : 'FAIL'))
if (!ok) process.exit(1)
