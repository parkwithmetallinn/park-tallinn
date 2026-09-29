/**
 * Parking session API — production n8n webhook.
 *
 * POST https://mairon8n.app.n8n.cloud/webhook/parkimine
 * Body:  { action: "start"|"stop"|"status", carNumber, zone }
 * Resp:  { success, message, sessionDetails: { carNumber, zone, hourlyRate, startTime, status, … } }
 *
 * Every request sends Header Auth:
 *   X-N8N-API-KEY: SecurityMHMJ26%
 *   Content-Type: application/json
 */

export const PARKING_WEBHOOK_URL =
  import.meta.env.VITE_PARKING_WEBHOOK_URL ??
  'https://mairon8n.app.n8n.cloud/webhook/parkimine'

/** Sent on every POST (direct URL and /api/parkimine CORS proxy). */
export const PARKING_WEBHOOK_HEADERS = {
  'X-N8N-API-KEY': 'SecurityMHMJ26%',
  'Content-Type': 'application/json',
} as const

/** Same-origin proxy (Vite / Vercel) when browser CORS blocks the cloud URL. */
const PARKING_WEBHOOK_PROXY = '/api/parkimine'

export type ParkingSessionAction = 'start' | 'stop' | 'status'

export type ParkingSessionRequest = {
  action: ParkingSessionAction
  carNumber: string
  zone: string
}

export type ParkingSessionDetails = {
  sessionId?: string
  carNumber?: string
  zone?: string
  /** Hourly rate in EUR from the backend */
  hourlyRate?: number
  /** ISO start — backend may send startTime or startedAt */
  startTime?: string
  startedAt?: string
  /** ISO end — backend may send endTime or endedAt */
  endTime?: string
  endedAt?: string
  /** e.g. ACTIVE | STOPPED | ENDED */
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
  hourlyRate?: number
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

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(',', '.').replace(/[^\d.-]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s || undefined
}

/** Normalize backend sessionDetails (alias keys → canonical). */
export function normalizeSessionDetails(raw: unknown): ParkingSessionDetails | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>

  const hourlyRate =
    asNumber(d.hourlyRate) ??
    asNumber(d.hourly_rate) ??
    asNumber(d.rate) ??
    asNumber(d.pricePerHour) ??
    asNumber(d.price_per_hour)

  const startTime =
    asString(d.startTime) ?? asString(d.startedAt) ?? asString(d.start_time)
  const endTime =
    asString(d.endTime) ?? asString(d.endedAt) ?? asString(d.end_time)

  return {
    ...d,
    sessionId: asString(d.sessionId) ?? asString(d.session_id) ?? asString(d.id),
    carNumber: asString(d.carNumber) ?? asString(d.car_number) ?? asString(d.plate),
    zone: asString(d.zone) ?? asString(d.zoneCode) ?? asString(d.zone_code),
    hourlyRate,
    startTime,
    startedAt: startTime,
    endTime,
    endedAt: endTime,
    status: asString(d.status),
  }
}

function unwrapPayload(data: unknown): Record<string, unknown> | null {
  if (!data) return null
  // Some n8n workflows return a one-element array
  if (Array.isArray(data)) {
    const first = data[0]
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : null
  }
  if (typeof data === 'object') return data as Record<string, unknown>
  return null
}

function normalizeResponse(
  data: unknown,
  action: ParkingSessionAction,
): ParkingSessionResponse {
  const d = unwrapPayload(data)
  if (!d) {
    return { success: false, message: 'Tundmatu vastus serverilt' }
  }

  const success = Boolean(d.success)
  const message =
    typeof d.message === 'string' && d.message.trim()
      ? d.message
      : defaultMessage(action, success)

  return {
    success,
    message,
    sessionDetails: normalizeSessionDetails(d.sessionDetails ?? d.session_details),
  }
}

function buildPayload(body: ParkingSessionRequest): {
  action: ParkingSessionAction
  carNumber: string
  zone: string
} {
  return {
    action: body.action,
    carNumber: body.carNumber.trim().toUpperCase(),
    zone: body.zone.trim(),
  }
}

async function postSession(
  url: string,
  body: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...PARKING_WEBHOOK_HEADERS },
    body: JSON.stringify(buildPayload(body)),
    signal,
  })

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { success: res.ok, message: text.slice(0, 240) }
    }
  }

  if (/authorization data is wrong/i.test(text)) {
    return {
      success: false,
      message: 'Autentimine ebaõnnestus — kontrolli X-N8N-API-KEY päist',
    }
  }

  if (!res.ok) {
    const normalized = normalizeResponse(
      parsed ?? { success: false, message: text.slice(0, 240) },
      body.action,
    )
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

  if (
    parsed == null ||
    (typeof parsed === 'object' &&
      parsed !== null &&
      !('success' in (parsed as object)) &&
      !('message' in (parsed as object)) &&
      !('sessionDetails' in (parsed as object)))
  ) {
    // Bare success HTTP with empty / non-JSON body
    if (res.ok && (!text || !text.trim())) {
      return { success: true, message: defaultMessage(body.action, true) }
    }
    return {
      success: false,
      message: text?.trim() ? text.slice(0, 240) : 'Tühi vastus serverilt',
    }
  }

  return normalizeResponse(parsed, body.action)
}

function validateRequest(input: {
  action: ParkingSessionAction
  carNumber?: string
  zone?: string
}): string | null {
  const carNumber = input.carNumber?.trim() ?? ''
  const zone = input.zone?.trim() ?? ''
  // Production n8n expects carNumber + zone for start, stop, and status
  if (!carNumber) return 'Sisesta auto number'
  if (!zone) return 'Tsoon puudub'
  return null
}

/**
 * Send a parking session action via the production n8n webhook.
 * Tries the public URL first; falls back to same-origin proxy on network/CORS failure.
 */
export async function sendParkingSession(
  input: {
    action: ParkingSessionAction
    carNumber?: string
    zone?: string
  },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const validationError = validateRequest(input)
  if (validationError) {
    return { success: false, message: validationError }
  }

  const body: ParkingSessionRequest = {
    action: input.action,
    carNumber: input.carNumber!.trim(),
    zone: input.zone!.trim(),
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
  input: { carNumber: string; zone: string },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ ...input, action: 'status' }, signal)
}

export function sessionStartIso(details?: ParkingSessionDetails | null): string | undefined {
  if (!details) return undefined
  return details.startTime ?? details.startedAt
}

export function sessionEndIso(details?: ParkingSessionDetails | null): string | undefined {
  if (!details) return undefined
  return details.endTime ?? details.endedAt
}

export function sessionHourlyRate(
  details?: ParkingSessionDetails | null,
): number | undefined {
  if (!details) return undefined
  return asNumber(details.hourlyRate)
}

export function formatHourlyRate(rate?: number): string | undefined {
  if (rate == null || !Number.isFinite(rate)) return undefined
  return `${rate.toFixed(2)} €/h`
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
  if (
    status === 'STOPPED' ||
    status === 'ENDED' ||
    status === 'INACTIVE' ||
    status === 'COMPLETED' ||
    status === 'FINISHED'
  ) {
    return false
  }
  if (
    status === 'ACTIVE' ||
    status === 'RUNNING' ||
    status === 'STARTED' ||
    status === 'IN_PROGRESS'
  ) {
    return true
  }
  // Fallback: has plate + zone and no end time → treat as active
  return Boolean(
    (details.carNumber || details.zone) && !details.endTime && !details.endedAt,
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
    hourlyRate: sessionHourlyRate(details) ?? fallback?.hourlyRate,
  }
}

/** Compact detail line for toasts / notices from a backend response. */
export function formatSessionFeedbackDetail(
  result: ParkingSessionResponse,
  extras: Array<string | undefined | null> = [],
): string {
  const details = result.sessionDetails
  const parts = [
    result.message,
    ...extras,
    details?.carNumber && details?.zone
      ? `${details.carNumber} · ${details.zone}`
      : null,
    formatHourlyRate(sessionHourlyRate(details)),
    details?.status ? String(details.status) : null,
    formatSessionInstant(sessionStartIso(details))
      ? `alates ${formatSessionInstant(sessionStartIso(details))}`
      : null,
  ]
  // Dedupe while preserving order
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (!p) continue
    const key = p.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out.join(' · ')
}
