/**
 * Rebuild ONLY the Haabersti district polygon from Tallinn GIS Linnaosad.
 * Neighbors (Põhja-Tallinn, Kristiine, Mustamäe, Nõmme) stay untouched —
 * any overlap is subtracted from Haabersti.
 *
 * Usage: node scripts/fix-haabersti.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import booleanValid from '@turf/boolean-valid'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import simplify from '@turf/simplify'
import pointOnFeature from '@turf/point-on-feature'
import cleanCoords from '@turf/clean-coords'
import rewind from '@turf/rewind'
import bbox from '@turf/bbox'
import area from '@turf/area'
import intersect from '@turf/intersect'
import difference from '@turf/difference'
import { featureCollection, feature, point } from '@turf/helpers'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_GEO = join(ROOT, 'public/data/districts.geojson')
const OUT_JSON = join(ROOT, 'src/data/districts.json')

const LINNA_URL =
  'https://gis.tallinn.ee/arcgis/rest/services/dashboard/Linnaosad/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=geojson'

/** ~2 m in degrees at Tallinn latitude (max allowed ~5 m). */
const SIMPLIFY_TOL = 0.000018

const NEIGHBOR_IDS = ['pohja-tallinn', 'kristiine', 'mustamae', 'nomme']

const HINTS = [
  { name: 'Õismäe', lng: 24.655, lat: 59.416 },
  { name: 'Veskimetsa', lng: 24.66, lat: 59.425 },
  { name: 'Rocca al Mare', lng: 24.645, lat: 59.435 },
  { name: 'Kakumäe', lng: 24.58, lat: 59.445 },
  { name: 'Harku lake', lng: 24.62, lat: 59.405 },
]

function hashGeom(geom) {
  return createHash('sha256').update(JSON.stringify(geom)).digest('hex').slice(0, 16)
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

function reportGaps(officialHa, currentHa, label) {
  console.log(`\n[${label}]`)
  try {
    const gap = difference(featureCollection([officialHa, currentHa]))
    if (!gap) {
      console.log('  missing vs official: 0 m²')
      return 0
    }
    const total = area(gap)
    console.log(`  missing vs official: ${total.toFixed(0)} m² (${gap.geometry.type})`)
    const parts =
      gap.geometry.type === 'Polygon'
        ? [gap.geometry.coordinates]
        : gap.geometry.coordinates
    const big = []
    for (const coords of parts) {
      const f = feature({ type: 'Polygon', coordinates: coords })
      const a = area(f)
      if (a < 100) continue
      const b = bbox(f)
      big.push({
        a,
        c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
      })
    }
    big.sort((x, y) => y.a - x.a)
    for (const g of big.slice(0, 8)) {
      console.log(
        `    gap ${g.a.toFixed(0)} m² centroid [${g.c[0].toFixed(5)}, ${g.c[1].toFixed(5)}]`,
      )
    }
    return total
  } catch (e) {
    console.warn('  gap report failed:', e.message)
    return -1
  }
}

async function main() {
  const fc = JSON.parse(readFileSync(OUT_GEO, 'utf8'))
  const beforeHashes = new Map()
  for (const f of fc.features) {
    if (f.properties.id === 'haabersti') continue
    beforeHashes.set(f.properties.id, hashGeom(f.geometry))
  }

  const curHa = fc.features.find((f) => f.properties.id === 'haabersti')
  if (!curHa) throw new Error('Haabersti missing from districts.geojson')

  console.log('Current Haabersti:', curHa.geometry.type, `${countVerts(curHa.geometry)}v`, `${(area(curHa) / 1e6).toFixed(3)} km²`)

  console.log('Fetching Tallinn GIS Linnaosad…')
  const linna = await (await fetch(LINNA_URL)).json()
  const raw = linna.features.find((f) => f.properties?.nimi === 'Haabersti linnaosa')
  if (!raw) throw new Error('Haabersti linnaosa not in GIS response')

  let ha = feature(raw.geometry, {
    id: 'haabersti',
    name_et: 'Haabersti',
    role: 'district',
  })
  console.log(
    'Official Haabersti:',
    ha.geometry.type,
    `${countVerts(ha.geometry)}v`,
    `${(area(ha) / 1e6).toFixed(3)} km²`,
  )

  const gapBefore = reportGaps(ha, curHa, 'gap BEFORE')

  // Simplify ≤5 m, then clean / rewind
  ha = simplify(ha, { tolerance: SIMPLIFY_TOL, highQuality: true, mutate: false })
  ha = cleanCoords(ha)
  ha = rewind(ha, { reverse: false })
  if (!booleanValid(ha)) {
    throw new Error('Haabersti invalid after simplify')
  }

  // Subtract neighbor overlaps — neighbors stay fixed
  for (const nid of NEIGHBOR_IDS) {
    const n = fc.features.find((f) => f.properties.id === nid)
    if (!n) continue
    try {
      const inter = intersect(featureCollection([ha, n]))
      const m2 = inter ? area(inter) : 0
      if (m2 > 1) {
        const diffed = difference(featureCollection([ha, n]))
        if (!diffed) throw new Error(`difference emptied Haabersti vs ${nid}`)
        ha = feature(diffed.geometry, ha.properties)
        console.log(`  subtracted ${m2.toFixed(1)} m² overlap with ${n.properties.name_et}`)
      } else {
        console.log(`  no significant overlap with ${n.properties.name_et}`)
      }
    } catch (e) {
      console.warn(`  neighbor clip ${nid}:`, e.message)
    }
  }

  ha = cleanCoords(rewind(ha, { reverse: false }))
  if (!booleanValid(ha)) throw new Error('Haabersti invalid after neighbor clip')

  const label = pointOnFeature(largestPart(ha))
  const outHa = {
    type: 'Feature',
    id: 'haabersti',
    properties: {
      id: 'haabersti',
      name_et: 'Haabersti',
      role: 'district',
      labelPoint: label.geometry.coordinates,
    },
    geometry: ha.geometry,
  }

  console.log(
    '\nFixed Haabersti:',
    outHa.geometry.type,
    `${countVerts(outHa.geometry)}v`,
    `${(area(outHa) / 1e6).toFixed(3)} km²`,
    'bbox',
    bbox(outHa).map((x) => +x.toFixed(5)),
    'label',
    outHa.properties.labelPoint.map((x) => +x.toFixed(5)),
  )

  const gapAfter = reportGaps(
    feature(raw.geometry, { id: 'haabersti' }),
    outHa,
    'gap AFTER (vs official, after neighbor subtract)',
  )

  // Hint points
  console.log('\n[hint points]')
  for (const h of HINTS) {
    const inside = booleanPointInPolygon(point([h.lng, h.lat]), outHa)
    console.log(`  ${h.name} [${h.lng}, ${h.lat}] -> ${inside ? 'Haabersti' : 'MISS'}`)
    if (!inside) throw new Error(`Hint ${h.name} not inside fixed Haabersti`)
  }

  // Neighbor gap / overlap checks
  console.log('\n[neighbor topology]')
  for (const nid of NEIGHBOR_IDS) {
    const n = fc.features.find((f) => f.properties.id === nid)
    const inter = intersect(featureCollection([outHa, n]))
    const m2 = inter ? area(inter) : 0
    if (m2 > 50) throw new Error(`Overlap with ${n.properties.name_et}: ${m2.toFixed(1)} m²`)
    console.log(`  ∩ ${n.properties.name_et}: ${m2.toFixed(1)} m²`)
  }

  // Replace only Haabersti
  const outFeatures = fc.features.map((f) =>
    f.properties.id === 'haabersti' ? outHa : f,
  )

  // Assert other districts unchanged
  for (const f of outFeatures) {
    if (f.properties.id === 'haabersti') continue
    const h = hashGeom(f.geometry)
    if (h !== beforeHashes.get(f.properties.id)) {
      throw new Error(`District ${f.properties.id} geometry changed (hash mismatch)`)
    }
  }
  console.log('\n✓ all other districts unchanged (geometry hashes match)')

  const out = {
    ...fc,
    properties: {
      ...fc.properties,
      haaberstiFixedAt: new Date().toISOString(),
      haaberstiNote:
        'Rebuilt from Tallinn GIS without ocean erase; neighbors unchanged; overlaps subtracted from Haabersti',
      haaberstiGapBeforeM2: Math.round(gapBefore),
      haaberstiGapAfterM2: Math.round(Math.max(0, gapAfter)),
    },
    features: outFeatures,
  }

  writeFileSync(OUT_GEO, JSON.stringify(out))
  writeFileSync(OUT_JSON, JSON.stringify(out))
  console.log(`\nWrote ${OUT_GEO}`)
  console.log(`Wrote ${OUT_JSON}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
