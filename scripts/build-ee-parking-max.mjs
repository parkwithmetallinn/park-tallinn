#!/usr/bin/env node
/**
 * Build public/data/ee_parking_max.geojson:
 *  - merge Overpass raw + existing masters + city zones + RMK/P+R seeds
 *  - spatial dedupe (10 m) preserving rich metadata
 *  - street-segment aggregation for continuous curb parking
 *  - enrich grey/unclassified spots via city_zones point-in-polygon
 *
 * Usage:
 *   node scripts/build-ee-parking-max.mjs
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA = join(ROOT, 'public/data')
const OUT = join(DATA, 'ee_parking_max.geojson')
const CITY_ZONES_OUT = join(DATA, 'city_zones.geojson')
const RAW = join(DATA, 'ee_parking_max.raw.geojson')

const DEDUPE_M = 10
const STREET_CLUSTER_M = 100

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function str(v) {
  return v == null ? '' : String(v).trim()
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function featureCentroid(f) {
  const g = f.geometry
  if (!g) return null
  if (g.type === 'Point') {
    return { lng: g.coordinates[0], lat: g.coordinates[1] }
  }
  let ring
  if (g.type === 'LineString') ring = g.coordinates
  else if (g.type === 'Polygon') ring = g.coordinates[0]
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0][0]
  else if (g.type === 'MultiLineString') ring = g.coordinates[0]
  else return null
  if (!ring?.length) return null
  let sx = 0
  let sy = 0
  const n = ring.length
  for (const c of ring) {
    sx += c[0]
    sy += c[1]
  }
  return { lng: sx / n, lat: sy / n }
}

function richnessScore(p) {
  let s = 0
  if (str(p.operator)) s += 3
  if (str(p.fee)) s += 2
  if (str(p.charge)) s += 2
  if (str(p.maxstay)) s += 2
  if (str(p.zone) || str(p.zone_code) || str(p.ref)) s += 2
  if (str(p.name)) s += 1
  if (str(p.parking)) s += 1
  if (str(p.description) || str(p.desc)) s += 1
  if (p.price_per_hour != null) s += 2
  if (p.free_minutes != null) s += 1
  if (p.park_ride === 'yes' || p.parking === 'park_and_ride') s += 2
  return s
}

function mergeProps(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b || {})) {
    if (v == null || v === '') continue
    if (out[k] == null || out[k] === '') out[k] = v
  }
  return out
}

/** Point-in-polygon (ray cast). ring = [lng,lat][] */
function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(lng, lat, geom) {
  if (!geom) return false
  if (geom.type === 'Polygon') return pointInRing(lng, lat, geom.coordinates[0])
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pointInRing(lng, lat, poly[0]))
  }
  return false
}

function hasLaneTags(p) {
  return Object.keys(p || {}).some(
    (k) =>
      k.startsWith('parking:lane') ||
      k.startsWith('parking:both') ||
      k.startsWith('parking:left') ||
      k.startsWith('parking:right'),
  )
}

function isStreetFeature(f) {
  const g = f.geometry?.type
  if (g === 'LineString' || g === 'MultiLineString') return true
  const p = f.properties || {}
  const parking = str(p.parking).toLowerCase()
  if (parking === 'street_side' || parking === 'lane' || parking === 'on_kerb') {
    return true
  }
  return hasLaneTags(p)
}

function rulesKey(p) {
  const fee = str(p.fee).toLowerCase()
  const maxstay = str(p.maxstay).toLowerCase()
  const freeMin = p.free_minutes ?? ''
  const price = p.price_per_hour ?? str(p.charge)
  const zone = str(p.zone || p.zone_code || p.ref).toUpperCase()
  return `${fee}|${maxstay}|${freeMin}|${price}|${zone}|${str(p.parking)}`
}

function streetLabel(p) {
  const addr = str(p.address || p['addr:street'] || p.name)
  const first = addr.split(',')[0]?.trim() || addr
  const street = first.replace(/\s+\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?$/u, '').trim()
  return street || first || 'Tänav'
}

/** Build city_zones.geojson from Tallinn PAID_ZONES + Pärnu rings. */
function buildCityZones() {
  // Inline zone rings — kept in sync with src/data/parking.ts + parnuZones.ts
  const tallinn = [
    {
      id: 'tallinn-vanalinn',
      name: 'Vanalinn',
      city: 'tallinn',
      zone_code: 'VANALINN',
      price_per_hour: 6,
      free_minutes: 15,
      operator: 'Tallinna Linn',
      // [lat,lng] → [lng,lat]
      coordsLatLng: [
        [59.44353, 24.75315],
        [59.44414, 24.74681],
        [59.44377, 24.74552],
        [59.44241, 24.74448],
        [59.44009, 24.73878],
        [59.43926, 24.73617],
        [59.43812, 24.73412],
        [59.43659, 24.73279],
        [59.43612, 24.73234],
        [59.43504, 24.73267],
        [59.43221, 24.73503],
        [59.431, 24.73889],
        [59.43263, 24.74333],
        [59.4328, 24.74617],
        [59.43403, 24.74682],
        [59.4346, 24.74783],
        [59.43618, 24.75272],
        [59.43733, 24.75284],
        [59.43738, 24.75354],
        [59.43798, 24.75397],
        [59.43888, 24.75424],
        [59.4413, 24.75397],
        [59.44238, 24.75308],
        [59.44337, 24.75336],
        [59.44353, 24.75315],
      ],
    },
    {
      id: 'tallinn-sudalinn',
      name: 'Südalinn',
      city: 'tallinn',
      zone_code: 'SÜDALINN',
      price_per_hour: 4.8,
      free_minutes: 15,
      operator: 'AS Ühisteenused',
      coordsLatLng: [
        [59.4328, 24.74617],
        [59.43268, 24.74847],
        [59.43142, 24.75033],
        [59.43365, 24.75584],
        [59.43372, 24.7581],
        [59.43736, 24.75763],
        [59.43725, 24.75453],
        [59.43738, 24.75354],
        [59.43733, 24.75284],
        [59.43679, 24.75265],
        [59.4365, 24.75231],
        [59.43618, 24.75272],
        [59.43487, 24.74842],
        [59.43403, 24.74682],
        [59.43353, 24.74634],
        [59.43319, 24.74619],
        [59.4328, 24.74617],
      ],
    },
    {
      id: 'tallinn-kesklinn',
      name: 'Kesklinn',
      city: 'tallinn',
      zone_code: 'KESKLINN',
      price_per_hour: 1.5,
      free_minutes: 15,
      operator: 'Tallinna Linn',
      coordsLatLng: [
        [59.44921, 24.75986],
        [59.44779, 24.75421],
        [59.446, 24.75525],
        [59.44353, 24.75316],
        [59.43926, 24.73617],
        [59.43612, 24.73234],
        [59.43248, 24.72329],
        [59.42444, 24.72868],
        [59.42096, 24.7907],
        [59.42626, 24.7809],
        [59.43342, 24.79029],
        [59.44041, 24.80693],
        [59.44354, 24.81248],
        [59.44616, 24.81245],
        [59.45117, 24.80606],
        [59.44346, 24.7897],
        [59.44606, 24.77739],
        [59.44358, 24.77133],
        [59.44424, 24.76786],
        [59.44198, 24.76077],
        [59.44534, 24.76733],
        [59.44548, 24.76236],
        [59.44974, 24.77472],
        [59.45163, 24.76574],
        [59.44804, 24.76355],
        [59.44921, 24.75986],
      ],
    },
    {
      id: 'tallinn-pirita',
      name: 'Pirita rand',
      city: 'tallinn',
      zone_code: 'PIRITA',
      price_per_hour: 0.6,
      free_minutes: 0,
      operator: 'Tallinna Linn',
      coordsLatLng: [
        [59.46513, 24.82163],
        [59.46622, 24.82249],
        [59.46824, 24.82329],
        [59.46929, 24.82608],
        [59.47175, 24.83023],
        [59.47636, 24.83422],
        [59.48337, 24.8375],
        [59.48678, 24.8377],
        [59.48909, 24.83598],
        [59.49035, 24.83214],
        [59.49158, 24.82964],
        [59.49074, 24.8269],
        [59.4885, 24.8245],
        [59.482, 24.822],
        [59.474, 24.8195],
        [59.46835, 24.81688],
        [59.4666, 24.82189],
        [59.46513, 24.82163],
      ],
    },
  ]

  const parnu = [
    {
      id: 'parnu-kesklinn',
      name: 'Pärnu Kesklinn',
      city: 'parnu',
      zone_code: 'PKESK',
      price_per_hour: 2,
      free_minutes: 15,
      operator: 'Pärnu Linn',
      ringLngLat: [
        [24.4912, 58.3888],
        [24.4985, 58.3896],
        [24.5088, 58.3892],
        [24.5156, 58.3874],
        [24.5164, 58.3836],
        [24.5128, 58.3798],
        [24.5055, 58.3784],
        [24.4972, 58.3786],
        [24.4918, 58.3804],
        [24.4896, 58.3838],
        [24.4912, 58.3888],
      ],
    },
    {
      id: 'parnu-rand',
      name: 'Pärnu Rand',
      city: 'parnu',
      zone_code: 'PRAND',
      price_per_hour: 2,
      free_minutes: 15,
      operator: 'Pärnu Linn',
      ringLngLat: [
        [24.4885, 58.3786],
        [24.5058, 58.3784],
        [24.5145, 58.3768],
        [24.5182, 58.3722],
        [24.5155, 58.3678],
        [24.505, 58.3664],
        [24.494, 58.3668],
        [24.4872, 58.3695],
        [24.4858, 58.3738],
        [24.4885, 58.3786],
      ],
    },
  ]

  const features = []
  for (const z of tallinn) {
    const ring = z.coordsLatLng.map(([lat, lng]) => [lng, lat])
    features.push({
      type: 'Feature',
      id: z.id,
      properties: {
        id: z.id,
        name: z.name,
        city: z.city,
        zone_code: z.zone_code,
        price_per_hour: z.price_per_hour,
        free_minutes: z.free_minutes,
        operator: z.operator,
        role: 'paid_zone',
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }
  for (const z of parnu) {
    features.push({
      type: 'Feature',
      id: z.id,
      properties: {
        id: z.id,
        name: z.name,
        city: z.city,
        zone_code: z.zone_code,
        price_per_hour: z.price_per_hour,
        free_minutes: z.free_minutes,
        operator: z.operator,
        role: 'paid_zone',
      },
      geometry: { type: 'Polygon', coordinates: [z.ringLngLat] },
    })
  }

  const fc = {
    type: 'FeatureCollection',
    name: 'ee_city_paid_zones',
    features,
  }
  writeFileSync(CITY_ZONES_OUT, JSON.stringify(fc))
  console.log(`[build] wrote ${CITY_ZONES_OUT} (${features.length} zones)`)
  return fc
}

/** Seed P+R / curated free lots from src/data/parking.ts via dynamic import of JSON-like extraction. */
function curatedParkRideFeatures() {
  // Lightweight curated P+R points (also present in OSM when tagged).
  const seeds = [
    {
      id: 'pr-ulemiste',
      name: 'Ülemiste Pargi & Reisi',
      lat: 59.4205,
      lng: 24.7985,
      address: 'Ülemiste',
    },
    {
      id: 'pr-pirita',
      name: 'Pirita Pargi & Reisi',
      lat: 59.4682,
      lng: 24.832,
      address: 'Pirita',
    },
    {
      id: 'pr-mustamae',
      name: 'Mustamäe Pargi & Reisi',
      lat: 59.402,
      lng: 24.688,
      address: 'Mustamäe',
    },
  ]
  return seeds.map((s) => ({
    type: 'Feature',
    id: s.id,
    properties: {
      '@id': s.id,
      name: s.name,
      amenity: 'parking',
      parking: 'park_and_ride',
      park_ride: 'yes',
      operator: 'Tallinna Linn',
      fee: 'no',
      address: s.address,
      source: 'curated_park_ride',
    },
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
  }))
}

function loadOptional(path) {
  if (!existsSync(path)) return []
  try {
    const fc = readJson(path)
    return Array.isArray(fc.features) ? fc.features : []
  } catch (err) {
    console.warn(`[build] skip ${path}:`, err.message)
    return []
  }
}

function normalizeFeature(f, sourceTag) {
  if (!f?.geometry) return null
  const p = { ...(f.properties || {}) }
  if (!p['@id'] && f.id != null) p['@id'] = String(f.id)
  if (sourceTag && !p.source) p.source = sourceTag
  // Promote picnic/caravan with parking intent
  if (p.tourism === 'caravan_site' && !p.amenity) p.amenity = 'parking'
  if (p.leisure === 'picnic_site' && (p.parking || p.amenity === 'parking')) {
    p.amenity = p.amenity || 'parking'
  }
  return { type: 'Feature', id: p['@id'] || f.id, properties: p, geometry: f.geometry }
}

function dedupeSpatial(features) {
  const withC = []
  for (const f of features) {
    const c = featureCentroid(f)
    if (!c) continue
    withC.push({ f, ...c, score: richnessScore(f.properties || {}) })
  }
  withC.sort((a, b) => b.score - a.score || a.lat - b.lat)

  // Grid index ~11 m cells
  const cell = 0.0001
  const grid = new Map()
  const kept = []

  const cellKey = (lat, lng) =>
    `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`

  for (const item of withC) {
    let merged = false
    for (let di = -1; di <= 1 && !merged; di++) {
      for (let dj = -1; dj <= 1 && !merged; dj++) {
        const key = `${Math.floor(item.lat / cell) + di}:${Math.floor(item.lng / cell) + dj}`
        const bucket = grid.get(key)
        if (!bucket) continue
        for (const idx of bucket) {
          const other = kept[idx]
          if (haversineM(item.lat, item.lng, other.lat, other.lng) > DEDUPE_M) {
            continue
          }
          // Prefer richer metadata; keep richer geometry preference (Polygon > Line > Point)
          other.f.properties = mergeProps(other.f.properties, item.f.properties)
          if (
            geomRank(item.f.geometry?.type) > geomRank(other.f.geometry?.type)
          ) {
            other.f.geometry = item.f.geometry
          }
          if (item.score > other.score) {
            other.score = item.score
            other.lat = item.lat
            other.lng = item.lng
          }
          merged = true
          break
        }
      }
    }
    if (merged) continue
    const idx = kept.length
    kept.push(item)
    const key = cellKey(item.lat, item.lng)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(idx)
  }

  return kept.map((k) => k.f)
}

function geomRank(t) {
  if (t === 'Polygon' || t === 'MultiPolygon') return 3
  if (t === 'LineString' || t === 'MultiLineString') return 2
  if (t === 'Point') return 1
  return 0
}

function aggregateStreetSegments(features) {
  const streets = []
  const rest = []
  for (const f of features) {
    if (isStreetFeature(f)) streets.push(f)
    else rest.push(f)
  }

  const byRules = new Map()
  for (const f of streets) {
    const key = rulesKey(f.properties || {})
    if (!byRules.has(key)) byRules.set(key, [])
    byRules.get(key).push(f)
  }

  const out = [...rest]
  for (const group of byRules.values()) {
    const remaining = group.map((f) => {
      const c = featureCentroid(f)
      return { f, ...c }
    })
    while (remaining.length) {
      const seed = remaining.shift()
      const members = [seed]
      for (let i = remaining.length - 1; i >= 0; i--) {
        const cand = remaining[i]
        const near = members.some(
          (m) => haversineM(m.lat, m.lng, cand.lat, cand.lng) <= STREET_CLUSTER_M,
        )
        if (!near) continue
        members.push(cand)
        remaining.splice(i, 1)
      }
      if (members.length === 1) {
        out.push(seed.f)
        continue
      }
      const street = streetLabel(seed.f.properties || {})
      const props = members.reduce(
        (acc, m) => mergeProps(acc, m.f.properties || {}),
        { ...(seed.f.properties || {}) },
      )
      props.name = `${street} - Teeäärne parkimine`
      props.address = props.address || street
      props.cluster_count = members.length
      props.aggregated = true
      // Prefer a LineString member as geometry
      const lineMember =
        members.find((m) => m.f.geometry?.type?.includes('Line')) || seed
      out.push({
        type: 'Feature',
        id: props['@id'] || seed.f.id,
        properties: props,
        geometry: lineMember.f.geometry,
      })
    }
  }
  return out
}

function enrichWithZones(features, zones) {
  let insidePaid = 0
  let markedFree = 0
  for (const f of features) {
    const p = f.properties || {}
    const c = featureCentroid(f)
    if (!c) continue

    const fee = str(p.fee).toLowerCase()
    const hasPaidSignal =
      fee === 'yes' ||
      str(p.charge) ||
      Number(p.price_per_hour) > 0 ||
      p.park_ride === 'yes' ||
      p.parking === 'park_and_ride'
    const hasFreeSignal = fee === 'no' || fee === 'free'
    const hasClock = Boolean(str(p.maxstay)) || Number(p.free_minutes) > 0

    let zoneHit = null
    for (const z of zones.features) {
      if (pointInPolygon(c.lng, c.lat, z.geometry)) {
        zoneHit = z.properties
        break
      }
    }

    if (zoneHit && !hasPaidSignal && !hasFreeSignal) {
      // Inside paid municipal zone → assign official rates / 15-min clock
      p.zone = p.zone || zoneHit.zone_code
      p.zone_code = p.zone_code || zoneHit.zone_code
      p.fee = p.fee || 'yes'
      p.price_per_hour = p.price_per_hour ?? zoneHit.price_per_hour
      p.free_minutes = p.free_minutes ?? zoneHit.free_minutes
      p.operator = p.operator || zoneHit.operator
      p.maxstay =
        p.maxstay ||
        (zoneHit.free_minutes ? `${zoneHit.free_minutes} min` : p.maxstay)
      p.enriched_from_zone = zoneHit.id
      insidePaid++
    } else if (!zoneHit && !hasPaidSignal && !hasClock && !hasFreeSignal) {
      // Outside paid zones, no fee=yes → treat as 100% FREE public parking
      if (str(p.amenity) === 'parking' || str(p.amenity) === 'parking_space') {
        p.fee = 'no'
        p.free_minutes = 0
        p.verified_free_hint = true
        p.enriched_as = 'free_outside_zones'
        markedFree++
      }
    }
    f.properties = p
  }
  console.log(
    `[build] zone enrich: insidePaid=${insidePaid} markedFree=${markedFree}`,
  )
  return features
}

/** MapView lot layer only draws polygons — expand Point parking to ~16 m squares. */
function materializePointLots(features) {
  let n = 0
  const out = features.map((f) => {
    if (f.geometry?.type !== 'Point') return f
    const p = f.properties || {}
    if (isStreetFeature(f)) return f
    const [lng, lat] = f.geometry.coordinates
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return f
    const halfM = 8
    const dLat = halfM / 111_320
    const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
    const ring = [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]
    n++
    return {
      ...f,
      properties: { ...p, synthesized_from: 'point' },
      geometry: { type: 'Polygon', coordinates: [ring] },
    }
  })
  console.log(`[build] synthesized ${n} point→polygon lots`)
  return out
}

function main() {
  mkdirSync(DATA, { recursive: true })
  const zones = buildCityZones()

  const sources = [
    [RAW, 'overpass_max'],
    [join(DATA, 'estonia_parking_master.geojson'), 'estonia_master'],
    [join(DATA, 'parnu_parking_master.geojson'), 'parnu_master'],
  ]

  let merged = []
  for (const [path, tag] of sources) {
    const feats = loadOptional(path)
      .map((f) => normalizeFeature(f, tag))
      .filter(Boolean)
    console.log(`[build] loaded ${feats.length} from ${path}`)
    merged = merged.concat(feats)
  }
  merged = merged.concat(curatedParkRideFeatures())
  // Include zone polygons themselves as municipal reference areas (optional map fill)
  for (const z of zones.features) {
    merged.push({
      type: 'Feature',
      id: z.id,
      properties: {
        ...z.properties,
        amenity: 'parking',
        parking: 'surface',
        fee: 'yes',
        '@id': z.id,
        source: 'city_zones',
        role: 'paid_zone',
      },
      geometry: z.geometry,
    })
  }

  console.log(`[build] merged raw count: ${merged.length}`)
  const deduped = dedupeSpatial(merged)
  console.log(`[build] after 10m dedupe: ${deduped.length}`)
  const clustered = aggregateStreetSegments(deduped)
  console.log(`[build] after street aggregation: ${clustered.length}`)
  const enriched = materializePointLots(enrichWithZones(clustered, zones))

  const fc = {
    type: 'FeatureCollection',
    name: 'ee_parking_max',
    properties: {
      builtAt: new Date().toISOString(),
      dedupeMeters: DEDUPE_M,
      streetClusterMeters: STREET_CLUSTER_M,
      sources: sources.map((s) => s[1]).concat(['city_zones', 'curated_park_ride', 'geofabrik_pbf']),
      featureCount: enriched.length,
    },
    features: enriched,
  }
  writeFileSync(OUT, JSON.stringify(fc))
  const mb = (Buffer.byteLength(JSON.stringify(fc)) / (1024 * 1024)).toFixed(2)
  console.log(`[build] wrote ${OUT} (${enriched.length} features, ~${mb} MB)`)
}

main()
