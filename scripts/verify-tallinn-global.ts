/**
 * Global Tallinn classification + coverage verification.
 * Run: npx tsx scripts/verify-tallinn-global.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { enrichNommeParking, pointInNomme } from '../src/lib/nommeEnrichment'
import { splitMasterCollection } from '../src/lib/estoniaParkingMaster'
import {
  isClockLimitedParking,
  isUnlimitedFreeParking,
  isUnclassifiedParking,
  PARKING_COLOR_FREE,
  PARKING_COLOR_PAID,
  PARKING_COLOR_TIMED,
  PARKING_COLOR_UNKNOWN,
} from '../src/lib/parkingClassification'
import { prepareParkingPolygons } from '../src/lib/preciseParkingPolygons'
import { prepareStreetParking } from '../src/lib/streetParkingLines'
import { lookupTallinnPaidZone } from '../src/lib/tallinnZoneEnrichment'

const ROOT = resolve(import.meta.dirname, '..')

function load(rel: string) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'))
}

const streetsJson = readFileSync(
  resolve(ROOT, 'public/data/tallinn_free_streets.geojson'),
  'utf8',
)
const lotsJson = readFileSync(
  resolve(ROOT, 'public/data/nomme_verified_lots.geojson'),
  'utf8',
)
const master = load('public/data/ee_parking_max.geojson')

const origFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('tallinn_free_streets') || url.includes('nomme_free_streets')) {
    return new Response(streetsJson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (url.includes('nomme_verified_lots')) {
    return new Response(lotsJson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return origFetch(input)
}) as typeof fetch

function centroid(f: {
  geometry: { type: string; coordinates: unknown }
}): { lng: number; lat: number } | null {
  const g = f.geometry
  if (g.type === 'LineString') {
    const c = (g.coordinates as number[][])[
      Math.floor((g.coordinates as number[][]).length / 2)
    ]
    return { lng: c[0], lat: c[1] }
  }
  const ring =
    g.type === 'Polygon'
      ? (g.coordinates as number[][][])[0]
      : (g.coordinates as number[][][][])[0][0]
  let sx = 0
  let sy = 0
  const n = Math.max(1, ring.length - 1)
  for (let i = 0; i < n; i++) {
    sx += ring[i][0]
    sy += ring[i][1]
  }
  return { lng: sx / n, lat: sy / n }
}

async function main() {
  const { lotRaw, streetRaw } = splitMasterCollection(master)
  const base = {
    polygons: prepareParkingPolygons(lotRaw as never),
    streets: prepareStreetParking(streetRaw as never),
    rawCount: master.features.length,
    lotCount: 0,
    streetRawCount: 0,
  }
  const split = await enrichNommeParking(base, true)

  // ——— Arena 350m: zero greens ———
  const arenaLat = 59.4212
  const arenaLng = 24.7325
  const dist = (lat: number, lng: number) =>
    Math.hypot(
      (lat - arenaLat) * 111320,
      (lng - arenaLng) * 111320 * Math.cos((arenaLat * Math.PI) / 180),
    )

  let arenaGreen = 0
  let arenaPLotsRed = 0
  for (const f of [...split.polygons.features, ...split.streets.features]) {
    const c = centroid(f)
    if (!c || dist(c.lat, c.lng) > 350) continue
    if (isUnlimitedFreeParking(f.properties) || f.properties.color === PARKING_COLOR_FREE) {
      arenaGreen++
      console.log('ARENA GREEN', f.id, f.properties.layer, f.properties.name)
    }
    if (
      /^P[1-6]$/i.test(String(f.properties.zone_code || '')) &&
      f.properties.color === PARKING_COLOR_PAID
    ) {
      arenaPLotsRed++
    }
  }

  // ——— Greens inside paid zones: zero ———
  let greensInPaid = 0
  for (const f of [...split.polygons.features, ...split.streets.features]) {
    if (!isUnlimitedFreeParking(f.properties) && f.properties.color !== PARKING_COLOR_FREE) {
      continue
    }
    const c = centroid(f)
    if (!c) continue
    if (lookupTallinnPaidZone(c.lat, c.lng)) {
      greensInPaid++
      if (greensInPaid <= 5) {
        console.log('PAID-ZONE GREEN', f.id, f.properties.name, c)
      }
    }
  }

  // ——— Nõmme: free streets + only verified lots ———
  const nommeStreets = split.streets.features.filter((f) => {
    const c = centroid(f)
    return c && pointInNomme(c.lng, c.lat)
  })
  const nommeFree = nommeStreets.filter(
    (f) => f.properties.verified_free && f.properties.rules === 'free',
  )
  const nommeLots = split.polygons.features.filter((f) => {
    const c = centroid(f)
    return c && pointInNomme(c.lng, c.lat)
  })
  const allowOsm = ['754351086', '1058578454', '181458718', '181458740', '1132219471']
  const unverifiedNommeLots = nommeLots.filter((f) => {
    const id = String(f.id)
    if (id.startsWith('lot-nomme')) return false
    if (String(f.properties.source ?? '').includes('nomme')) return false
    return !allowOsm.some((o) => id.includes(o))
  })

  // ——— free_outside_zones must not be green ———
  let freeOutsideGreen = 0
  // Check prepared base before enrich for lots still carrying the tag
  for (const f of base.polygons.features) {
    // After prepare, enriched_as may not be on props — check via color/layer
    // Re-check: features that were free_outside should not be unlimited free
  }
  // Count citywide greens that are NOT from road GIS / free_street verified
  const freeStreets = split.streets.features.filter(
    (f) => f.properties.verified_free && f.properties.layer === 'free_street',
  )
  const freeLots = split.polygons.features.filter(
    (f) => f.properties.verified_free && f.properties.layer === 'free_street',
  )

  // Color hist
  const hist: Record<string, number> = {
    green: 0,
    yellow: 0,
    red: 0,
    gray: 0,
  }
  for (const f of [...split.polygons.features, ...split.streets.features]) {
    const c = f.properties.color
    if (c === PARKING_COLOR_FREE) hist.green++
    else if (c === PARKING_COLOR_TIMED) hist.yellow++
    else if (c === PARKING_COLOR_PAID) hist.red++
    else if (c === PARKING_COLOR_UNKNOWN) hist.gray++
  }

  // Sample: free_outside_zones in raw master should prepare as non-green
  let outsidePreparedGreen = 0
  let outsidePreparedGray = 0
  for (const raw of lotRaw.features ?? []) {
    const p = raw.properties || {}
    if (p.enriched_as !== 'free_outside_zones') continue
    // find prepared by id
    const id = String(p['@id'] || raw.id || '')
    const prepared = base.polygons.features.find(
      (f) => String(f.id).includes(id.replace('way/', 'w/').replace('node/', 'n/')) || String(f.id) === id,
    )
    if (!prepared) continue
    if (isUnlimitedFreeParking(prepared.properties)) outsidePreparedGreen++
    else if (
      prepared.properties.color === PARKING_COLOR_UNKNOWN ||
      isUnclassifiedParking(prepared.properties)
    ) {
      outsidePreparedGray++
    }
  }

  console.log({
    arenaGreen,
    arenaPLotsRed,
    greensInPaid,
    nommeStreets: nommeStreets.length,
    nommeFree: nommeFree.length,
    nommeLots: nommeLots.length,
    unverifiedNommeLots: unverifiedNommeLots.length,
    freeStreets: freeStreets.length,
    freeLots: freeLots.length,
    hist,
    outsidePreparedGreen,
    outsidePreparedGray,
  })

  const checks = {
    arenaGreenZero: arenaGreen === 0,
    greensInPaidZero: greensInPaid === 0,
    nommeFreeOk: nommeFree.length >= 500,
    nommeLotsClean: unverifiedNommeLots.length === 0,
    freeStreetsOk: freeStreets.length >= 2000,
    outsideNotGreen: outsidePreparedGreen === 0,
    arenaPRedOk: arenaPLotsRed >= 4,
  }
  console.log('checks', checks)

  const ok = Object.values(checks).every(Boolean)

  console.log(ok ? 'GLOBAL PASS' : 'GLOBAL FAIL')
  if (!ok) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
