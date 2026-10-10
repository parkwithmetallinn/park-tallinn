/**
 * Poll community-verified parking types (unknown → Tasuta/Kellaga/Tasuline).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchTypeVoteResults,
  TYPE_VOTES_POLL_MS,
  typeVotesById,
  type ProposedParkingType,
  type TypeVoteVerification,
} from '../lib/typeVotes'

export function useTypeVotes() {
  const [results, setResults] = useState<TypeVoteVerification[]>([])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchTypeVoteResults(signal)
      if (signal?.aborted) return
      setResults(next)
    } catch {
      /* keep previous snapshot */
    }
  }, [])

  const applyLocalResults = useCallback((next: TypeVoteVerification[]) => {
    setResults(next)
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
      intervalId = window.setInterval(tick, TYPE_VOTES_POLL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') startPoll()
      else clearPoll()
    }

    startPoll()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearPoll()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const byId = useMemo(() => typeVotesById(results), [results])

  const getVerifiedType = useCallback(
    (parkingId: string | null | undefined): ProposedParkingType | null => {
      if (!parkingId) return null
      return byId.get(parkingId)?.verifiedType ?? null
    },
    [byId],
  )

  return {
    results,
    byId,
    getVerifiedType,
    refresh,
    applyLocalResults,
  }
}
