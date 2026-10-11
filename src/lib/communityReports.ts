/**
 * Live community reports — GET /api/reports.
 * Response: [{ parkingId, isFull, lastReportedMinutesAgo }]
 */

import { apiUrl } from './apiBase'
import { assertNearParkingForFullReport } from './fullReportProximity'
import { installIdHeaders } from './installId'
import {
  canSubmitReport,
  markReportSubmitted,
} from './reportCooldown'

export type CommunityReport = {
  parkingId: string
  /** Alias for parkingId (legacy callers). */
  spotId: string
  isFull: boolean
  lastReportedMinutesAgo: number
}

export const COMMUNITY_REPORTS_POLL_MS = 25_000
const FETCH_TIMEOUT_MS = 10_000

export function parseCommunityReports(data: unknown): CommunityReport[] {
  const raw = Array.isArray(data)
    ? data
    : data &&
        typeof data === 'object' &&
        Array.isArray((data as { reports?: unknown }).reports)
      ? ((data as { reports: unknown[] }).reports)
      : null
  if (!raw) return []

  const out: CommunityReport[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const parkingId = String(
      row.parkingId ?? row.spotId ?? row.id ?? '',
    ).trim()
    if (!parkingId) continue
    const isFull =
      row.isFull === true || row.isFull === 'true' || row.isFull === 1
    const minsRaw = row.lastReportedMinutesAgo
    const lastReportedMinutesAgo =
      typeof minsRaw === 'number' && Number.isFinite(minsRaw)
        ? Math.max(0, Math.round(minsRaw))
        : 0
    out.push({
      parkingId,
      spotId: parkingId,
      isFull: Boolean(isFull),
      lastReportedMinutesAgo,
    })
  }
  return out
}

/**
 * Fetch community reports.
 * Throws on network/HTTP failure so callers can keep the previous snapshot.
 */
export async function fetchCommunityReports(
  signal?: AbortSignal,
): Promise<CommunityReport[]> {
  const res = await fetch(apiUrl('/api/reports'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`reports HTTP ${res.status}`)
  }
  const data: unknown = await res.json()
  return parseCommunityReports(data)
}

/** Publish a community full/free mark (best-effort, 10s timeout + 5-min cooldown). */
export async function postCommunityFullReport(input: {
  spotId: string
  lat?: number
  lng?: number
  isFull?: boolean
}): Promise<CommunityReport[]> {
  const id = String(input.spotId || '').trim()
  if (!id) return []
  if (!canSubmitReport(id)) return []

  const statusType = input.isFull === false ? 'FREE' : 'FULL'
  if (statusType === 'FULL') {
    if (
      typeof input.lat !== 'number' ||
      typeof input.lng !== 'number' ||
      !Number.isFinite(input.lat) ||
      !Number.isFinite(input.lng)
    ) {
      return []
    }
    const near = await assertNearParkingForFullReport(input.lat, input.lng)
    if (!near.ok) return []
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
        statusType,
        comment: '',
      }),
      signal: ac.signal,
    })
    if (!res.ok) return []
    markReportSubmitted(id)
    const data: unknown = await res.json()
    return parseCommunityReports(data)
  } catch (err) {
    const aborted =
      (err as Error)?.name === 'AbortError' || ac.signal.aborted
    // Late server success + retry would double-count — lock for 5 minutes.
    if (aborted) markReportSubmitted(id)
    return []
  } finally {
    window.clearTimeout(timer)
  }
}

export function communityReportIds(reports: CommunityReport[]): Set<string> {
  return new Set(reports.filter((r) => r.isFull).map((r) => r.parkingId))
}

export function communityFreeIds(reports: CommunityReport[]): Set<string> {
  return new Set(reports.filter((r) => !r.isFull).map((r) => r.parkingId))
}

export function formatCommunityReportLabel(
  report: CommunityReport | null | undefined,
): string {
  if (!report) return 'Kogukonna raport: Teadmata'
  const status = report.isFull ? 'Täis' : 'Vabu kohti'
  const mins = report.lastReportedMinutesAgo
  const when =
    mins <= 0 ? 'just nüüd' : `${mins} min tagasi`
  return `Kogukonna raport: ${status} (${when})`
}
