/**
 * One-tap "Täis" community report helper.
 * Wraps /api/reports with a hard 10s timeout.
 */

import { apiUrl } from './apiBase'
import {
  canSubmitReport,
  markReportSubmitted,
} from './reportCooldown'

const FETCH_TIMEOUT_MS = 10_000

export async function submitFullReport(parkingId: string): Promise<{
  ok: boolean
  message: string
  cooldown: boolean
}> {
  const id = parkingId.trim()
  if (!id) {
    return { ok: false, message: 'Vigane parkla', cooldown: false }
  }
  if (!canSubmitReport(id)) {
    return {
      ok: false,
      message: 'Sama parkla jaoks oota 5 minutit',
      cooldown: true,
    }
  }

  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(apiUrl('/api/reports'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parkingId: id,
        statusType: 'FULL',
        comment: '',
      }),
      signal: ac.signal,
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      message?: string
    } | null
    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        message: data?.message || 'Teavituse saatmine ebaõnnestus',
        cooldown: false,
      }
    }
    markReportSubmitted(id)
    return { ok: true, message: 'Raport saadetud', cooldown: false }
  } catch (err) {
    const aborted =
      (err as Error)?.name === 'AbortError' || ac.signal.aborted
    return {
      ok: false,
      message: aborted
        ? 'Aegus — proovi uuesti'
        : 'Ühendus ebaõnnestus — proovi uuesti',
      cooldown: false,
    }
  } finally {
    window.clearTimeout(timer)
  }
}
