import { districtsAsZones } from '../lib/districtsGeoJSON'
import type { DistrictZone } from '../types'

/**
 * Tallinn linnaosad derived from public/data/districts.geojson
 * (Tallinn GIS Linnaosad, EPSG:4326).
 */
export const DISTRICT_ZONES: DistrictZone[] = districtsAsZones()
