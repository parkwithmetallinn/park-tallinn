/**
 * Parking session API — n8n webhook backend.
 * POST { action, carNumber, zone } → { success, message, sessionDetails }
 */

export const PARKING_WEBHOOK_URL =
  import.meta.env.VITE_PARKING_WEBHOOK_URL ??
  'https://mairon8n.app.n8n.cloud/webhook/parkimine'

/** Same-origin proxy path (Vite / Vercel) — used when direct CORS fails. */
const PARKING_WEBHOOK_PROXY = '/api/parkimine'

export type ParkingSessionAction = 'start' | 'stop'

export type ParkingSessionRequest = {
  action: ParkingSessionAction
  carNumber: string
  zone: string
}

export type ParkingSessionDetails = {
  sessionId?: string
  carNumber?: string
  zone?: string
  /** ISO start — backend may send startedAt or startTime */
  startedAt?: string
  startTime?: string
  /** ISO end — backend may send endedAt or endTime */
  endedAt?: string
  endTime?: string
  status?: string
  [key: string]: unknown
}

export type ParkingSessionResponse = {
  success: boolean
  message: string
  sessionDetails?: ParkingSessionDetails | null
}

/** Local snapshot of an ACTIVE backend session (for stop UI). */
export type ActiveParkingSession = {
  carNumber: string
  zone: string
  spotName?: string
  startedAt?: string
  status: string
}

function defaultMessage(action: ParkingSessionAction, success: boolean): string {
  if (action === 'stop') {
    return success ? 'Parkimissessioon lõpetatud' : 'Sessiooni lõpetamine ebaõnnestus'
  }
  return success ? 'Parkimissessioon alustatud' : 'Sessiooni alustamine ebaõnnestus'
}

function normalizeResponse(
  data: unknown,
  action: ParkingSessionAction,
): ParkingSessionResponse {
  if (!data || typeof data !== 'object') {
    return { success: false, message: 'Tundmatu vastus serverilt' }
  }
  const d = data as Record<string, unknown>
  const success = Boolean(d.success)
  const message =
    typeof d.message === 'string' && d.message.trim()
      ? d.message
      : defaultMessage(action, success)
  const sessionDetails =
    d.sessionDetails && typeof d.sessionDetails === 'object'
      ? (d.sessionDetails as ParkingSessionDetails)
      : null
  return { success, message, sessionDetails }
}

async function postSession(
  url: string,
  body: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: body.action,
      carNumber: body.carNumber.trim().toUpperCase(),
      zone: body.zone.trim(),
    }),
    signal,
  })

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { success: res.ok, message: text.slice(0, 200) }
    }
  }

  if (!res.ok) {
    const normalized = normalizeResponse(parsed, body.action)
    if (!normalized.success) {
      return {
        success: false,
        message: normalized.message || `Viga ${res.status}`,
        sessionDetails: normalized.sessionDetails,
      }
    }
  }

  return normalizeResponse(
    parsed ?? {
      success: res.ok,
      message: res.ok ? 'OK' : `Viga ${res.status}`,
    },
    body.action,
  )
}

/**
 * Start or stop a parking session via the n8n webhook.
 * Tries the public URL first; falls back to same-origin proxy on network/CORS failure.
 */
export async function sendParkingSession(
  input: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const carNumber = input.carNumber.trim()
  const zone = input.zone.trim()
  if (!carNumber) {
    return { success: false, message: 'Sisesta auto number' }
  }
  if (!zone) {
    return { success: false, message: 'Tsoon puudub' }
  }

  const body: ParkingSessionRequest = {
    action: input.action,
    carNumber,
    zone,
  }

  try {
    return await postSession(PARKING_WEBHOOK_URL, body, signal)
  } catch {
    try {
      return await postSession(PARKING_WEBHOOK_PROXY, body, signal)
    } catch {
      return {
        success: false,
        message: 'Ühendus ebaõnnestus — kontrolli võrku või n8n webhook’i',
      }
    }
  }
}

export function startParkingSession(
  input: Omit<ParkingSessionRequest, 'action'>,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ ...input, action: 'start' }, signal)
}

export function stopParkingSession(
  input: Omit<ParkingSessionRequest, 'action'>,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ ...input, action: 'stop' }, signal)
}

export function sessionStartIso(details?: ParkingSessionDetails | null): string | undefined {
  if (!details) return undefined
  const v = details.startedAt ?? details.startTime
  return v != null ? String(v) : undefined
}

export function sessionEndIso(details?: ParkingSessionDetails | null): string | undefined {
  if (!details) return undefined
  const v = details.endedAt ?? details.endTime
  return v != null ? String(v) : undefined
}

export function formatSessionInstant(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('et-EE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
