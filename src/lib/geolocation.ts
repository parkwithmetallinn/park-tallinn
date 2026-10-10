/**
 * Live GPS helpers — Capacitor Geolocation on native, navigator elsewhere.
 */

import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { tKey } from '../i18n'

export type GeoPosition = {
  lat: number
  lng: number
  accuracy?: number
}

export type GeoLocateErrorCode =
  | 'unsupported'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'unknown'

export type GeoLocateResult =
  | { ok: true; position: GeoPosition }
  | { ok: false; code: GeoLocateErrorCode; message: string }

export type WatchPositionHandle = {
  clear: () => void
}

/** Options for continuous tracking while moving. */
export const LIVE_GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
}

/** Localized user-facing copy for geolocation failures. */
export function geoErrorMessage(code: GeoLocateErrorCode): string {
  switch (code) {
    case 'unsupported':
      return tKey('geo.unsupported')
    case 'denied':
      return tKey('geo.denied')
    case 'unavailable':
      return tKey('geo.unavailable')
    case 'timeout':
      return tKey('geo.timeout')
    default:
      return tKey('geo.failed')
  }
}

function mapGeoError(err: GeolocationPositionError | unknown): {
  code: GeoLocateErrorCode
  message: string
} {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as GeolocationPositionError).code === 'number'
  ) {
    const e = err as GeolocationPositionError
    if (e.code === e.PERMISSION_DENIED || e.code === 1) {
      return { code: 'denied', message: geoErrorMessage('denied') }
    }
    if (e.code === e.POSITION_UNAVAILABLE || e.code === 2) {
      return { code: 'unavailable', message: geoErrorMessage('unavailable') }
    }
    if (e.code === e.TIMEOUT || e.code === 3) {
      return { code: 'timeout', message: geoErrorMessage('timeout') }
    }
  }
  const msg = err instanceof Error ? err.message : ''
  if (/denied|permission/i.test(msg)) {
    return { code: 'denied', message: geoErrorMessage('denied') }
  }
  if (/timeout/i.test(msg)) {
    return { code: 'timeout', message: geoErrorMessage('timeout') }
  }
  return { code: 'unknown', message: geoErrorMessage('unknown') }
}

function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** Request location permission on Capacitor (no-op / true on web). */
export async function ensureLocationPermission(): Promise<boolean> {
  if (!isNativePlatform()) {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator
  }
  try {
    const current = await Geolocation.checkPermissions()
    if (
      current.location === 'granted' ||
      current.coarseLocation === 'granted'
    ) {
      return true
    }
    const requested = await Geolocation.requestPermissions()
    return (
      requested.location === 'granted' ||
      requested.coarseLocation === 'granted'
    )
  } catch {
    return false
  }
}

/**
 * One-shot high-accuracy position for the locate FAB.
 */
export async function getCurrentPositionOnce(
  options?: PositionOptions,
): Promise<GeoLocateResult> {
  const opts = { ...LIVE_GEO_OPTIONS, ...options }
  try {
    if (isNativePlatform()) {
      const ok = await ensureLocationPermission()
      if (!ok) {
        return {
          ok: false,
          code: 'denied',
          message: geoErrorMessage('denied'),
        }
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: opts.enableHighAccuracy !== false,
        timeout: opts.timeout ?? 10_000,
        maximumAge: opts.maximumAge ?? 0,
      })
      return {
        ok: true,
        position: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        },
      }
    }

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return {
        ok: false,
        code: 'unsupported',
        message: geoErrorMessage('unsupported'),
      }
    }

    return await new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              ok: true,
              position: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              },
            })
          },
          (err) => {
            resolve({ ok: false, ...mapGeoError(err) })
          },
          opts,
        )
      } catch (err) {
        resolve({ ok: false, ...mapGeoError(err) })
      }
    })
  } catch (err) {
    return { ok: false, ...mapGeoError(err) }
  }
}

/**
 * Continuous GPS watch — updates on every fix while the device is moving.
 * Always call `handle.clear()` on unmount.
 */
export async function watchLivePosition(
  onUpdate: (position: GeoPosition) => void,
  onError?: (result: Extract<GeoLocateResult, { ok: false }>) => void,
  options?: PositionOptions,
): Promise<WatchPositionHandle> {
  const opts = { ...LIVE_GEO_OPTIONS, ...options }
  let cleared = false
  let browserWatchId: number | null = null
  let capacitorWatchId: string | null = null

  const clear = () => {
    if (cleared) return
    cleared = true
    if (browserWatchId != null && typeof navigator !== 'undefined') {
      try {
        navigator.geolocation.clearWatch(browserWatchId)
      } catch {
        /* ignore */
      }
      browserWatchId = null
    }
    if (capacitorWatchId != null) {
      const id = capacitorWatchId
      capacitorWatchId = null
      void Geolocation.clearWatch({ id }).catch(() => {
        /* ignore */
      })
    }
  }

  if (isNativePlatform()) {
    const ok = await ensureLocationPermission()
    if (!ok) {
      onError?.({
        ok: false,
        code: 'denied',
        message: geoErrorMessage('denied'),
      })
      return { clear }
    }
    try {
      capacitorWatchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: opts.enableHighAccuracy !== false,
          timeout: opts.timeout ?? 10_000,
          maximumAge: opts.maximumAge ?? 0,
        },
        (pos, err) => {
          if (cleared) return
          if (err || !pos) {
            onError?.({ ok: false, ...mapGeoError(err) })
            return
          }
          onUpdate({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          })
        },
      )
    } catch (err) {
      onError?.({ ok: false, ...mapGeoError(err) })
    }
    return { clear }
  }

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    onError?.({
      ok: false,
      code: 'unsupported',
      message: geoErrorMessage('unsupported'),
    })
    return { clear }
  }

  browserWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (cleared) return
      onUpdate({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
    },
    (err) => {
      if (cleared) return
      onError?.({ ok: false, ...mapGeoError(err) })
    },
    opts,
  )

  return { clear }
}
