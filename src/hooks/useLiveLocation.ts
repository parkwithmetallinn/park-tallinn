/**
 * Continuous GPS tracking + camera follow state for the map blue-dot.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCurrentPositionOnce,
  watchLivePosition,
  type GeoLocateResult,
  type GeoPosition,
  type WatchPositionHandle,
} from '../lib/geolocation'

export function useLiveLocation(initial: [number, number]) {
  const [userLocation, setUserLocation] = useState<[number, number]>(initial)
  const [hasGps, setHasGps] = useState(false)
  const [gpsLocating, setGpsLocating] = useState(false)
  /** When true, map camera eases to each new GPS fix. */
  const [followUser, setFollowUser] = useState(false)
  const watchRef = useRef<WatchPositionHandle | null>(null)
  const followRef = useRef(followUser)
  followRef.current = followUser

  // Start continuous watch on mount; clearWatch on unmount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const handle = await watchLivePosition(
        (pos) => {
          if (cancelled) return
          setUserLocation([pos.lat, pos.lng])
          setHasGps(true)
        },
        () => {
          if (cancelled) return
          // Keep last known fix; only mark missing after hard failures on locate
        },
      )
      if (cancelled) {
        handle.clear()
        return
      }
      watchRef.current = handle
    })()
    return () => {
      cancelled = true
      watchRef.current?.clear()
      watchRef.current = null
    }
  }, [])

  const stopFollow = useCallback(() => {
    setFollowUser(false)
  }, [])

  const startFollow = useCallback(() => {
    setFollowUser(true)
  }, [])

  /**
   * FAB "Jälgi mind" — fresh fix + enable auto-follow + return coords to fly.
   */
  const locateAndFollow = useCallback(async (): Promise<
    | { ok: true; position: GeoPosition }
    | Extract<GeoLocateResult, { ok: false }>
  > => {
    if (gpsLocating) {
      return {
        ok: false,
        code: 'unknown',
        message: 'Asukohta määratakse…',
      }
    }
    setGpsLocating(true)
    try {
      const result = await getCurrentPositionOnce()
      if (!result.ok) {
        setHasGps(false)
        return result
      }
      setUserLocation([result.position.lat, result.position.lng])
      setHasGps(true)
      setFollowUser(true)
      return result
    } finally {
      setGpsLocating(false)
    }
  }, [gpsLocating])

  return {
    userLocation,
    setUserLocation,
    hasGps,
    gpsLocating,
    followUser,
    stopFollow,
    startFollow,
    locateAndFollow,
  }
}
