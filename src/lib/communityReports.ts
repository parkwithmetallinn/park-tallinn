/**
 * Live community reports (isFull) — poll GET /api/reports every 30s.
 */

import { apiUrl } from './apiBase'

export type CommunityReport = {
  spotId: string
  isFull: boolean
  lat?: number
  lng?: number
  until?: number
}

const POLL_MS = 30_000

function parseReports(data: unknown): CommunityReport[] {
  if (!data || typeof data !== 'object') return []
  const raw = (data as { reports?: unknown }).reports
  if (!Array.isArray(raw)) return []
  const out: CommunityReport[] = []
  const now = Date.now()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const spotId = String(row.spotId ?? row.id ?? '').trim()
    if (!spotId) continue
    const isFull = row.isFull === true || row.isFull === 'true' || row.isFull === 1
    if (!isFull) continue
    const until =
      typeof row.until === 'number' && Number.isFinite(row.until)
        ? row.until
        : undefined
    if (until != null && until <= now) continue
    const lat =
      typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : undefined
    const lng =
      typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : undefined
    out.push({ spotId, isFull: true, lat, lng, until })
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
        spotId: input.spotId,
        isFull: input.isFull !== false,
        lat: input.lat,
        lng: input.lng,
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
