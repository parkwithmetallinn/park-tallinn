/**
 * Parking session API — n8n webhook backend.
 * POST { action, carNumber?, zone? } → { success, message, sessionDetails }
 *
 * Actions:
 * - start  — requires carNumber + zone
 * - stop   — requires carNumber + zone
 * - status — checks active parking (carNumber recommended; zone optional)
 */

export const PARKING_WEBHOOK_URL =
  import.meta.env.VITE_PARKING_WEBHOOK_URL ??
  'https://mairon8n.app.n8n.cloud/webhook/parkimine'

/**
 * n8n Header Auth — name must match the credential type exactly.
 * Sent on every POST to the parking webhook (direct URL and /api/parkimine proxy).
 */
export const PARKING_WEBHOOK_HEADERS = {
  'X-N8N-API-KEY': 'SecurityMHMJ26%',
  'Content-Type': 'application/json',
} as const

/** Same-origin proxy path (Vite / Vercel) — used when direct CORS fails. */
const PARKING_WEBHOOK_PROXY = '/api/parkimine'

export type ParkingSessionAction = 'start' | 'stop' | 'status'

export type ParkingSessionRequest = {
  action: ParkingSessionAction
  carNumber?: string
  zone?: string
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

/** Local snapshot of an ACTIVE backend session (for stop / status UI). */
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
  if (action === 'status') {
    return success ? 'Staatus kontrollitud' : 'Staatuse päring ebaõnnestus'
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

function buildPayload(body: ParkingSessionRequest): Record<string, string> {
  const payload: Record<string, string> = { action: body.action }
  const plate = body.carNumber?.trim()
  const zone = body.zone?.trim()
  if (plate) payload.carNumber = plate.toUpperCase()
  if (zone) payload.zone = zone
  return payload
}

async function postSession(
  url: string,
  body: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...PARKING_WEBHOOK_HEADERS,
    },
    body: JSON.stringify(buildPayload(body)),
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
    const msg =
      normalized.message === 'Error in workflow'
        ? 'n8n töövoog ebaõnnestus (serveri viga) — kontrolli webhook’i'
        : normalized.message || `Viga ${res.status}`
    return {
      success: false,
      message: msg,
      sessionDetails: normalized.sessionDetails,
    }
  }

  if (parsed == null || (typeof parsed === 'object' && parsed !== null && !('success' in (parsed as object)) && !('message' in (parsed as object)))) {
    return {
      success: false,
      message: 'Tühi vastus serverilt',
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

function validateRequest(input: ParkingSessionRequest): string | null {
  const carNumber = input.carNumber?.trim() ?? ''
  const zone = input.zone?.trim() ?? ''

  if (input.action === 'status') {
    // Status may be called with plate only; empty body is allowed by backend
    // but the UI always sends at least carNumber when available.
    return null
  }

  if (!carNumber) return 'Sisesta auto number'
  if (!zone) return 'Tsoon puudub'
  return null
}

/**
 * Send a parking session action via the n8n webhook.
 * Tries the public URL first; falls back to same-origin proxy on network/CORS failure.
 */
export async function sendParkingSession(
  input: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const validationError = validateRequest(input)
  if (validationError) {
    return { success: false, message: validationError }
  }

  const body: ParkingSessionRequest = {
    action: input.action,
    carNumber: input.carNumber?.trim() || undefined,
    zone: input.zone?.trim() || undefined,
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
  input: { carNumber: string; zone: string },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ ...input, action: 'start' }, signal)
}

export function stopParkingSession(
  input: { carNumber: string; zone: string },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ ...input, action: 'stop' }, signal)
}

export function checkParkingStatus(
  input: { carNumber?: string; zone?: string } = {},
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ ...input, action: 'status' }, signal)
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

/** True when backend sessionDetails look like an active parking session. */
export function isActiveSessionStatus(
  details?: ParkingSessionDetails | null,
): boolean {
  if (!details) return false
  const status = String(details.status ?? '').toUpperCase()
  if (status === 'STOPPED' || status === 'ENDED' || status === 'INACTIVE') {
    return false
  }
  if (status === 'ACTIVE' || status === 'RUNNING' || status === 'STARTED') {
    return true
  }
  // Fallback: has plate + zone and no end time → treat as active
  return Boolean(
    (details.carNumber || details.zone) &&
      !details.endTime &&
      !details.endedAt,
  )
}

export function activeSessionFromDetails(
  details: ParkingSessionDetails,
  fallback?: Partial<ActiveParkingSession>,
): ActiveParkingSession | null {
  const carNumber = String(details.carNumber ?? fallback?.carNumber ?? '').trim()
  const zone = String(details.zone ?? fallback?.zone ?? '').trim()
  if (!carNumber || !zone) return null
  return {
    carNumber: carNumber.toUpperCase(),
    zone,
    spotName: fallback?.spotName,
    startedAt: sessionStartIso(details) ?? fallback?.startedAt,
    status: String(details.status ?? 'ACTIVE'),
  }
}
