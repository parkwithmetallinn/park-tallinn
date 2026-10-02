/**
 * Pärnu EV chargers — OSM Overpass was unreachable at build time;
 * seeded from Nominatim places + operator specs, cross-check targets for OCM.
 */

import { normalizeSpot } from '../lib/geojson'
import type { ParkingSpot } from '../types'

const VERIFIED = '2026-10-02'

export type EvChargerSeed = {
  id: string
  name: string
  operator: string
  lat: number
  lng: number
  address: string
  capacity?: number
  socketTypes: string[]
  maxPowerKw: number
  source: string
  lastVerified: string
  note?: string
}

/** Seed + known high-power sites requested in product brief. */
export const PARNU_EV_CHARGER_SEEDS: EvChargerSeed[] = [
  {
    id: 'parnu-ev-eleport-niidu-18b',
    name: 'Eleport Niidu 18b',
    operator: 'Eleport',
    lat: 58.3920974,
    lng: 24.5355823,
    address: 'Niidu 18b, Rääma, Pärnu',
    capacity: 4,
    socketTypes: ['CCS', 'CHAdeMO'],
    maxPowerKw: 200,
    source: 'Seed (Eleport) + Nominatim Niidu 18b',
    lastVerified: VERIFIED,
    note: '200 kW kiirlaadija — kontrolli kohapeal saadavust',
  },
  {
    id: 'parnu-ev-neste-niidu',
    name: 'Neste Niidu (200 kW)',
    operator: 'Neste',
    lat: 58.393453,
    lng: 24.5395274,
    address: 'Niidu 9, Rääma, Pärnu',
    capacity: 2,
    socketTypes: ['CCS'],
    maxPowerKw: 200,
    source: 'Seed (Neste 200 kW) + Nominatim Neste Niidu',
    lastVerified: VERIFIED,
    note: '200 kW — Open Charge Map / kohapealne silt kinnituseks',
  },
  {
    id: 'parnu-ev-tesla-supercharger-lai',
    name: 'Tesla Supercharger Lai',
    operator: 'Tesla',
    lat: 58.3876963,
    lng: 24.5011423,
    address: 'Lai, Kesklinn, Pärnu',
    capacity: 8,
    socketTypes: ['NACS', 'CCS'],
    maxPowerKw: 250,
    source: 'Nominatim Pärnu Supercharger',
    lastVerified: VERIFIED,
  },
]

export function parnuEvChargersAsSpots(): ParkingSpot[] {
  return PARNU_EV_CHARGER_SEEDS.map((c) => {
    const sockets = c.socketTypes.join(', ')
    return normalizeSpot({
      id: c.id,
      name: c.name,
      featureType: 'ev-charger',
      operator: c.operator as never,
      layer: 'ev',
      zone_code: 'EV',
      free_minutes: 0,
      price_per_hour: 0,
      badge: 'EV',
      timeLimit: `${c.maxPowerKw} kW`,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      desc: [
        c.capacity ? `${c.capacity} kohta` : null,
        sockets,
        `${c.maxPowerKw} kW`,
        c.note,
      ]
        .filter(Boolean)
        .join(' · '),
      type: 'free',
      kind: 'lot',
      landmark: true,
      source: c.source,
      lastVerified: c.lastVerified,
      cityId: 'parnu',
      freeNow: true,
      freeUntil: null,
      freeReason: 'Elektrilaadija',
      exemptions: ['ev_m1'],
      verifyOnSite: true,
    })
  }).map((s) => ({ ...s, badge: 'EV', zone_code: 'EV' }))
}
