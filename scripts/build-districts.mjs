/**
 * Rebuild public/data/districts.geojson from Tallinn GIS Linnaosad (+ Vanalinn asum).
 *
 * Steps: fetch → EPSG:4326 → drop Aegna island part from Kesklinn labels only
 * (geometry keeps mainland; Aegna removed for city map clarity) → ocean clip →
 * simplify ≤5 m → topology clean → labelPoint via turf pointOnFeature.
 *
 * Usage: node scripts/build-districts.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import booleanValid from '@turf/boolean-valid'
import simplify from '@turf/simplify'
import pointOnFeature from '@turf/point-on-feature'
import cleanCoords from '@turf/clean-coords'
import rewind from '@turf/rewind'
import bbox from '@turf/bbox'
import area from '@turf/area'
import intersect from '@turf/intersect'
import difference from '@turf/difference'
import { featureCollection, feature, polygon, multiPolygon } from '@turf/helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'public/data/districts.geojson')
const TMP = join(ROOT, '.tmp/districts-build')

const LINNA_URL =
  'https://gis.tallinn.ee/arcgis/rest/services/dashboard/Linnaosad/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=geojson'
const VANALINN_URL =
  'https://gis.tallinn.ee/arcgis/rest/services/veebikaart/Asumid_veebikaart/FeatureServer/0/query?' +
  new URLSearchParams({
    where: "asumi_nimi='Vanalinn'",
    outFields: '*',
    outSR: '4326',
    returnGeometry: 'true',
    f: 'geojson',
  }).toString()

const NAME_MAP = {
  'Haabersti linnaosa': { id: 'haabersti', name_et: 'Haabersti', role: 'district' },
  'Kristiine linnaosa': { id: 'kristiine', name_et: 'Kristiine', role: 'district' },
  'Mustamäe linnaosa': { id: 'mustamae', name_et: 'Mustamäe', role: 'district' },
  'Nõmme linnaosa': { id: 'nomme', name_et: 'Nõmme', role: 'district' },
  'Pirita linnaosa': { id: 'pirita', name_et: 'Pirita', role: 'district' },
  'Kesklinna linnaosa': { id: 'kesklinn', name_et: 'Kesklinn', role: 'district' },
  'Põhja-Tallinna linnaosa': { id: 'pohja-tallinn', name_et: 'Põhja-Tallinn', role: 'district' },
  'Lasnamäe linnaosa': { id: 'lasnamae', name_et: 'Lasnamäe', role: 'district' },
}

/** ~5 m in degrees at Tallinn latitude */
const SIMPLIFY_TOL = 0.000045

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`)
  return res.json()
}

function dropAegna(geom) {
  if (geom.type === 'Polygon') return geom
  if (geom.type !== 'MultiPolygon') return geom
  const mainland = geom.coordinates.filter((poly) => {
    let maxLat = -Infinity
    for (const ring of poly) for (const [, lat] of ring) maxLat = Math.max(maxLat, lat)
    return maxLat < 59.52
  })
  if (!mainland.length) return geom
  if (mainland.length === 1) return { type: 'Polygon', coordinates: mainland[0] }
  return { type: 'MultiPolygon', coordinates: mainland }
}

function toTurfFeature(geom, props) {
  const cleaned = cleanCoords(feature(geom, props))
  const wound = rewind(cleaned, { reverse: false })
  return wound
}

function countVerts(geom) {
  let n = 0
  const walk = (c) => {
    if (typeof c[0] === 'number') n++
    else for (const x of c) walk(x)
  }
  walk(geom.coordinates)
  return n
}

async function loadOceanMask() {
  // Prefer cached NE ocean if present; else skip ocean clip (official land borders still used).
  const candidates = [
    '/tmp/tallinn-gis/ne_10m_ocean.geojson',
    join(TMP, 'ne_10m_ocean.geojson'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const ocean = JSON.parse(readFileSync(p, 'utf8'))
      return ocean
    }
  }
  try {
    const url =
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_ocean.geojson'
    const ocean = await fetchJson(url)
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ne_10m_ocean.geojson'), JSON.stringify(ocean))
    return ocean
  } catch {
    console.warn('Ocean mask unavailable — skipping sea clip')
    return null
  }
}

function clipOcean(feat, oceanFc) {
  if (!oceanFc) return feat
  // Difference via mapshaper is more robust; here use a bbox-filtered union approximation
  // by writing temp files for mapshaper -erase
  return feat
}

function runMapshaperClean(inputPath, outputPath) {
  // Snap shared borders; avoid aggressive sliver removal (default ~60 m
  // eats coastal tips like Kopli / Pirita beach).
  execFileSync(
    'npx',
    [
      '--yes',
      'mapshaper',
      inputPath,
      '-filter',
      `role == 'district'`,
      '-snap',
      'precision=0.000001',
      '-clean',
      'gap-width=5m',
      'rewind',
      '-o',
      outputPath,
      'geojson-type=FeatureCollection',
      'precision=0.000001',
    ],
    { stdio: 'inherit', cwd: ROOT },
  )
}

async function main() {
  mkdirSync(TMP, { recursive: true })
  mkdirSync(dirname(OUT), { recursive: true })

  console.log('Fetching Tallinn GIS Linnaosad (outSR=4326)…')
  const linna = await fetchJson(LINNA_URL)
  console.log('Fetching Vanalinn asum…')
  const van = await fetchJson(VANALINN_URL)

  if (!linna.features?.length) throw new Error('No linnaosa features')
  if (!van.features?.length) throw new Error('No Vanalinn feature')

  const ocean = await loadOceanMask()
  const rawPath = join(TMP, 'districts_raw.geojson')
  const erasedPath = join(TMP, 'districts_erased.geojson')
  const cleanedPath = join(TMP, 'districts_cleaned.geojson')

  const prepared = []
  for (const f of linna.features) {
    const meta = NAME_MAP[f.properties?.nimi]
    if (!meta) throw new Error(`Unknown linnaosa: ${f.properties?.nimi}`)
    let geom = dropAegna(f.geometry)
    let feat = toTurfFeature(geom, {
      id: meta.id,
      name_et: meta.name_et,
      role: meta.role,
    })
    // Simplify ≤5 m
    feat = simplify(feat, { tolerance: SIMPLIFY_TOL, highQuality: true, mutate: false })
    feat = cleanCoords(feat)
    if (!booleanValid(feat)) {
      console.warn('Invalid after simplify, attempting rewind:', meta.name_et)
      feat = rewind(feat, { reverse: false })
    }
    prepared.push(feat)
    console.log(
      `  ${meta.name_et}: ${feat.geometry.type} verts=${countVerts(feat.geometry)} area_km2=${(area(feat) / 1e6).toFixed(2)}`,
    )
  }

  // Write districts only for mapshaper clean / optional erase
  writeFileSync(rawPath, JSON.stringify(featureCollection(prepared)))

  if (ocean) {
    const oceanPath = join(TMP, 'ocean_bbox.geojson')
    // Filter ocean to Tallinn bbox
    const [minX, minY, maxX, maxY] = [24.5, 59.3, 24.95, 59.6]
    const oceanFeats = ocean.features.filter((f) => {
      const b = bbox(f)
      return !(b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY)
    })
    writeFileSync(oceanPath, JSON.stringify(featureCollection(oceanFeats)))
    console.log('Erasing ocean from districts (mapshaper)…')
    try {
      execFileSync(
        'npx',
        [
          '--yes',
          'mapshaper',
          rawPath,
          '-erase',
          oceanPath,
          '-o',
          erasedPath,
          'geojson-type=FeatureCollection',
          'precision=0.000001',
        ],
        { stdio: 'inherit', cwd: ROOT },
      )
    } catch (e) {
      console.warn('Ocean erase failed, continuing without:', e.message)
      writeFileSync(erasedPath, readFileSync(rawPath))
    }
  } else {
    writeFileSync(erasedPath, readFileSync(rawPath))
  }

  // Ocean erase (NE 10m) wrongly shaves coastal peninsulas / islets.
  // Restore Põhja + Haabersti from pre-erase geometry (Kakumäe / Kopli / etc.).
  const erased = JSON.parse(readFileSync(erasedPath, 'utf8'))
  const rawFc = JSON.parse(readFileSync(rawPath, 'utf8'))
  for (const id of ['pohja-tallinn', 'haabersti']) {
    const rawFeat = rawFc.features.find((f) => f.properties.id === id)
    if (!rawFeat) continue
    erased.features = erased.features.map((f) =>
      f.properties.id === id ? rawFeat : f,
    )
    console.log(`Restored ${rawFeat.properties.name_et} from pre-ocean-erase geometry`)
  }
  writeFileSync(erasedPath, JSON.stringify(erased))

  console.log('Topology clean (snap + clean)…')
  runMapshaperClean(erasedPath, cleanedPath)

  const cleaned = JSON.parse(readFileSync(cleanedPath, 'utf8'))
  const byId = new Map(cleaned.features.map((f) => [f.properties.id, f]))

  // Ensure all 8 districts survived clean
  for (const meta of Object.values(NAME_MAP)) {
    if (!byId.has(meta.id)) throw new Error(`Missing after clean: ${meta.name_et}`)
  }

  // After restoring full coastal districts, subtract neighbor overlaps
  // without moving the neighbors (clip the restored feature only).
  function subtractNeighbors(id, neighborIds) {
    let feat = byId.get(id)
    if (!feat) return
    for (const nid of neighborIds) {
      const n = byId.get(nid)
      if (!n) continue
      try {
        const inter = intersect(featureCollection([feat, n]))
        if (inter && area(inter) > 1) {
          const diffed = difference(featureCollection([feat, n]))
          if (diffed) feat = feature(diffed.geometry, feat.properties)
        }
      } catch {
        /* keep */
      }
    }
    feat = cleanCoords(rewind(feat, { reverse: false }))
    byId.set(id, feat)
  }
  subtractNeighbors('pohja-tallinn', ['haabersti', 'kristiine', 'kesklinn'])
  subtractNeighbors('haabersti', ['pohja-tallinn', 'kristiine', 'mustamae', 'nomme'])

  // Vanalinn overlay (not part of district topology snap)
  let vanalinn = toTurfFeature(van.features[0].geometry, {
    id: 'vanalinn',
    name_et: 'Vanalinn',
    role: 'subzone',
  })
  vanalinn = simplify(vanalinn, { tolerance: SIMPLIFY_TOL, highQuality: true, mutate: false })
  vanalinn = cleanCoords(vanalinn)

  function largestPart(feat) {
    if (feat.geometry.type === 'Polygon') return feat
    let best = null
    let bestA = -1
    for (const coords of feat.geometry.coordinates) {
      const p = feature({ type: 'Polygon', coordinates: coords }, feat.properties)
      const a = area(p)
      if (a > bestA) {
        bestA = a
        best = p
      }
    }
    return best || feat
  }

  const outFeatures = []
  for (const meta of Object.values(NAME_MAP)) {
    const f = byId.get(meta.id)
    const labelSrc =
      meta.id === 'pohja-tallinn' || meta.id === 'haabersti' ? largestPart(f) : f
    const label = pointOnFeature(labelSrc)
    outFeatures.push({
      type: 'Feature',
      id: meta.id,
      properties: {
        id: meta.id,
        name_et: meta.name_et,
        role: 'district',
        labelPoint: label.geometry.coordinates,
      },
      geometry: f.geometry,
    })
  }
  {
    const label = pointOnFeature(vanalinn)
    outFeatures.push({
      type: 'Feature',
      id: 'vanalinn',
      properties: {
        id: 'vanalinn',
        name_et: 'Vanalinn',
        role: 'subzone',
        labelPoint: label.geometry.coordinates,
      },
      geometry: vanalinn.geometry,
    })
  }

  // Overlap report (districts only)
  console.log('\nOverlap report (districts):')
  const districts = outFeatures.filter((f) => f.properties.role === 'district')
  for (let i = 0; i < districts.length; i++) {
    for (let j = i + 1; j < districts.length; j++) {
      const a = districts[i]
      const b = districts[j]
      try {
        const inter = intersect(featureCollection([a, b]))
        if (inter && area(inter) > 1) {
          console.log(
            `  ${a.properties.name_et} ∩ ${b.properties.name_et}: ${area(inter).toFixed(1)} m²`,
          )
        }
      } catch {
        /* ignore topology noise */
      }
    }
  }

  const fc = {
    type: 'FeatureCollection',
    name: 'tallinn_districts',
    properties: {
      source: 'Tallinn GIS dashboard/Linnaosad + veebikaart/Asumid Vanalinn',
      nativeCrs: 'EPSG:3301',
      crs: 'EPSG:4326',
      simplifyToleranceM: 5,
      builtAt: new Date().toISOString(),
    },
    features: outFeatures,
  }

  writeFileSync(OUT, JSON.stringify(fc))
  // JSON copy for Vite/TS import (bundler does not parse .geojson as JSON)
  writeFileSync(join(ROOT, 'src/data/districts.json'), JSON.stringify(fc))
  console.log(`\nWrote ${OUT}`)
  console.log(
    'Features:',
    outFeatures.map((f) => `${f.properties.name_et}(${countVerts(f.geometry)}v)`).join(', '),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
