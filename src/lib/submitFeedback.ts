/**
 * Client helper — POST /api/feedback (central inbox).
 * Never writes localStorage queues.
 */

import { apiUrl } from './apiBase'

export type FeedbackType = 'NEW_PARKING' | 'WRONG_DATA' | 'ABUSE_REPORT'

export type FeedbackPayload = {
  type: FeedbackType
  parkingId?: string | null
  lat?: number | null
  lng?: number | null
  note?: string
  /** Honeypot — must be empty */
  company_website?: string
}

export type FeedbackResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

const SUCCESS_ET = 'Aitäh! Vaatame teate üle.'
const FAIL_ET = 'Teadet ei õnnestunud saata. Proovi hiljem uuesti.'

export async function submitFeedback(
  payload: FeedbackPayload,
  signal?: AbortSignal,
): Promise<FeedbackResult> {
  try {
    const res = await fetch(apiUrl('/api/feedback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        type: payload.type,
        parkingId: payload.parkingId ?? null,
        lat: payload.lat ?? null,
        lng: payload.lng ?? null,
        note: payload.note ?? '',
        company_website: payload.company_website ?? '',
      }),
      signal,
    })
    let data: { success?: boolean; message?: string } = {}
    try {
      data = (await res.json()) as { success?: boolean; message?: string }
    } catch {
      /* non-JSON */
    }
    if (!res.ok || data.success === false) {
      return {
        ok: false,
        message:
          (typeof data.message === 'string' && data.message.trim()) || FAIL_ET,
      }
    }
    return {
      ok: true,
      message:
        (typeof data.message === 'string' && data.message.trim()) || SUCCESS_ET,
    }
  } catch {
    return { ok: false, message: FAIL_ET }
  }
}

/** Compose a short note (≤200) from propose-new form fields. */
export function composeProposeNote(parts: {
  name?: string
  type?: string
  kind?: string
  limit?: string
  address?: string
  note?: string
}): string {
  const chunks = [
    parts.name?.trim(),
    parts.type?.trim(),
    parts.kind?.trim(),
    parts.limit?.trim(),
    parts.address?.trim(),
    parts.note?.trim(),
  ].filter(Boolean) as string[]
  return chunks.join(' · ').slice(0, 200)
}

export function composeWrongDataNote(parts: {
  reason?: string
  note?: string
}): string {
  const chunks = [parts.reason?.trim(), parts.note?.trim()].filter(
    Boolean,
  ) as string[]
  return chunks.join(' · ').slice(0, 200)
}
