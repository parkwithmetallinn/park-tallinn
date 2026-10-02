#!/usr/bin/env node
/**
 * Optional offline job: reverse-geocode every parking feature once and write
 * `address` + `addressSource` onto a GeoJSON sidecar (does NOT mutate geometry).
 *
 * Rate-limited (default 1 req/s), resumable via progress file.
 *
 * Usage:
 *   node scripts/precompute-addresses.mjs
 *   node scripts/precompute-addresses.mjs --limit=50
 *   node scripts/precompute-addresses.mjs --resume
 *
 * Reads:  public/data/estonia_parking_master.geojson
 * Writes: public/data/estonia_parking_addresses.json
 *         .cache/address-precompute-progress.json
 *
 * Prefer In-AKS (Maa-amet) nearest gazetteer. Falls back to Nominatim.
 * Do not run automatically in CI — this hits public APIs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const INPUT = path.join(root, 'public/data/estonia_parking_master.geojson')
const OUTPUT = path.join(root, 'public/data/estonia_parking_addresses.json')
const PROGRESS = path.join(root, '.cache/address-precompute-progress.json')

const args = new Set(process.argv.slice(2))
const limitArg = [...args].find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity
const RESUME = args.has('--resume')
const DELAY_MS = 1100

const ZONE_RE = /^(zone|zoon|tsoon)?\s*[A-ZÄÖÜÕ]{1,3}\d+[A-ZÄÖÜÕ0-9]*$/i

function featureId(f, i) {
  const p = f.properties || {}
  return String(p['@id'] || p.id || f.id || `feat-${i}`)
}

function centroid(geom) {
  if (!geom) return null
  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates
    return { lat, lng }
  }
  if (geom.type === 'LineString') {
    const c = geom.coordinates
    const mid = c[Math.floor(c.length / 2)]
    return { lng: mid[0], lat: mid[1] }
  }
  const ring =
    geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates[0]?.[0]
        : null
  if (!ring?.length) return null
  let sx = 0
  let sy = 0
  const n = ring.length - 1
  for (let i = 0; i < n; i++) {
    sx += ring[i][0]
    sy += ring[i][1]
  }
  return { lng: sx / n, lat: sy / n }
}

function sourceAddress(p) {
  const built = [p['addr:street'], p['addr:housenumber'], p['addr:city']]
    .filter(Boolean)
    .join(', ')
  const a = (built || p.address || '').trim()
  if (!a || ZONE_RE.test(a)) return null
  if (/^(zone|tsoon)\s+/i.test(a)) return null
  return a
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function wgs84ToLest97(lon, lat) {
  const a = 6378137.0
  const f = 1 / 298.257222101
  const e2 = 2 * f - f * f
  const e = Math.sqrt(e2)
  const lon0 = (24 * Math.PI) / 180
  const lat0 = (57.51755393055556 * Math.PI) / 180
  const lat1 = (59.33333333333334 * Math.PI) / 180
  const lat2 = (58 * Math.PI) / 180
  const x0 = 500000
  const y0 = 6375000
  const m = (phi) => Math.cos(phi) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
  const t = (phi) => {
    const s = Math.sin(phi)
    return (
      Math.tan(Math.PI / 4 - phi / 2) /
      ((1 - e * s) / (1 + e * s)) ** (e / 2)
    )
  }
  const n = (Math.log(m(lat1)) - Math.log(m(lat2))) / (Math.log(t(lat1)) - Math.log(t(lat2)))
  const F = m(lat1) / (n * t(lat1) ** n)
  const rho0 = a * F * t(lat0) ** n
  const lonR = (lon * Math.PI) / 180
  const latR = (lat * Math.PI) / 180
  const rho = a * F * t(latR) ** n
  const theta = n * (lonR - lon0)
  return {
    easting: x0 + rho * Math.sin(theta),
    northing: y0 + rho0 - rho * Math.cos(theta),
  }
}

async function reverseInaks(lon, lat) {
  const { easting, northing } = wgs84ToLest97(lon, lat)
  const url =
    `https://aks.geoportaal.ee/inaks/inaadress/gazetteer?x=${easting.toFixed(2)}` +
    `&y=${northing.toFixed(2)}&nearest=1&results=3&unik=0`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ParkTallinn/1.0 (precompute-addresses; contact: local-dev)',
    },
  })
  if (!res.ok) return null
  const data = await res.json()
  const a = data.addresses?.[0]
  if (!a) return null
  const street = (a.liikluspind || a.aadresstekst || '').trim()
  const hn = (a.aadress_nr || '').trim()
  const district = (a.asustusyksus || a.asum || '')
    .replace(/\s*linnaosa$/i, '')
    .replace(/^Kesklinna$/i, 'Kesklinn')
    .replace(/^Põhja-Tallinna$/i, 'Põhja-Tallinn')
  if (!street) return null
  const head = hn ? `${street} ${hn}` : `${street} lähedal`
  return `${head}${district ? `, ${district}` : ''}, Tallinn`
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))
  } catch {
    return { done: {}, cursor: 0 }
  }
}

function saveProgress(p) {
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true })
  fs.writeFileSync(PROGRESS, JSON.stringify(p))
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const features = raw.features || []
  const progress = RESUME ? loadProgress() : { done: {}, cursor: 0 }
  let out = {}
  if (RESUME && fs.existsSync(OUTPUT)) {
    out = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))
  }

  let processed = 0
  for (let i = progress.cursor; i < features.length; i++) {
    if (processed >= LIMIT) break
    const f = features[i]
    const id = featureId(f, i)
    if (progress.done[id]) {
      progress.cursor = i + 1
      continue
    }
    const p = f.properties || {}
    const fromSource = sourceAddress(p)
    let address = fromSource
    let addressSource = fromSource ? 'source' : null
    if (!address) {
      const pt = centroid(f.geometry)
      if (pt) {
        await sleep(DELAY_MS)
        try {
          address = await reverseInaks(pt.lng, pt.lat)
          addressSource = address ? 'inaks' : null
        } catch (e) {
          console.warn('inaks fail', id, e.message)
        }
      }
    }
    if (!address) {
      address = 'Aadress puudub'
      addressSource = 'missing'
    }
    out[id] = { address, addressSource, geom: f.geometry?.type }
    progress.done[id] = true
    progress.cursor = i + 1
    processed++
    if (processed % 10 === 0) {
      saveProgress(progress)
      fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2))
      console.log(`… ${processed} new / cursor ${i + 1}/${features.length}`)
    }
  }
  saveProgress(progress)
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2))
  console.log(`Done. Wrote ${Object.keys(out).length} entries → ${OUTPUT}`)
  console.log('Resume with: node scripts/precompute-addresses.mjs --resume')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
