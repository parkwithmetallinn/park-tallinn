/**
 * Enrich Pärnu parking features with zone rules, FREE/KELL/EV labels,
 * source + lastVerified, and freeNow / freeUntil from freeRules.
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { polygon as turfPolygon } from '@turf/helpers'
import {
  PARNU_ZONE_LIST,
  PARNU_ZONE_RULES,
  type ParanuZoneId,
  type ParanuZoneRule,
} from '../data/parnuZones'
import type { PreciseParkingCollection } from './preciseParkingPolygons'
import type { StreetParkingCollection } from './streetParkingLines'
import { evaluateFreeRules } from './freeRules'
import { PARKING_COLOR_FREE, PARKING_COLOR_TIMED } from './parkingClassification'
import { lotFillColor } from '../map/streetLineTheme'

const OSM_SOURCE = 'OpenStreetMap (Overpass extract via estonia_parking_master)'
const DEFAULT_VERIFIED = '2026-10-02'

const zonePolys = PARNU_ZONE_LIST.map((z) => ({
  id: z.id as ParanuZoneId,
  rule: z,
  poly: turfPolygon([z.ring]),
}))

function zoneAt(lng: number, lat: number): ParanuZoneRule | null {
  const pt: [number, number] = [lng, lat]
  for (const z of zonePolys) {
    if (booleanPointInPolygon(pt, z.poly)) return z.rule
  }
  return null
}

function centroidOfGeom(geom: {
  type: string
  coordinates: unknown
}): { lng: number; lat: number } | null {
  try {
    if (geom.type === 'Point') {
      const c = geom.coordinates as number[]
      return { lng: c[0], lat: c[1] }
    }
    if (geom.type === 'LineString') {
      const coords = geom.coordinates as number[][]
      const mid = coords[Math.floor(coords.length / 2)]
      return { lng: mid[0], lat: mid[1] }
    }
    if (geom.type === 'Polygon') {
      const ring = (geom.coordinates as number[][][])[0]
      let sx = 0
      let sy = 0
      const n = Math.max(1, ring.length - 1)
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return { lng: sx / n, lat: sy / n }
    }
    if (geom.type === 'MultiPolygon') {
      const ring = (geom.coordinates as number[][][][])[0][0]
      let sx = 0
      let sy = 0
      const n = Math.max(1, ring.length - 1)
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return { lng: sx / n, lat: sy / n }
    }
  } catch {
    return null
  }
  return null
}

type EnrichableProps = {
  id: string
  name: string
  zone_code: string
  operator: string
  layer: string
  free_minutes: number
  price_per_hour: number
  badge: string
  address: string
  desc?: string
  color: string
  verified_free: boolean
  [key: string]: unknown
}

function enrichProps(
  props: EnrichableProps,
  lng: number,
  lat: number,
  at: Date,
): EnrichableProps {
  const zone = zoneAt(lng, lat)
  const source = String(props.source ?? OSM_SOURCE)
  const lastVerified = String(props.lastVerified ?? DEFAULT_VERIFIED)

  // Already verified free from OSM fee=no — keep FREE unless inside a paid zone
  // that overrides (municipal paid zone wins for curb inside kesklinn/rand).
  if (!zone) {
    const isTimed = props.layer === 'timed' || props.zone_code === 'KELL'
    // Outside paid zones: prefer FREE for unknown (many OSM lots lack fee tags)
    const freeLabel = props.layer === 'ev' ? 'EV' : isTimed ? 'KELL' : 'FREE'
    return {
      ...props,
      operator: props.operator?.includes('Tallinn') ? 'Pärnu Linn' : props.operator || 'Pärnu Linn',
      zone_code: freeLabel,
      badge: freeLabel,
      layer: freeLabel === 'KELL' ? 'timed' : freeLabel === 'EV' ? 'ev' : 'free_street',
      verified_free: freeLabel === 'FREE',
      free_minutes: freeLabel === 'KELL' ? props.free_minutes || 15 : 0,
      price_per_hour: 0,
      color: freeLabel === 'FREE' ? PARKING_COLOR_FREE : props.color,
      source,
      lastVerified,
      cityId: 'parnu',
      freeNow: freeLabel === 'FREE',
      freeUntil: null,
      freeReason:
        freeLabel === 'FREE'
          ? 'Väljaspool tasulist tsooni'
          : 'Kellaga / ajapiirang',
      exemptions: [],
      verifyOnSite: true,
      parnuZone: null,
    }
  }

  const evaled = evaluateFreeRules(zone.freeRules, at)
  const label = evaled.label
  const layer = label === 'FREE' ? 'free_street' : 'timed'
  const price = evaled.freeNow ? 0 : zone.pricePerHour

  return {
    ...props,
    name:
      props.name && !/^Zone |^Surface|^Underground|^Multi/i.test(props.name)
        ? props.name
        : `${zone.name} · parkla`,
    operator: 'Pärnu Linn',
    zone_code: label,
    badge: label,
    layer,
    verified_free: evaled.freeNow,
    free_minutes: zone.freeMinutesWithDisc,
    price_per_hour: price,
    color: evaled.freeNow ? PARKING_COLOR_FREE : PARKING_COLOR_TIMED,
    // keep municipal paint for paid via timed color
    desc: [
      `${zone.name}: ${zone.pricePerHour} €/h · ${zone.pricePer24h} €/24h`,
      evaled.reason,
      `Ketas ${zone.freeMinutesWithDisc} min`,
      `M-parkimine: ${zone.mobileCodes.join(', ')}`,
    ].join(' · '),
    source: zone.source,
    lastVerified: zone.lastVerified,
    cityId: 'parnu',
    freeNow: evaled.freeNow,
    freeUntil: evaled.freeUntil,
    freeReason: evaled.reason,
    exemptions: zone.exemptions,
    verifyOnSite: true,
    parnuZone: zone.id,
    // When paid, still use timed layer so KELL filter works; price from zone
    ...(evaled.freeNow
      ? {}
      : {
          layer: 'timed',
          color: lotFillColor('timed'),
        }),
  }
}

export function enrichParnuPolygons(
  fc: PreciseParkingCollection,
  at: Date = new Date(),
): PreciseParkingCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const c = centroidOfGeom(f.geometry)
      if (!c) return f
      const props = enrichProps(f.properties as unknown as EnrichableProps, c.lng, c.lat, at)
      return {
        ...f,
        properties: props as unknown as typeof f.properties,
      }
    }),
  }
}

export function enrichParnuStreets(
  fc: StreetParkingCollection,
  at: Date = new Date(),
): StreetParkingCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const c = centroidOfGeom(f.geometry as never)
      if (!c) return f
      const props = enrichProps(f.properties as unknown as EnrichableProps, c.lng, c.lat, at)
      return {
        ...f,
        properties: props as unknown as typeof f.properties,
      }
    }),
  }
}

export function getParnuZone(id: ParanuZoneId) {
  return PARNU_ZONE_RULES[id]
}
