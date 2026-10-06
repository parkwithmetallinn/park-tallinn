/**
 * Full Nõmme enrichment integration check.
 * Run: npx tsx scripts/verify-nomme-enrichment.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { enrichNommeParking, pointInNomme } from '../src/lib/nommeEnrichment'
import { prepareParkingPolygons } from '../src/lib/preciseParkingPolygons'
import { prepareStreetParking } from '../src/lib/streetParkingLines'
import { splitMasterCollection } from '../src/lib/estoniaParkingMaster'

const ROOT = resolve(import.meta.dirname, '..')
const streetsJson = readFileSync(
  resolve(ROOT, 'public/data/nomme_free_streets.geojson'),
  'utf8',
)
const lotsJson = readFileSync(
  resolve(ROOT, 'public/data/nomme_verified_lots.geojson'),
  'utf8',
)
const master = JSON.parse(
  readFileSync(resolve(ROOT, 'public/data/ee_parking_max.geojson'), 'utf8'),
)

const origFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('nomme_free_streets')) {
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

  const nommeStreets = split.streets.features.filter((f) => {
    const c = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]
    return pointInNomme(c[0], c[1])
  })
  const nommeLots = split.polygons.features.filter((f) => {
    const ring =
      f.geometry.type === 'Polygon'
        ? f.geometry.coordinates[0]
        : f.geometry.coordinates[0][0]
    let sx = 0
    let sy = 0
    const n = Math.max(1, ring.length - 1)
    for (let i = 0; i < n; i++) {
      sx += ring[i][0]
      sy += ring[i][1]
    }
    return pointInNomme(sx / n, sy / n)
  })

  const free = nommeStreets.filter(
    (f) => f.properties.verified_free && f.properties.rules === 'free',
  )
  const badStreet = nommeStreets.filter(
    (f) => f.properties.rules === 'paid' || f.properties.rules === 'clock',
  )
  const allowOsm = new Set([
    '754351086',
    '1058578454',
    '181458718',
    '181458740',
    '1132219471',
  ])
  const unverifiedLots = nommeLots.filter((f) => {
    const id = String(f.id)
    if (id.startsWith('lot-nomme')) return false
    if (String(f.properties.source ?? '').includes('nomme')) return false
    for (const osm of allowOsm) {
      if (id.includes(osm)) return false
    }
    return true
  })

  console.log({
    nommeStreets: nommeStreets.length,
    freeTasuta: free.length,
    badStreet: badStreet.length,
    nommeLots: nommeLots.length,
    lotIds: nommeLots.map((f) => f.id),
    unverifiedLots: unverifiedLots.length,
  })

  const ok =
    free.length >= 500 &&
    badStreet.length === 0 &&
    nommeLots.length === 5 &&
    unverifiedLots.length === 0

  console.log(ok ? 'INTEGRATION PASS' : 'INTEGRATION FAIL')
  if (!ok) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
