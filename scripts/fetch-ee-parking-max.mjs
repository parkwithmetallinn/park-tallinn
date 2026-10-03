#!/usr/bin/env node
/**
 * Fetch maximum nationwide Estonian parking coverage.
 *
 * Primary: Geofabrik Estonia PBF → Python/pyosmium extract
 * Fallback: tiled Overpass API (slower; use when PBF unavailable)
 *
 * Writes: public/data/ee_parking_max.raw.geojson
 * Then run: node scripts/build-ee-parking-max.mjs
 *
 * Usage:
 *   node scripts/fetch-ee-parking-max.mjs
 *   EE_OSM_PBF=/path/to/estonia.osm.pbf node scripts/fetch-ee-parking-max.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PBF_DEFAULT = '/tmp/estonia.osm.pbf'
const PBF_URL = 'https://download.geofabrik.de/europe/estonia-latest.osm.pbf'

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.status !== 0) {
    throw new Error(`${cmd} failed with status ${res.status}`)
  }
}

async function ensurePbf(path) {
  if (existsSync(path) && (await import('node:fs')).statSync(path).size > 1_000_000) {
    console.log(`[fetch] using existing PBF ${path}`)
    return
  }
  console.log(`[fetch] downloading ${PBF_URL}`)
  run('curl', ['-L', '--max-time', '180', '-o', path, PBF_URL])
}

function extractWithPython(pbf) {
  run('python3', [join(ROOT, 'scripts/extract-ee-parking-from-pbf.py')], {
    env: { ...process.env, EE_OSM_PBF: pbf },
  })
}

async function main() {
  const pbf = process.env.EE_OSM_PBF || PBF_DEFAULT
  await ensurePbf(pbf)
  extractWithPython(pbf)
  console.log('[fetch] raw extract complete — run: npm run build:parking-max')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
