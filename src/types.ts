/**
 * Industry-grade parking feature schema for Estonia.
 * GeoJSON properties mirror what a future API / Maa-amet pipeline would emit.
 */

/** Physical geometry / use-case of the feature */
export type ParkingFeatureType =
  | 'off-street-lot'
  | 'on-street-line'
  | 'ev-charger'
  | 'inva'
  | 'loading'
  | 'park-ride'
  | 'municipal-zone'

/** Who operates / bills the spot */
export type ParkingOperator =
  | 'Tallinna Linn'
  | 'Pärnu Linn'
  | 'AS Ühisteenused'
  | 'EuroPark'
  | 'Snabb'
  | 'Citypark'
  | 'Parkit'
  | 'Enefit Volt'
  | 'Eleport'
  | 'Neste'
  | 'Tesla'
  | 'Ignitis'
  | 'Unknown'

/** MapLibre layer grouping (filter key) */
export type ParkingLayerKey =
  | 'municipal'
  | 'europark'
  | 'snabb'
  | 'citypark'
  | 'uhisteenused'
  | 'parkit'
  | 'free_street'
  | 'timed'
  | 'ev'
  | 'inva'
  | 'loading'
  | 'park_ride'

/** Precise lot structure from estonia_parking_master.geojson */
export type ParkingStructureType = 'surface' | 'underground' | 'multi_storey'

export interface ParkingSpot {
  id: string
  name: string
  /** GeoJSON / product type */
  featureType: ParkingFeatureType
  operator: ParkingOperator
  /** Layer key for MapLibre filters */
  layer: ParkingLayerKey
  /** Operator zone id, e.g. EP12, KESKLINN, SN1 */
  zone_code: string
  /** Free minutes before paid (0, 15, 30, 60…) */
  free_minutes: number
  /** Hourly rate in EUR; 0 = free */
  price_per_hour: number
  badge: string
  timeLimit: string
  /** Centroid for bbox index / popup anchor */
  lat: number
  lng: number
  address: string
  desc: string
  hours?: string
  custom?: boolean
  landmark?: boolean
  /**
   * On-street curb geometry as [lat, lng][] polyline.
   * When set (or featureType is on-street-line), rendered as a colored street line — not a pin.
   */
  line?: [number, number][]
  /**
   * Off-street lot footprint as [lat, lng][] ring (closed preferred).
   * When set (or off-street operator lot), rendered as a filled polygon.
   */
  polygon?: [number, number][]
  /**
   * Physical structure from precise GeoJSON polygons.
   * surface | underground | multi_storey
   */
  structureType?: ParkingStructureType
  /** Storeys for multi-storey lots (badge height). */
  floors?: number
  /** @deprecated use featureType / layer — kept for gradual migration */
  type?: 'free' | 'timed' | 'pr' | 'paid'
  kind?: 'lot' | 'street'
  provider?: ParkingLayerKey
  /** Data provenance (OSM, city schedule, seed, …) */
  source?: string
  /** ISO date YYYY-MM-DD when the record was last checked */
  lastVerified?: string
  /** Owning city layer */
  cityId?: 'tallinn' | 'parnu'
  /** freeRules evaluation snapshot */
  freeNow?: boolean
  freeUntil?: string | null
  freeReason?: string
  /** Exemption tags (e.g. ev_m1 for fully electric M1) */
  exemptions?: Array<'ev_m1' | 'motorcycle' | 'disabled'>
  /** Show “Kontrolli kohapealt silti” in the detail sheet */
  verifyOnSite?: boolean
  /** Pärnu paid zone id when inside kesklinn / rand */
  parnuZone?: 'kesklinn' | 'rand' | null
}

export interface PaidZone {
  name: string
  color: string
  coords: [number, number][]
  note: string
  zone_code?: string
  free_minutes?: number
  price_per_hour?: number
  operator?: ParkingOperator
}

export interface DistrictZone {
  id: string
  name: string
  color: string
  kind: 'free' | 'mixed' | 'paid'
  summary: string
  /** Outer ring as [lat, lng][] for point-in-polygon helpers */
  coords: [number, number][]
  /** Municipal district vs paid/core sub-zone overlay */
  layerRole?: 'district' | 'subzone'
  /** Lower draws/labels first; sub-zones use smaller ranks so they win collisions */
  labelRank?: number
  /** MapLibre fill-sort-key — sub-zones paint above districts */
  fillSort?: number
  /** Precomputed visual label anchor (lng / lat) */
  labelLng?: number
  labelLat?: number
  /** Precise Polygon / MultiPolygon in [lng, lat] GeoJSON order */
  geometry?: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

/**
 * Top filter chips:
 * - free_street = verified free
 * - timed = disc / clock
 * - paid = all paid operators + paid municipal
 * - other = grey / private / unclassified
 */
export type FilterId = 'all' | 'free_street' | 'timed' | 'paid' | 'other'

/** Legacy UI type labels (report form / older filters) */
export type SpotType = NonNullable<ParkingSpot['type']>

/** @deprecated alias — use ParkingLayerKey */
export type ParkingProvider = ParkingLayerKey

/** Seed without required layer fields filled by normalizeSpot() */
export type ParkingSpotSeed = Omit<
  ParkingSpot,
  'layer' | 'operator' | 'featureType' | 'zone_code' | 'free_minutes' | 'price_per_hour'
> &
  Partial<
    Pick<
      ParkingSpot,
      | 'layer'
      | 'operator'
      | 'featureType'
      | 'zone_code'
      | 'free_minutes'
      | 'price_per_hour'
      | 'provider'
      | 'type'
      | 'kind'
      | 'line'
      | 'polygon'
      | 'structureType'
      | 'floors'
    >
  >
