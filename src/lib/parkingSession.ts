/**
 * Parking session API — n8n webhook backend.
 * POST { carNumber, zone } → { success, message, sessionDetails }
 */

export const PARKING_WEBHOOK_URL =
  import.meta.env.VITE_PARKING_WEBHOOK_URL ??
  'https://mairon8n.app.n8n.cloud/webhook/parkimine'

/** Same-origin proxy path (Vite / Vercel) — used when direct CORS fails. */
const PARKING_WEBHOOK_PROXY = '/api/parkimine'

export type StartParkingSessionRequest = {
  carNumber: string
  zone: string
}

export type ParkingSessionDetails = {
  sessionId?: string
  carNumber?: string
  zone?: string
  startedAt?: string
  [key: string]: unknown
}

export type StartParkingSessionResponse = {
  success: boolean
  message: string
  sessionDetails?: ParkingSessionDetails | null
}

function normalizeResponse(data: unknown): StartParkingSessionResponse {
  if (!data || typeof data !== 'object') {
    return { success: false, message: 'Tundmatu vastus serverilt' }
  }
  const d = data as Record<string, unknown>
  const success = Boolean(d.success)
  const message =
    typeof d.message === 'string' && d.message.trim()
      ? d.message
      : success
        ? 'Parkimissessioon alustatud'
        : 'Sessiooni alustamine ebaõnnestus'
  const sessionDetails =
    d.sessionDetails && typeof d.sessionDetails === 'object'
      ? (d.sessionDetails as ParkingSessionDetails)
      : null
  return { success, message, sessionDetails }
}

async function postSession(
  url: string,
  body: StartParkingSessionRequest,
  signal?: AbortSignal,
): Promise<StartParkingSessionResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
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
    const normalized = normalizeResponse(parsed)
    if (!normalized.success) {
      return {
        success: false,
        message: normalized.message || `Viga ${res.status}`,
        sessionDetails: normalized.sessionDetails,
      }
    }
  }

  return normalizeResponse(
    parsed ?? { success: res.ok, message: res.ok ? 'OK' : `Viga ${res.status}` },
  )
}

/**
 * Start a parking session via the n8n webhook.
 * Tries the public URL first; falls back to same-origin proxy on network/CORS failure.
 */
export async function startParkingSession(
  input: StartParkingSessionRequest,
  signal?: AbortSignal,
): Promise<StartParkingSessionResponse> {
  const carNumber = input.carNumber.trim()
  const zone = input.zone.trim()
  if (!carNumber) {
    return { success: false, message: 'Sisesta auto number' }
  }
  if (!zone) {
    return { success: false, message: 'Tsoon puudub' }
  }

  try {
    return await postSession(PARKING_WEBHOOK_URL, { carNumber, zone }, signal)
  } catch {
    try {
      return await postSession(PARKING_WEBHOOK_PROXY, { carNumber, zone }, signal)
    } catch {
      return {
        success: false,
        message: 'Ühendus ebaõnnestus — kontrolli võrku või n8n webhook’i',
      }
    }
  }
}
