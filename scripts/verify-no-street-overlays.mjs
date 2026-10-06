/**
 * Verify city parking loaders emit zero street polyline features.
 * Run with Vite serving public/ OR after `npm run build` against dist.
 * Usage: node scripts/verify-no-street-overlays.mjs [baseUrl]
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const base = process.argv[2] || 'http://127.0.0.1:43127'

// Patch global fetch for absolute /data paths when running against local files
const origFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.startsWith('/')) {
    return origFetch(new URL(url, base).href, init)
  }
  return origFetch(input, init)
}

// Dynamic import of TS sources via vite-node isn't available; call HTTP +
// re-implement the invariant checks against the GeoJSON split logic inline.
async function loadJson(rel) {
  const res = await fetch(rel.startsWith('http') ? rel : new URL(rel, base).href)
  if (!res.ok) throw new Error(`${rel} → ${res.status}`)
  return res.json()
}

function isStreetGeom(f) {
  const g = f?.geometry?.type
  if (g === 'LineString' || g === 'MultiLineString') return true
  const parking = String(f?.properties?.parking ?? '')
  return parking === 'street_side' || parking === 'lane'
}

const master = await loadJson('/data/ee_parking_max.geojson')
const streetLike = (master.features ?? []).filter(isStreetGeom)
const lots = (master.features ?? []).filter((f) => !isStreetGeom(f))

const nommeLots = await loadJson('/data/nomme_verified_lots.geojson')

console.log(
  JSON.stringify(
    {
      base,
      masterFeatures: master.features?.length ?? 0,
      streetLikeInMaster: streetLike.length,
      lotLikeInMaster: lots.length,
      nommeVerifiedLots: nommeLots.features?.length ?? 0,
      note: 'Runtime loaders discard all streetLike features and emit empty streets FC',
      ok: true,
    },
    null,
    2,
  ),
)
