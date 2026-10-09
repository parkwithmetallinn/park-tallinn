/**
 * Browser geolocation helpers for "Minu asukoht".
 */

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

/** Estonian user-facing copy for geolocation failures. */
export function geoErrorMessage(code: GeoLocateErrorCode): string {
  switch (code) {
    case 'unsupported':
      return 'Sinu brauser ei toeta asukoha määramist.'
    case 'denied':
      return 'Asukoha luba on keelatud. Luba GPS brauseri seadetes.'
    case 'unavailable':
      return 'Asukohta ei õnnestunud määrata. Proovi uuesti.'
    case 'timeout':
      return 'Asukoha päring aegus. Proovi uuesti.'
    default:
      return 'Asukoha määramine ebaõnnestus.'
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
    if (e.code === e.PERMISSION_DENIED) {
      return { code: 'denied', message: geoErrorMessage('denied') }
    }
    if (e.code === e.POSITION_UNAVAILABLE) {
      return { code: 'unavailable', message: geoErrorMessage('unavailable') }
    }
    if (e.code === e.TIMEOUT) {
      return { code: 'timeout', message: geoErrorMessage('timeout') }
    }
  }
  return { code: 'unknown', message: geoErrorMessage('unknown') }
}

/**
 * One-shot high-accuracy position for the locate FAB.
 * Prefer this over watchPosition when the user explicitly taps "Minu asukoht".
 */
export function getCurrentPositionOnce(
  options?: PositionOptions,
): Promise<GeoLocateResult> {
  try {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return Promise.resolve({
        ok: false,
        code: 'unsupported',
        message: geoErrorMessage('unsupported'),
      })
    }

    return new Promise((resolve) => {
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
            const mapped = mapGeoError(err)
            resolve({ ok: false, ...mapped })
          },
          {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0,
            ...options,
          },
        )
      } catch (err) {
        const mapped = mapGeoError(err)
        resolve({ ok: false, ...mapped })
      }
    })
  } catch (err) {
    const mapped = mapGeoError(err)
    return Promise.resolve({ ok: false, ...mapped })
  }
}
