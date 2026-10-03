/**
 * Parking session API — same-origin `/api/parkimine` only.
 *
 * The browser never sees n8n credentials. The Vite / Vercel proxy reads
 * N8N_WEBHOOK_URL + N8N_API_KEY (server env) and injects X-N8N-API-KEY.
 *
 * Body:  { action: "start"|"stop"|"status", carNumber?, zone? }
 * There is NO server "extend" action — prepaid time is local-only.
 */

/** Same-origin proxy — the only client endpoint. */
const PARKING_WEBHOOK_PROXY = '/api/parkimine'

function webhookHeaders(): Headers {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  return headers
}

/** Server-supported actions only (no extend). */
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

/** Intermediate parsed webhook JSON (internal / query cache). */
export type ParkingSessionResponse = {
  success: boolean
  message: string
  sessionDetails?: ParkingSessionDetails | null
  activeSessions?: ParkingSessionDetails[]
  count?: number
}

/**
 * Single typed outcome for every parking session call.
 * NOT_FOUND is a normal result (never treated as ERROR).
 */
export type SessionOutcome =
  | {
      kind: 'ACTIVE'
      details: ParkingSessionDetails
      message: string
      activeSessions?: ParkingSessionDetails[]
      count?: number
    }
  | {
      kind: 'NOT_FOUND'
      message: string
      activeSessions?: ParkingSessionDetails[]
      count?: number
    }
  | {
      kind: 'ERROR'
      message: string
      httpStatus?: number
      activeSessions?: ParkingSessionDetails[]
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

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/**
 * n8n may return the webhook JSON directly, wrapped in `{ json }`, `{ body }`,
 * `{ data }`, or as a one-element array of any of those.
 */
function unwrapPayload(data: unknown): Record<string, unknown> | null {
  if (!data) return null

  let cur: unknown = data
  for (let i = 0; i < 3; i++) {
    if (Array.isArray(cur)) {
      cur = cur[0]
      continue
    }
    break
  }

  let obj = asRecord(cur)
  if (!obj) return null

  for (let i = 0; i < 4; i++) {
    const hasSessionShape =
      'success' in obj ||
      'message' in obj ||
      'sessionDetails' in obj ||
      'session_details' in obj ||
      'activeSessions' in obj ||
      'active_sessions' in obj ||
      'carNumber' in obj ||
      'car_number' in obj ||
      'status' in obj

    if (hasSessionShape) return obj

    const next =
      obj.json ?? obj.body ?? obj.data ?? obj.result ?? obj.output ?? obj.payload
    if (Array.isArray(next)) {
      const first = asRecord(next[0])
      if (first) {
        obj = first
        continue
      }
      return obj
    }
    const nested = asRecord(next)
    if (!nested) return obj
    obj = nested
  }

  return obj
}

function coerceSessionCandidate(raw: unknown): ParkingSessionDetails | null {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const n = normalizeSessionDetails(asRecord(item)?.json ?? item)
      if (n && (n.carNumber || n.zone || n.status || n.startTime)) return n
    }
    return null
  }
  const obj = asRecord(raw)
  if (obj?.json != null) {
    const fromJson = coerceSessionCandidate(obj.json)
    if (fromJson) return fromJson
  }
  return normalizeSessionDetails(raw)
}

function extractSessionDetails(
  d: Record<string, unknown>,
  preferPlate?: string,
): ParkingSessionDetails | null {
  const nested = coerceSessionCandidate(
    d.sessionDetails ?? d.session_details ?? d.session ?? d.data,
  )
  if (nested && (nested.carNumber || nested.zone || nested.status || nested.startTime)) {
    return nested
  }

  const flat = normalizeSessionDetails(d)
  if (
    flat &&
    (flat.carNumber || flat.zone) &&
    (flat.status || flat.startTime || flat.hourlyRate != null)
  ) {
    return flat
  }

  const list = normalizeActiveSessions(
    d.activeSessions ?? d.active_sessions ?? d.sessions ?? d.data,
  )
  if (list.length === 0) return null
  if (preferPlate) {
    const plate = preferPlate.trim().toUpperCase()
    const mine = list.find(
      (s) => String(s.carNumber ?? '').toUpperCase() === plate && isActiveSessionStatus(s),
    )
    if (mine) return mine
    const anyMine = list.find(
      (s) => String(s.carNumber ?? '').toUpperCase() === plate,
    )
    if (anyMine && isActiveSessionStatus(anyMine)) return anyMine
  }
  const firstActive = list.find((s) => isActiveSessionStatus(s))
  return firstActive ?? list[0] ?? null
}

function parseWebhookBody(
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

  const hasActive = isActiveSessionStatus(sessionDetails)
  const explicitSuccess =
    d.success === true || d.success === 'true' || d.success === 1
  const success =
    hasActive || (explicitSuccess && !isSessionNotFoundMessage(message))

  return {
    success,
    message,
    sessionDetails,
    activeSessions: activeSessions.length > 0 ? activeSessions : undefined,
    count,
  }
}

/**
 * Map a parsed webhook response (+ transport flags) into ACTIVE | NOT_FOUND | ERROR.
 * NOT_FOUND is never an ERROR.
 */
export function toSessionOutcome(
  response: ParkingSessionResponse,
  action: ParkingSessionAction,
  meta: { httpStatus?: number; networkError?: boolean; invalidJson?: boolean } = {},
): SessionOutcome {
  const list = response.activeSessions
  const count = response.count

  if (meta.networkError) {
    return {
      kind: 'ERROR',
      message: response.message || 'Ühendus ebaõnnestus — kontrolli võrku',
      httpStatus: meta.httpStatus,
      activeSessions: list,
      count,
    }
  }

  if (meta.httpStatus === 401 || meta.httpStatus === 403) {
    return {
      kind: 'ERROR',
      message:
        response.message ||
        'Autentimine ebaõnnestus — kontrolli serveri N8N_API_KEY seadistust',
      httpStatus: meta.httpStatus,
      activeSessions: list,
      count,
    }
  }

  if (meta.invalidJson) {
    return {
      kind: 'ERROR',
      message: response.message || 'Vigane vastus serverilt',
      httpStatus: meta.httpStatus,
      activeSessions: list,
      count,
    }
  }

  // Prefer active sessionDetails; also accept first active from list
  const activeDetails =
    (response.sessionDetails && isActiveSessionStatus(response.sessionDetails)
      ? response.sessionDetails
      : null) ??
    list?.find((s) => isActiveSessionStatus(s)) ??
    null

  if (activeDetails) {
    return {
      kind: 'ACTIVE',
      details: activeDetails,
      message: response.message,
      activeSessions: list,
      count,
    }
  }

  if (isSessionNotFoundMessage(response.message)) {
    return {
      kind: 'NOT_FOUND',
      message: response.message,
      activeSessions: list,
      count,
    }
  }

  // Successful stop / status with no active session → NOT_FOUND (normal)
  if (
    response.success &&
    (action === 'stop' || action === 'status') &&
    !isActiveSessionStatus(response.sessionDetails)
  ) {
    return {
      kind: 'NOT_FOUND',
      message: response.message || defaultMessage(action, true),
      activeSessions: list,
      count,
    }
  }

  // start must confirm ACTIVE — bare success without details is ERROR
  if (action === 'start' && response.success && !activeDetails) {
    return {
      kind: 'ERROR',
      message: response.message || 'Server ei kinnitanud aktiivset sessiooni',
      httpStatus: meta.httpStatus,
      activeSessions: list,
      count,
    }
  }

  if (!response.success || (meta.httpStatus != null && meta.httpStatus >= 400)) {
    return {
      kind: 'ERROR',
      message: response.message || defaultMessage(action, false),
      httpStatus: meta.httpStatus,
      activeSessions: list,
      count,
    }
  }

  return {
    kind: 'ERROR',
    message: response.message || 'Tundmatu vastus serverilt',
    httpStatus: meta.httpStatus,
    activeSessions: list,
    count,
  }
}

function buildPayload(body: ParkingSessionRequest): Record<string, string> {
  const action = body.action

  if (action === 'status') {
    const plate = body.carNumber?.trim()
    return plate
      ? { action: 'status', carNumber: plate.toUpperCase() }
      : { action: 'status' }
  }

  const payload: Record<string, string> = { action }
  const plate = body.carNumber?.trim()
  if (plate) payload.carNumber = plate.toUpperCase()
  const zone = body.zone?.trim()
  if (zone) payload.zone = zone
  return payload
}

async function postSession(
  url: string,
  body: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify(buildPayload(body)),
      signal,
    })
  } catch {
    return toSessionOutcome(
      {
        success: false,
        message: 'Ühendus ebaõnnestus — kontrolli võrku või n8n webhook’i',
      },
      body.action,
      { networkError: true },
    )
  }

  const text = await res.text()
  let parsed: unknown = null
  let invalidJson = false
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      invalidJson = true
      parsed = { success: res.ok, message: text.slice(0, 240) }
    }
  }

  if (/authorization data is wrong/i.test(text)) {
    return toSessionOutcome(
      {
        success: false,
        message:
          'Autentimine ebaõnnestus — kontrolli serveri N8N_API_KEY seadistust',
      },
      body.action,
      { httpStatus: res.status === 200 ? 401 : res.status },
    )
  }

  const preferPlate = body.carNumber?.trim()

  if (!res.ok) {
    const normalized = parseWebhookBody(
      parsed ?? { success: false, message: text.slice(0, 240) },
      body.action,
      preferPlate,
    )
    // Active session in body despite non-2xx — still surface as ACTIVE
    if (isActiveSessionStatus(normalized.sessionDetails)) {
      return toSessionOutcome(
        { ...normalized, success: true },
        body.action,
        { httpStatus: res.status },
      )
    }
    const msg =
      normalized.message === 'Error in workflow'
        ? 'n8n töövoog ebaõnnestus (serveri viga) — kontrolli webhook’i'
        : normalized.message || `Viga ${res.status}`
    return toSessionOutcome(
      {
        success: false,
        message: msg,
        sessionDetails: normalized.sessionDetails,
        activeSessions: normalized.activeSessions,
        count: normalized.count,
      },
      body.action,
      {
        httpStatus: res.status,
        invalidJson: invalidJson && !isSessionNotFoundMessage(msg),
      },
    )
  }

  if (parsed == null) {
    if (res.ok && (!text || !text.trim())) {
      return toSessionOutcome(
        { success: true, message: defaultMessage(body.action, true) },
        body.action,
        { httpStatus: res.status },
      )
    }
    return toSessionOutcome(
      {
        success: false,
        message: text?.trim() ? text.slice(0, 240) : 'Tühi vastus serverilt',
      },
      body.action,
      { httpStatus: res.status, invalidJson },
    )
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !('success' in (parsed as object)) &&
    !('message' in (parsed as object)) &&
    !('sessionDetails' in (parsed as object)) &&
    !('activeSessions' in (parsed as object)) &&
    !('count' in (parsed as object)) &&
    !('carNumber' in (parsed as object)) &&
    !('status' in (parsed as object))
  ) {
    return toSessionOutcome(
      {
        success: false,
        message: text?.trim() ? text.slice(0, 240) : 'Tühi vastus serverilt',
      },
      body.action,
      { httpStatus: res.status, invalidJson: true },
    )
  }

  return toSessionOutcome(
    parseWebhookBody(parsed, body.action, preferPlate),
    body.action,
    { httpStatus: res.status, invalidJson },
  )
}

import { parseParkingSessionBody } from './validation'

function validateRequest(input: ParkingSessionRequest): string | null {
  const parsed = parseParkingSessionBody({
    action: input.action,
    carNumber: input.carNumber?.trim() || undefined,
    zone: input.zone?.trim() || undefined,
  })
  if (!parsed) {
    // Reuse existing error strings — no new UX copy
    if (input.action !== 'status' && !input.carNumber?.trim()) {
      return 'Sisesta auto number'
    }
    if (input.action === 'start' && !input.zone?.trim()) {
      return 'Tsoon puudub'
    }
    if (input.action !== 'status' && !input.zone?.trim()) {
      return 'Tsoon puudub'
    }
    return 'Sisesta auto number'
  }
  return null
}

/**
 * Send a parking session action via same-origin `/api/parkimine` only.
 * Returns a typed SessionOutcome (ACTIVE | NOT_FOUND | ERROR).
 */
export async function sendParkingSession(
  input: ParkingSessionRequest,
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  const validationError = validateRequest(input)
  if (validationError) {
    return { kind: 'ERROR', message: validationError }
  }

  const body: ParkingSessionRequest = {
    action: input.action,
    carNumber: input.carNumber?.trim() || undefined,
    zone: input.zone?.trim() || undefined,
  }

  return postSession(PARKING_WEBHOOK_PROXY, body, signal)
}

export function startParkingSession(
  input: { carNumber: string; zone: string },
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  return sendParkingSession(
    { action: 'start', carNumber: input.carNumber, zone: input.zone },
    signal,
  )
}

export function stopParkingSession(
  input: { carNumber: string; zone: string },
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  return sendParkingSession(
    { action: 'stop', carNumber: input.carNumber, zone: input.zone },
    signal,
  )
}

/**
 * Status for a specific car.
 * POST body is exactly:
 *   { "action": "status", "carNumber": "123DFG" }
 * Never starts or stops a session; never includes zone.
 */
export function checkParkingStatus(
  input: { carNumber: string },
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  const carNumber = input.carNumber.trim().toUpperCase()
  return sendParkingSession({ action: 'status', carNumber }, signal)
}

/**
 * List all active parking sessions (status without carNumber).
 */
export function listActiveParkingSessions(
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  return sendParkingSession({ action: 'status' }, signal)
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

  const rawStatus = (details as Record<string, unknown>).status

  if (rawStatus === true || rawStatus === 1) return true
  if (rawStatus === false || rawStatus === 0) return false

  const status = String(rawStatus ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')

  if (
    status === 'STOPPED' ||
    status === 'ENDED' ||
    status === 'INACTIVE' ||
    status === 'COMPLETED' ||
    status === 'FINISHED' ||
    status === 'LOPETATUD' ||
    status === 'PEATATUD' ||
    status === 'EI OLE AKTIIVNE'
  ) {
    return false
  }
  if (
    status === 'ACTIVE' ||
    status === 'RUNNING' ||
    status === 'STARTED' ||
    status === 'IN_PROGRESS' ||
    status === 'IN PROGRESS' ||
    status === 'AKTIIVNE' ||
    status === 'KAIB' ||
    status === 'OK'
  ) {
    return true
  }
  return Boolean(
    (details.carNumber || details.zone || details.startTime || details.startedAt) &&
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
    hourlyRate: sessionHourlyRate(details) ?? fallback?.hourlyRate,
  }
}

/** Compact detail line for toasts / notices from a session outcome. */
export function formatSessionFeedbackDetail(
  outcome: SessionOutcome,
  extras: Array<string | undefined | null> = [],
): string {
  const details = outcome.kind === 'ACTIVE' ? outcome.details : null
  const listCount = outcome.count ?? outcome.activeSessions?.length
  const parts = [
    outcome.message,
    ...extras,
    listCount != null && outcome.activeSessions
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

/** Adapt outcome back to legacy response shape for react-query cache consumers. */
export function outcomeToResponse(outcome: SessionOutcome): ParkingSessionResponse {
  if (outcome.kind === 'ACTIVE') {
    return {
      success: true,
      message: outcome.message,
      sessionDetails: outcome.details,
      activeSessions: outcome.activeSessions,
      count: outcome.count,
    }
  }
  if (outcome.kind === 'NOT_FOUND') {
    return {
      success: true,
      message: outcome.message,
      sessionDetails: null,
      activeSessions: outcome.activeSessions,
      count: outcome.count,
    }
  }
  return {
    success: false,
    message: outcome.message,
    activeSessions: outcome.activeSessions,
    count: outcome.count,
  }
}
