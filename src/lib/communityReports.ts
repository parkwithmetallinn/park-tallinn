/**
 * Live community reports — poll GET /api/reports every 30s.
 * GET returns a bare array:
 *   [{ parkingId, isFull, lastReportedMinutesAgo }]
 */

import { apiUrl } from './apiBase'

export type CommunityReport = {
  spotId: string
  parkingId?: string
  isFull: boolean
  lastReportedMinutesAgo?: number
  lat?: number
  lng?: number
  until?: number
}

const POLL_MS = 30_000

function parseReports(data: unknown): CommunityReport[] {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { reports?: unknown }).reports)
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
    if (!isFull) continue
    const lastReportedMinutesAgo =
      typeof row.lastReportedMinutesAgo === 'number' &&
      Number.isFinite(row.lastReportedMinutesAgo)
        ? Math.max(0, Math.round(row.lastReportedMinutesAgo))
        : undefined
    out.push({
      spotId: parkingId,
      parkingId,
      isFull: true,
      lastReportedMinutesAgo,
    })
  }
  return out
}

export async function fetchCommunityReports(
  signal?: AbortSignal,
): Promise<CommunityReport[]> {
  try {
    const res = await fetch(apiUrl('/api/reports'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!res.ok) return []
    const data: unknown = await res.json()
    return parseReports(data)
  } catch {
    return []
  }
}

/** Publish a community isFull mark (best-effort — local TTL still applies). */
export async function postCommunityFullReport(input: {
  spotId: string
  lat?: number
  lng?: number
  isFull?: boolean
}): Promise<CommunityReport[]> {
  try {
    const res = await fetch(apiUrl('/api/reports'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parkingId: input.spotId,
        statusType: input.isFull === false ? 'FREE' : 'FULL',
        comment: '',
      }),
    })
    if (!res.ok) return []
    const data: unknown = await res.json()
    return parseReports(data)
  } catch {
    return []
  }
}

export function communityReportIds(reports: CommunityReport[]): Set<string> {
  return new Set(reports.filter((r) => r.isFull).map((r) => r.spotId))
}

export const COMMUNITY_REPORTS_POLL_MS = POLL_MS
