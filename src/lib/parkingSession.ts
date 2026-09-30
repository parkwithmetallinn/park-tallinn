/**
 * Parking session API — n8n webhook.
 *
 * Credentials come from Vite env (see `.env.example`):
 *   VITE_N8N_WEBHOOK_URL
 *   VITE_N8N_API_KEY
 *
 * Body:  { action: "start"|"stop"|"status"|"extend", carNumber?, zone?, minutes? }
 * Prefers same-origin `/api/parkimine` (server also reads the same env vars).
 */

/** Direct cloud URL — last-resort fallback when the proxy is unavailable. */
export const PARKING_WEBHOOK_URL =
  import.meta.env.VITE_N8N_WEBHOOK_URL ||
  import.meta.env.VITE_PARKING_WEBHOOK_URL ||
  ''

/** Header Auth value from env — never hardcode secrets in source. */
export const PARKING_WEBHOOK_API_KEY = import.meta.env.VITE_N8N_API_KEY || ''

/**
 * Headers sent on every client POST (start / stop / status / extend).
 * The Vite/Vercel proxy also injects X-N8N-API-KEY from the same env vars.
 */
export const PARKING_WEBHOOK_HEADERS: Record<string, string> = {
  'X-N8N-API-KEY': PARKING_WEBHOOK_API_KEY,
  'Content-Type': 'application/json',
}

/** Same-origin proxy — preferred path. */
const PARKING_WEBHOOK_PROXY = '/api/parkimine'

function webhookHeaders(): Headers {
  const headers = new Headers()
  if (PARKING_WEBHOOK_API_KEY) {
    headers.set('X-N8N-API-KEY', PARKING_WEBHOOK_API_KEY)
  }
  headers.set('Content-Type', 'application/json')
  return headers
}

export type ParkingSessionAction = 'start' | 'stop' | 'status' | 'extend'

export type ParkingSessionRequest = {
  action: ParkingSessionAction
  carNumber?: string
  zone?: string
  /** Minutes to add for action: "extend" */
  minutes?: number
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
  /** Present when status is queried without a specific carNumber (list mode). */
  activeSessions?: ParkingSessionDetails[]
  /** Number of active sessions (list mode). */
  count?: number
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
  if (action === 'extend') {
    return success ? 'Aega pikendatud' : 'Aja pikendamine ebaõnnestus'
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

function normalizeActiveSessions(raw: unknown): ParkingSessionDetails[] {
  if (!Array.isArray(raw)) return []
  const out: ParkingSessionDetails[] = []
  for (const item of raw) {
    const n = normalizeSessionDetails(item)
    if (n) out.push(n)
  }
  return out
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

/**
 * Pull sessionDetails from nested object, top-level fields, or activeSessions match.
 */
function extractSessionDetails(
  d: Record<string, unknown>,
  preferPlate?: string,
): ParkingSessionDetails | null {
  const nested = normalizeSessionDetails(d.sessionDetails ?? d.session_details ?? d.data)
  if (nested && (nested.carNumber || nested.zone || nested.status)) {
    return nested
  }

  // Flat payload: { success, message, carNumber, zone, status, hourlyRate, startTime }
  const flat = normalizeSessionDetails(d)
  if (
    flat &&
    (flat.carNumber || flat.zone) &&
    (flat.status || flat.startTime || flat.hourlyRate != null)
  ) {
    return flat
  }

  const list = normalizeActiveSessions(
    d.activeSessions ?? d.active_sessions ?? d.sessions,
  )
  if (list.length === 0) return null
  if (preferPlate) {
    const plate = preferPlate.trim().toUpperCase()
    const mine = list.find(
      (s) => String(s.carNumber ?? '').toUpperCase() === plate && isActiveSessionStatus(s),
    )
    if (mine) return mine
  }
  const firstActive = list.find((s) => isActiveSessionStatus(s))
  return firstActive ?? list[0] ?? null
}

function normalizeResponse(
  data: unknown,
  action: ParkingSessionAction,
  preferPlate?: string,
): ParkingSessionResponse {
  const d = unwrapPayload(data)
  if (!d) {
    return { success: false, message: 'Tundmatu vastus serverilt' }
  }

  const message =
    typeof d.message === 'string' && d.message.trim()
      ? d.message
      : defaultMessage(action, Boolean(d.success))

  const activeSessions = normalizeActiveSessions(
    d.activeSessions ?? d.active_sessions ?? d.sessions,
  )
  const count =
    asNumber(d.count) ??
    (activeSessions.length > 0 ? activeSessions.length : undefined)

  const sessionDetails = extractSessionDetails(d, preferPlate)

  // Promote ACTIVE sessionDetails to success even if the flag was omitted/false
  const hasActive = isActiveSessionStatus(sessionDetails)
  const success = hasActive || Boolean(d.success)

  return {
    success,
    message,
    sessionDetails,
    activeSessions: activeSessions.length > 0 ? activeSessions : undefined,
    count,
  }
}

/**
 * Build webhook JSON body — action is never rewritten.
 * - status + plate → { action: "status", carNumber } only
 * - extend → { action: "extend", carNumber, zone, minutes }
 * - start/stop → { action, carNumber, zone }
 */
function buildPayload(body: ParkingSessionRequest): Record<string, string | number> {
  const action = body.action
  const payload: Record<string, string | number> = { action }
  const plate = body.carNumber?.trim()
  if (plate) payload.carNumber = plate.toUpperCase()

  // status with plate → carNumber only (n8n contract) — never include zone
  if (action === 'status') {
    return payload
  }

  const zone = body.zone?.trim()
  if (zone) payload.zone = zone
  if (action === 'extend' && typeof body.minutes === 'number' && body.minutes > 0) {
    payload.minutes = body.minutes
  }
  return payload
}

async function postSession(
  url: string,
  body: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: webhookHeaders(),
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

  const preferPlate = body.carNumber?.trim()

  if (!res.ok) {
    const normalized = normalizeResponse(
      parsed ?? { success: false, message: text.slice(0, 240) },
      body.action,
      preferPlate,
    )
    // Active session in body despite non-2xx — still surface it
    if (isActiveSessionStatus(normalized.sessionDetails)) {
      return { ...normalized, success: true }
    }
    const msg =
      normalized.message === 'Error in workflow'
        ? 'n8n töövoog ebaõnnestus (serveri viga) — kontrolli webhook’i'
        : normalized.message || `Viga ${res.status}`
    return {
      success: false,
      message: msg,
      sessionDetails: normalized.sessionDetails,
      activeSessions: normalized.activeSessions,
      count: normalized.count,
    }
  }

  if (
    parsed == null ||
    (typeof parsed === 'object' &&
      parsed !== null &&
      !('success' in (parsed as object)) &&
      !('message' in (parsed as object)) &&
      !('sessionDetails' in (parsed as object)) &&
      !('activeSessions' in (parsed as object)) &&
      !('count' in (parsed as object)) &&
      !('carNumber' in (parsed as object)) &&
      !('status' in (parsed as object)))
  ) {
    if (res.ok && (!text || !text.trim())) {
      return { success: true, message: defaultMessage(body.action, true) }
    }
    // extend often returns empty body on 200 — treat as soft success
    if (res.ok && body.action === 'extend') {
      return {
        success: true,
        message: text?.trim() ? text.slice(0, 240) : defaultMessage('extend', true),
      }
    }
    return {
      success: false,
      message: text?.trim() ? text.slice(0, 240) : 'Tühi vastus serverilt',
    }
  }

  return normalizeResponse(parsed, body.action, preferPlate)
}

function validateRequest(input: ParkingSessionRequest): string | null {
  const carNumber = input.carNumber?.trim() ?? ''
  const zone = input.zone?.trim() ?? ''

  // status without carNumber = list all active sessions
  if (input.action === 'status') {
    return null
  }

  if (!carNumber) return 'Sisesta auto number'
  if (input.action === 'extend') {
    if (!zone) return 'Tsoon puudub'
    if (!(typeof input.minutes === 'number' && input.minutes > 0)) {
      return 'Lisa aeg minutites'
    }
    return null
  }
  if (!zone) return 'Tsoon puudub'
  return null
}

/**
 * Send a parking session action via the production n8n webhook.
 * Prefers same-origin `/api/parkimine` (server injects X-N8N-API-KEY);
 * falls back to the direct cloud URL with the same headers.
 *
 * Callers must pass the exact `action` — this helper never remaps start/stop/status/extend.
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
    minutes: input.minutes,
  }

  if (!PARKING_WEBHOOK_API_KEY) {
    return {
      success: false,
      message: 'VITE_N8N_API_KEY puudub — seadista .env fail',
    }
  }

  try {
    return await postSession(PARKING_WEBHOOK_PROXY, body, signal)
  } catch {
    if (!PARKING_WEBHOOK_URL) {
      return {
        success: false,
        message: 'VITE_N8N_WEBHOOK_URL puudub — seadista .env fail',
      }
    }
    try {
      return await postSession(PARKING_WEBHOOK_URL, body, signal)
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
  return sendParkingSession({ action: 'start', carNumber: input.carNumber, zone: input.zone }, signal)
}

export function stopParkingSession(
  input: { carNumber: string; zone: string },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ action: 'stop', carNumber: input.carNumber, zone: input.zone }, signal)
}

/**
 * Status for a specific car.
 * POST body is exactly `{ action: "status", carNumber }` (no zone).
 * Never starts or stops a session.
 */
export function checkParkingStatus(
  input: { carNumber: string },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ action: 'status', carNumber: input.carNumber }, signal)
}

/**
 * List all active parking sessions (status without carNumber).
 * Backend returns `{ activeSessions, count }`.
 */
export function listActiveParkingSessions(
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession({ action: 'status' }, signal)
}

/**
 * Extend / pre-pay more time on an active session.
 * POST { action: "extend", carNumber, zone, minutes }
 */
export function extendParkingSession(
  input: { carNumber: string; zone: string; minutes: number },
  signal?: AbortSignal,
): Promise<ParkingSessionResponse> {
  return sendParkingSession(
    {
      action: 'extend',
      carNumber: input.carNumber,
      zone: input.zone,
      minutes: input.minutes,
    },
    signal,
  )
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

/** Backend said there is no active session (stop/status). */
export function isSessionNotFoundMessage(message?: string | null): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('not found') ||
    m.includes('no active') ||
    m.includes('no session') ||
    m.includes('does not exist') ||
    m.includes('ei leitud') ||
    m.includes('pole aktiiv') ||
    m.includes('puudub aktiivne') ||
    m.includes('puudub aktiivset') ||
    m.includes('aktiivseid parkimisi pole') ||
    m.includes('aktiivset sessiooni pole') ||
    m.includes('aktiivset parkimist pole') ||
    m.includes('sessiooni ei leitud') ||
    m.includes('already stopped') ||
    m.includes('not active')
  )
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
  const listCount = result.count ?? result.activeSessions?.length
  const parts = [
    result.message,
    ...extras,
    listCount != null && result.activeSessions
      ? `${listCount} aktiivset sessiooni`
      : null,
    details?.carNumber && details?.zone
      ? `${details.carNumber} · ${details.zone}`
      : null,
    formatHourlyRate(sessionHourlyRate(details)),
    details?.status ? String(details.status) : null,
    formatSessionInstant(sessionStartIso(details))
      ? `alates ${formatSessionInstant(sessionStartIso(details))}`
      : null,
  ]
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
