/**
 * One-tap "Täis" community report helper.
 * Wraps /api/reports with a hard 10s timeout.
 *
 * FULL reports require location permission + ≤200 m proximity (client-only).
 * Cooldown is applied on success OR timeout so a late server response + retry
 * cannot count as two separate crowd votes within 5 minutes.
 */

import { apiUrl } from './apiBase'
import { assertNearParkingForFullReport } from './fullReportProximity'
import { installIdHeaders } from './installId'
import {
  canSubmitReport,
  markReportSubmitted,
} from './reportCooldown'

const FETCH_TIMEOUT_MS = 10_000

export async function submitFullReport(
  parkingId: string,
  spot: { lat: number; lng: number },
): Promise<{
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

  const near = await assertNearParkingForFullReport(spot.lat, spot.lng)
  if (!near.ok) {
    return { ok: false, message: near.message, cooldown: false }
  }

  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(apiUrl('/api/reports'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...installIdHeaders(),
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
    if (aborted) {
      // Request may still succeed on the server — lock retries for 5 minutes.
      markReportSubmitted(id)
      return {
        ok: false,
        message: 'Aegus — sama teavitust ei saadeta uuesti 5 minutit',
        cooldown: true,
      }
    }
    return {
      ok: false,
      message: 'Ühendus ebaõnnestus — proovi uuesti',
      cooldown: false,
    }
  } finally {
    window.clearTimeout(timer)
  }
}
