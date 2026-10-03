/**
 * Enrich Pärnu parking features with zone rules, FREE/KELL/PAID labels,
 * source + lastVerified, and freeNow / freeUntil from freeRules.
 *
 * Paid zone polygons (Kesklinn / Rand) are injected as RED municipal lots
 * so they appear under Tasuline and Kõik.
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { polygon as turfPolygon } from '@turf/helpers'
import {
  PARNU_ZONE_LIST,
  PARNU_ZONE_RULES,
  type ParanuZoneId,
  type ParanuZoneRule,
} from '../data/parnuZones'
import type {
  PreciseParkingCollection,
  PreciseParkingFeature,
} from './preciseParkingPolygons'
import type { StreetParkingCollection } from './streetParkingLines'
import { evaluateFreeRules } from './freeRules'
import { parkingDisplayName } from './parkingDisplayName'
import {
  categoryPaintColor,
  PARKING_COLOR_PAID,
} from './parkingClassification'

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
  const operator = props.operator?.includes('Tallinn')
    ? 'Pärnu Linn'
    : props.operator || 'Pärnu Linn'

  // Outside paid zones — keep OSM classification; never force green.
  if (!zone) {
    const next = {
      ...props,
      operator,
      source,
      lastVerified,
      cityId: 'parnu' as const,
      parnuZone: null,
      verifyOnSite: true,
    }
    return {
      ...next,
      color: categoryPaintColor({
        layer: String(next.layer),
        free_minutes: Number(next.free_minutes ?? 0),
        price_per_hour: Number(next.price_per_hour ?? 0),
        verified_free: Boolean(next.verified_free),
        zone_code: String(next.zone_code ?? ''),
      }),
    }
  }

  // Inside Kesklinn / Rand — always paid municipal (RED), even when currently free
  const evaled = evaluateFreeRules(zone.freeRules, at)
  return {
    ...props,
    name: parkingDisplayName({
      name: props.name,
      operator: 'Pärnu Linn',
      zone_code: zone.id === 'kesklinn' ? 'PKESK' : 'PRAND',
      address: props.address,
      layer: 'municipal',
    }) || `Pärnu ${zone.name}`,
    operator: 'Pärnu Linn',
    zone_code: zone.id === 'kesklinn' ? 'PKESK' : 'PRAND',
    badge: 'PAID',
    layer: 'municipal',
    verified_free: false,
    free_minutes: zone.freeMinutesWithDisc,
    price_per_hour: zone.pricePerHour,
    color: PARKING_COLOR_PAID,
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
  }
}

/** Large paid-zone footprints so Tasuline / Kõik show RED areas. */
function parnuZoneLotFeatures(): PreciseParkingFeature[] {
  return PARNU_ZONE_LIST.map((z) => {
    const id = `parnu-zone-${z.id}`
    return {
      type: 'Feature' as const,
      id,
      properties: {
        id,
        name: `Pärnu ${z.name} — tasuline tsoon`,
        zone_code: z.id === 'kesklinn' ? 'PKESK' : 'PRAND',
        operator: 'Pärnu Linn',
        layer: 'municipal' as const,
        type: 'surface' as const,
        floors: 1,
        free_minutes: z.freeMinutesWithDisc,
        price_per_hour: z.pricePerHour,
        badge: 'PAID',
        address: `Pärnu ${z.name}`,
        desc: `${z.pricePerHour} €/h · ketas ${z.freeMinutesWithDisc} min · ${z.source}`,
        color: PARKING_COLOR_PAID,
        verified_free: false,
        area_m2: 0,
        labelRank: 0,
        floors_label: '',
        structure_label: 'Surface',
        source: z.source,
        lastVerified: z.lastVerified,
        cityId: 'parnu' as const,
        parnuZone: z.id,
        verifyOnSite: true,
        freeReason: `${z.name} tasuline tsoon`,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [z.ring],
      },
    }
  })
}

export function enrichParnuPolygons(
  fc: PreciseParkingCollection,
  at: Date = new Date(),
): PreciseParkingCollection {
  const enriched = fc.features.map((f) => {
    const c = centroidOfGeom(f.geometry)
    if (!c) return f
    const props = enrichProps(
      f.properties as unknown as EnrichableProps,
      c.lng,
      c.lat,
      at,
    )
    return {
      ...f,
      properties: props as unknown as typeof f.properties,
    }
  })
  // Prepend zone polygons so large RED paid areas are always present
  return {
    type: 'FeatureCollection',
    features: [...parnuZoneLotFeatures(), ...enriched],
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
      const props = enrichProps(
        f.properties as unknown as EnrichableProps,
        c.lng,
        c.lat,
        at,
      )
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
