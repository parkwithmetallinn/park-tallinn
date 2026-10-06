import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { searchAddress, viewboxForQuery, type GeocodeResult } from '../lib/geocode'
import { clampSearchQuery } from '../lib/validation'

const DEBOUNCE_MS = 400
const PENDING_ENTER_TIMEOUT_MS = 4000

type Bias = { lat: number; lng: number }

/**
 * Nominatim search with debounce, resultsQuery staleness guard, and
 * "press Enter before results" pending auto-select support.
 */
export function useSearchGeocode(opts: {
  query: string
  biasLat: number
  biasLng: number
  /** When true on a query change, skip the rebound fetch (after selection). */
  skipNextGeocodeRef: MutableRefObject<boolean>
}) {
  const { query, biasLat, biasLng, skipNextGeocodeRef } = opts
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([])
  /** Query string the current geoResults were fetched for. */
  const [resultsQuery, setResultsQuery] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  /** Trimmed query waiting for results so Enter can auto-select. */
  const [pendingEnterSelect, setPendingEnterSelect] = useState<string | null>(
    null,
  )

  const geoAbort = useRef<AbortController | null>(null)
  const debounceTimer = useRef<number | null>(null)
  const pendingTimeout = useRef<number | null>(null)
  const pendingEnterRef = useRef<string | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current != null) {
      window.clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
  }, [])

  const clearPendingTimeout = useCallback(() => {
    if (pendingTimeout.current != null) {
      window.clearTimeout(pendingTimeout.current)
      pendingTimeout.current = null
    }
  }, [])

  const cancelPendingEnter = useCallback(() => {
    pendingEnterRef.current = null
    setPendingEnterSelect(null)
    clearPendingTimeout()
  }, [clearPendingTimeout])

  const runFetch = useCallback(
    async (q: string, bias: Bias) => {
      geoAbort.current?.abort()
      const ac = new AbortController()
      geoAbort.current = ac
      setGeoLoading(true)
      setGeoError(null)
      try {
        const results = await searchAddress(
          q,
          ac.signal,
          viewboxForQuery(q, bias.lat, bias.lng),
        )
        if (ac.signal.aborted) return
        setGeoResults(results)
        setResultsQuery(q)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setGeoError('Aadressi otsing ebaõnnestus')
        setGeoResults([])
        setResultsQuery(q)
      } finally {
        if (!ac.signal.aborted) setGeoLoading(false)
      }
    },
    [],
  )

  /** Immediate Nominatim fetch (skips debounce). Used when Enter is pressed early. */
  const fetchNow = useCallback(
    (rawQuery: string) => {
      const q = clampSearchQuery(rawQuery)
      if (q.length < 3) return
      clearDebounce()
      void runFetch(q, { lat: biasLat, lng: biasLng })
    },
    [biasLat, biasLng, clearDebounce, runFetch],
  )

  /**
   * Mark that Enter was pressed before results were ready.
   * Starts an immediate fetch and arms a 4s cancel timer.
   */
  const armPendingEnter = useCallback(
    (rawQuery: string) => {
      const q = clampSearchQuery(rawQuery)
      if (q.length < 3) return
      pendingEnterRef.current = q
      setPendingEnterSelect(q)
      clearPendingTimeout()
      pendingTimeout.current = window.setTimeout(() => {
        if (pendingEnterRef.current === q) {
          pendingEnterRef.current = null
          setPendingEnterSelect(null)
        }
      }, PENDING_ENTER_TIMEOUT_MS)
      fetchNow(q)
    },
    [clearPendingTimeout, fetchNow],
  )

  // Debounced fetch on query / bias change
  useEffect(() => {
    if (skipNextGeocodeRef.current) {
      skipNextGeocodeRef.current = false
      clearDebounce()
      geoAbort.current?.abort()
      setGeoResults([])
      setResultsQuery('')
      setGeoError(null)
      setGeoLoading(false)
      pendingEnterRef.current = null
      setPendingEnterSelect(null)
      clearPendingTimeout()
      return
    }

    const q = clampSearchQuery(query)
    if (q.length < 3) {
      clearDebounce()
      geoAbort.current?.abort()
      setGeoResults([])
      setResultsQuery('')
      setGeoError(null)
      setGeoLoading(false)
      return
    }

    setGeoLoading(true)
    setGeoError(null)
    clearDebounce()
    debounceTimer.current = window.setTimeout(() => {
      void runFetch(q, { lat: biasLat, lng: biasLng })
    }, DEBOUNCE_MS)

    return () => {
      clearDebounce()
    }
  }, [
    query,
    biasLat,
    biasLng,
    skipNextGeocodeRef,
    runFetch,
    clearDebounce,
    clearPendingTimeout,
  ])

  // Abort in-flight on unmount
  useEffect(() => {
    return () => {
      clearDebounce()
      clearPendingTimeout()
      geoAbort.current?.abort()
    }
  }, [clearDebounce, clearPendingTimeout])

  const clearGeo = useCallback(() => {
    geoAbort.current?.abort()
    clearDebounce()
    setGeoResults([])
    setResultsQuery('')
    setGeoError(null)
    setGeoLoading(false)
    cancelPendingEnter()
  }, [cancelPendingEnter, clearDebounce])

  return {
    geoResults,
    resultsQuery,
    geoLoading,
    geoError,
    pendingEnterSelect,
    pendingEnterRef,
    cancelPendingEnter,
    armPendingEnter,
    fetchNow,
    clearGeo,
    setGeoResults,
    setGeoError,
  }
}
