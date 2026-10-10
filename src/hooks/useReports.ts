/**
 * Near-real-time community reports via GET /api/reports.
 * Polls every 25s while the document is visible; pauses in the background.
 * On fetch errors, keeps the previous snapshot (no crash / no wipe).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  COMMUNITY_REPORTS_POLL_MS,
  communityFreeIds,
  communityReportIds,
  fetchCommunityReports,
  type CommunityReport,
} from '../lib/communityReports'

export function useReports() {
  const [reports, setReports] = useState<CommunityReport[]>([])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchCommunityReports(signal)
      if (signal?.aborted) return
      setReports(next)
    } catch {
      // Keep previous state on network / HTTP failure
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null
    let ac: AbortController | null = null

    const clearPoll = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
      ac?.abort()
      ac = null
    }

    const tick = () => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') return
      ac?.abort()
      ac = new AbortController()
      void refresh(ac.signal)
    }

    const startPoll = () => {
      clearPoll()
      if (document.visibilityState !== 'visible') return
      tick()
      intervalId = window.setInterval(tick, COMMUNITY_REPORTS_POLL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPoll()
      } else {
        clearPoll()
      }
    }

    startPoll()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearPoll()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const reportsById = useMemo(() => {
    const map = new Map<string, CommunityReport>()
    for (const r of reports) map.set(r.parkingId, r)
    return map
  }, [reports])

  const fullSpotIds = useMemo(() => communityReportIds(reports), [reports])
  const freeSpotIds = useMemo(() => communityFreeIds(reports), [reports])

  const getReport = useCallback(
    (parkingId: string | null | undefined): CommunityReport | undefined => {
      if (!parkingId) return undefined
      return reportsById.get(parkingId)
    },
    [reportsById],
  )

  return {
    reports,
    reportsById,
    fullSpotIds,
    freeSpotIds,
    getReport,
    refresh,
  }
}
