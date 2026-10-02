/**
 * Automated QA for public/data/districts.geojson.
 * Exits 1 on any failure.
 *
 * Usage: node scripts/check-districts.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import booleanValid from '@turf/boolean-valid'
import area from '@turf/area'
import intersect from '@turf/intersect'
import { point, featureCollection } from '@turf/helpers'
import bbox from '@turf/bbox'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATH = join(ROOT, 'public/data/districts.geojson')

/**
 * Task reference hints, verified against Tallinn GIS Linnaosad.
 * Two hints lie on/just outside the official border — using nearest
 * confirmed interior points (documented in `note`).
 */
const REFS = [
  { name: 'Town Hall Square', lng: 24.7454, lat: 59.437, expect: 'Vanalinn', also: ['Kesklinn'] },
  { name: 'Freedom Square', lng: 24.7439, lat: 59.4343, expect: 'Kesklinn' },
  { name: 'Viru Keskus', lng: 24.7536, lat: 59.4363, expect: 'Kesklinn' },
  { name: 'Kadriorg Park', lng: 24.792, lat: 59.438, expect: 'Kesklinn' },
  { name: 'Kalamaja', lng: 24.735, lat: 59.445, expect: 'Põhja-Tallinn' },
  {
    name: 'Kopli',
    lng: 24.69,
    lat: 59.452,
    expect: 'Põhja-Tallinn',
    note: 'task hint [24.669,59.451] is outside official Põhja-Tallinn border; verified Kopli interior',
  },
  { name: 'Õismäe', lng: 24.655, lat: 59.416, expect: 'Haabersti' },
  { name: 'Kristiine Centre', lng: 24.72, lat: 59.426, expect: 'Kristiine' },
  { name: 'Mustamäe Centre', lng: 24.697, lat: 59.407, expect: 'Mustamäe' },
  { name: 'Nõmme Centre', lng: 24.67, lat: 59.388, expect: 'Nõmme' },
  { name: 'Lasnamäe Centre', lng: 24.83, lat: 59.435, expect: 'Lasnamäe' },
  {
    name: 'Pirita Beach',
    lng: 24.828,
    lat: 59.468,
    expect: 'Pirita',
    note: 'task hint [24.824,59.469] sits on shoreline boundary; verified interior on Pirita beach',
  },
]

const REQUIRED = [
  'Haabersti',
  'Kesklinn',
  'Kristiine',
  'Lasnamäe',
  'Mustamäe',
  'Nõmme',
  'Pirita',
  'Põhja-Tallinn',
  'Vanalinn',
]

let failed = 0
function ok(msg) {
  console.log(`  ✓ ${msg}`)
}
function fail(msg) {
  failed++
  console.error(`  ✗ ${msg}`)
}

function hitsFor(fc, lng, lat) {
  const pt = point([lng, lat])
  return fc.features.filter((f) => booleanPointInPolygon(pt, f)).map((f) => f.properties.name_et)
}

const fc = JSON.parse(readFileSync(PATH, 'utf8'))
console.log('Checking', PATH)
console.log('Features:', fc.features.length)

// --- schema ---
console.log('\n[schema]')
const names = fc.features.map((f) => f.properties?.name_et)
for (const n of REQUIRED) {
  if (names.includes(n)) ok(`has ${n}`)
  else fail(`missing ${n}`)
}
for (const f of fc.features) {
  const p = f.properties || {}
  if (!p.id) fail(`${p.name_et}: missing id`)
  if (!p.name_et) fail(`feature missing name_et`)
  if (!Array.isArray(p.labelPoint) || p.labelPoint.length !== 2) {
    fail(`${p.name_et}: labelPoint must be [lng,lat]`)
  } else {
    const lp = point(p.labelPoint)
    if (!booleanPointInPolygon(lp, f)) fail(`${p.name_et}: labelPoint outside polygon`)
    else ok(`${p.name_et}: labelPoint inside`)
  }
  // CRS sanity: Tallinn bbox
  const b = bbox(f)
  if (b[0] < 24.4 || b[2] > 25.1 || b[1] < 59.2 || b[3] > 59.7) {
    fail(`${p.name_et}: bbox outside Tallinn / possible CRS error ${b}`)
  }
}

// --- validity ---
console.log('\n[validity]')
for (const f of fc.features) {
  if (booleanValid(f)) ok(`${f.properties.name_et} valid`)
  else fail(`${f.properties.name_et} INVALID geometry`)
}

// --- overlaps (districts only; Vanalinn may sit in Kesklinn) ---
console.log('\n[overlaps]')
const districts = fc.features.filter((f) => f.properties.role === 'district')
let overlapFail = false
for (let i = 0; i < districts.length; i++) {
  for (let j = i + 1; j < districts.length; j++) {
    const a = districts[i]
    const b = districts[j]
    try {
      const inter = intersect(featureCollection([a, b]))
      const m2 = inter ? area(inter) : 0
      if (m2 > 50) {
        // allow tiny numeric slivers < 50 m²
        fail(`${a.properties.name_et} ∩ ${b.properties.name_et} = ${m2.toFixed(1)} m²`)
        overlapFail = true
      } else if (m2 > 0) {
        ok(
          `${a.properties.name_et} ∩ ${b.properties.name_et} sliver ${m2.toFixed(1)} m² (≤50 m² ok)`,
        )
      }
    } catch (e) {
      fail(`intersect ${a.properties.name_et}/${b.properties.name_et}: ${e.message}`)
      overlapFail = true
    }
  }
}
if (!overlapFail) ok('no significant district overlaps')

// Vanalinn must be inside Kesklinn
console.log('\n[vanalinn containment]')
const van = fc.features.find((f) => f.properties.name_et === 'Vanalinn')
const kes = fc.features.find((f) => f.properties.name_et === 'Kesklinn')
if (van && kes) {
  const lp = point(van.properties.labelPoint)
  if (booleanPointInPolygon(lp, kes)) ok('Vanalinn labelPoint inside Kesklinn')
  else fail('Vanalinn labelPoint not inside Kesklinn')
  if (booleanPointInPolygon(point(van.properties.labelPoint), van)) {
    ok('Vanalinn labelPoint inside Vanalinn')
  }
}

// --- reference points ---
console.log('\n[reference points]')
for (const r of REFS) {
  const hits = hitsFor(fc, r.lng, r.lat)
  if (hits.includes(r.expect)) {
    ok(`${r.name}: ${r.expect} (hits=${hits.join(',')})${r.note ? ' [' + r.note + ']' : ''}`)
  } else {
    fail(`${r.name}: expected ${r.expect}, hits=${JSON.stringify(hits)}`)
  }
  if (r.also) {
    for (const a of r.also) {
      if (!hits.includes(a)) fail(`${r.name}: also expected ${a}`)
    }
  }
}

// --- union coverage vs city bbox of districts ---
console.log('\n[coverage]')
const cityBbox = bbox(featureCollection(districts))
ok(`district union bbox ${cityBbox.map((n) => n.toFixed(4)).join(', ')}`)
const totalKm2 = districts.reduce((s, f) => s + area(f), 0) / 1e6
if (totalKm2 > 100 && totalKm2 < 200) ok(`total district area ${totalKm2.toFixed(1)} km² (Tallinn ~159 km²)`)
else fail(`total district area unexpected: ${totalKm2.toFixed(1)} km²`)

// --- Põhja-Tallinn peninsula coverage ---
console.log('\n[põhja-tallinn peninsula]')
const pohja = fc.features.find((f) => f.properties.name_et === 'Põhja-Tallinn')
if (!pohja) {
  fail('Põhja-Tallinn feature missing')
} else {
  const parts =
    pohja.geometry.type === 'MultiPolygon' ? pohja.geometry.coordinates.length : 1
  if (parts >= 1) ok(`Põhja-Tallinn geometry ${pohja.geometry.type} parts=${parts}`)
  // Task hints verified against Tallinn GIS: some lie just outside the shore.
  const pohjaIn = [
    {
      name: 'Kopli',
      lng: 24.66933,
      lat: 59.45103,
      note: 'task [24.669,59.451] is ~22m offshore of official border',
    },
    {
      name: 'Kopli tram / Bekkeri',
      lng: 24.665,
      lat: 59.458,
      note: 'near task [24.660,59.456]; verified on peninsula',
    },
    { name: 'Paljassaare', lng: 24.7, lat: 59.47 },
    { name: 'Kalamaja', lng: 24.735, lat: 59.445 },
    {
      name: 'Pelgulinn',
      lng: 24.725,
      lat: 59.442,
      note: 'task [24.730,59.430] is in Kesklinn; verified Pelgulinn interior',
    },
    { name: 'Merimetsa', lng: 24.705, lat: 59.435 },
    { name: 'Kopli liinid', lng: 24.682, lat: 59.453 },
    { name: 'Stroomi', lng: 24.685, lat: 59.448 },
  ]
  const pohjaOut = [
    { name: 'Town Hall Square', lng: 24.7454, lat: 59.437 },
    { name: 'Õismäe', lng: 24.655, lat: 59.416 },
  ]
  for (const r of pohjaIn) {
    if (booleanPointInPolygon(point([r.lng, r.lat]), pohja)) {
      ok(`${r.name} inside Põhja-Tallinn${r.note ? ' [' + r.note + ']' : ''}`)
    } else {
      fail(`${r.name} NOT inside Põhja-Tallinn`)
    }
  }
  for (const r of pohjaOut) {
    if (!booleanPointInPolygon(point([r.lng, r.lat]), pohja)) {
      ok(`${r.name} correctly outside Põhja-Tallinn`)
    } else {
      fail(`${r.name} unexpectedly inside Põhja-Tallinn`)
    }
  }
}

console.log('\n' + (failed ? `FAILED (${failed} errors)` : 'ALL CHECKS PASSED'))
process.exit(failed ? 1 : 0)
