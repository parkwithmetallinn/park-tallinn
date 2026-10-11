/**
 * Client-only proximity gate for FULL community reports.
 * Coordinates are never sent to the server.
 */

import { distanceMeters } from './geo'
import { getCurrentPositionOnce } from './geolocation'

export const FULL_REPORT_MAX_DISTANCE_M = 200

export const FULL_REPORT_PROXIMITY_ERROR =
  'Täis-teate saatmiseks pead olema parkla lähedal ja asukoht peab olema lubatud'

/**
 * True when location permission works and the device is within 200 m of the lot.
 * Failures (denied, unavailable, too far) all surface the same neutral copy.
 */
export async function assertNearParkingForFullReport(
  spotLat: number,
  spotLng: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (
    !Number.isFinite(spotLat) ||
    !Number.isFinite(spotLng) ||
    Math.abs(spotLat) > 90 ||
    Math.abs(spotLng) > 180
  ) {
    return { ok: false, message: FULL_REPORT_PROXIMITY_ERROR }
  }

  const geo = await getCurrentPositionOnce({
    enableHighAccuracy: true,
    timeout: 10_000,
    maximumAge: 0,
  })
  if (!geo.ok) {
    return { ok: false, message: FULL_REPORT_PROXIMITY_ERROR }
  }

  const dist = distanceMeters(
    geo.position.lat,
    geo.position.lng,
    spotLat,
    spotLng,
  )
  if (!Number.isFinite(dist) || dist > FULL_REPORT_MAX_DISTANCE_M) {
    return { ok: false, message: FULL_REPORT_PROXIMITY_ERROR }
  }
  return { ok: true }
}
