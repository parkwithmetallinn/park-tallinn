/**
 * Pärnu paid parking zones — data only (not hard-coded UI).
 * Source: Pärnu linn / parnu.ee/parkimine schedule (user-specified windows).
 * Official zone polygons: gis.parnu.ee Experience Builder map (public FeatureServer
 * was not reachable at build time) — approximate rings derived from the published
 * city-centre / beach paid areas; verify against the on-street sign.
 */

import type { FreeRuleSet } from '../lib/freeRules'

export type ParanuZoneId = 'kesklinn' | 'rand'

/** GeoJSON polygon ring [lng, lat][] (closed). */
export type ZoneRing = [number, number][]

export type ParanuZoneRule = {
  id: ParanuZoneId
  name: string
  /** Map fill */
  color: string
  pricePerHour: number
  pricePer24h: number
  /** Free minutes with parking disc on the dash */
  freeMinutesWithDisc: number
  /** Mobile parking zone codes */
  mobileCodes: string[]
  /** Outer ring [lng, lat] */
  ring: ZoneRing
  freeRules: FreeRuleSet
  /** Who may park free regardless of schedule */
  exemptions: Array<'ev_m1' | 'motorcycle' | 'disabled'>
  source: string
  lastVerified: string
}

/**
 * Approximate kesklinn paid area (south of Pärnu jõgi, core streets).
 * Refined when official ArcGIS polygons become available.
 */
const KESKLINN_RING: ZoneRing = [
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
]

/**
 * Approximate rand / beach paid area (Ranna puiestee – Supeluse – coastal strip).
 */
const RAND_RING: ZoneRing = [
  [24.4885, 58.3786],
  [24.5058, 58.3784],
  [24.5145, 58.3768],
  [24.5182, 58.3722],
  [24.5155, 58.3678],
  [24.5050, 58.3664],
  [24.4940, 58.3668],
  [24.4872, 58.3695],
  [24.4858, 58.3738],
  [24.4885, 58.3786],
]

const SOURCE = 'Pärnu linn — parnu.ee/parkimine'
const VERIFIED = '2026-10-02'

export const PARNU_ZONE_RULES: Record<ParanuZoneId, ParanuZoneRule> = {
  kesklinn: {
    id: 'kesklinn',
    name: 'Kesklinn',
    /** Strict Tasuline red */
    color: '#FF3B30',
    pricePerHour: 2,
    pricePer24h: 10,
    freeMinutesWithDisc: 60,
    mobileCodes: ['PKESKLINN', 'PKESKLINN60'],
    ring: KESKLINN_RING,
    exemptions: ['ev_m1', 'motorcycle', 'disabled'],
    source: SOURCE,
    lastVerified: VERIFIED,
    freeRules: {
      timezone: 'Europe/Tallinn',
      /** Paid Mon–Fri 08–18, Sat 08–15; free Sunday + public holidays */
      paidWindows: [
        { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' },
        { days: [6], start: '08:00', end: '15:00' },
      ],
      freeOnPublicHolidays: true,
      season: null,
      discMinutes: 60,
    },
  },
  rand: {
    id: 'rand',
    name: 'Rand',
    /** Strict Tasuline red */
    color: '#FF3B30',
    pricePerHour: 3,
    pricePer24h: 15,
    freeMinutesWithDisc: 30,
    mobileCodes: ['PRAND', 'PRAND30'],
    ring: RAND_RING,
    exemptions: ['ev_m1', 'motorcycle', 'disabled'],
    source: SOURCE,
    lastVerified: VERIFIED,
    freeRules: {
      timezone: 'Europe/Tallinn',
      /** Paid 01.05–31.08, Mon–Fri 08–18, Sat 08–15 (incl. holidays); free 01.09–30.04 */
      paidWindows: [
        { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' },
        { days: [6], start: '08:00', end: '15:00' },
      ],
      freeOnPublicHolidays: false,
      season: { startMonth: 5, startDay: 1, endMonth: 8, endDay: 31 },
      discMinutes: 30,
    },
  },
}

export const PARNU_ZONE_LIST: ParanuZoneRule[] = [
  PARNU_ZONE_RULES.kesklinn,
  PARNU_ZONE_RULES.rand,
]

/** GeoJSON for map overlay (kesklinn + rand). */
export function parnuZonesToGeoJSON() {
  return {
    type: 'FeatureCollection' as const,
    features: PARNU_ZONE_LIST.map((z) => ({
      type: 'Feature' as const,
      id: z.id,
      properties: {
        id: z.id,
        name: z.name,
        name_et: z.name,
        role: 'subzone',
        color: z.color,
        summary: `${z.pricePerHour} €/h · ketas ${z.freeMinutesWithDisc} min`,
        source: z.source,
        lastVerified: z.lastVerified,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [z.ring],
      },
    })),
  }
}

export function parnuZoneLabelsToGeoJSON() {
  return {
    type: 'FeatureCollection' as const,
    features: PARNU_ZONE_LIST.map((z) => {
      const ring = z.ring
      let sx = 0
      let sy = 0
      const n = ring.length - 1
      for (let i = 0; i < n; i++) {
        sx += ring[i][0]
        sy += ring[i][1]
      }
      return {
        type: 'Feature' as const,
        properties: {
          id: z.id,
          name: z.name.toUpperCase(),
          role: 'subzone',
          color: z.color,
          labelRank: 1,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [sx / n, sy / n],
        },
      }
    }),
  }
}
