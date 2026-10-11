/**
 * Maintenance cleanup for expired parking session PII + old reports.
 *
 * POST or GET. Requires header `x-internal-secret` === INTERNAL_SECRET
 * (constant-time compare).
 *
 * Prefers Supabase RPC `clean_old_parking_data()`; falls back to direct
 * table updates/deletes when the RPC is missing.
 *
 * Env (server only):
 *   INTERNAL_SECRET
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type ApiReq = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
}

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void
    end: (body?: unknown) => void
  }
}

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || ''
const REPORTS_TABLE = 'parking_reports'
const FEEDBACK_TABLE = 'parking_feedback'
const SESSIONS_TABLE = 'parking_sessions'
const REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Feedback inbox retention — matches supabase/feedback.sql cleanup rule. */
const FEEDBACK_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

function secretsMatch(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (!provided || !expected) return false
  const raw = Array.isArray(provided) ? provided[0] : provided
  if (!raw) return false
  const a = Buffer.from(String(raw), 'utf8')
  const b = Buffer.from(String(expected), 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function headerValue(
  headers: ApiReq['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === 'string' ? raw : undefined
}

function getServiceClient(): SupabaseClient | null {
  const url = String(process.env.SUPABASE_URL ?? '').trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function runDirectCleanup(sb: SupabaseClient): Promise<{
  sessionsCleared: boolean
  reportsDeleted: boolean
  feedbackDeleted: boolean
  details: string[]
}> {
  const details: string[] = []
  const nowIso = new Date().toISOString()
  const reportsCutoff = new Date(Date.now() - REPORT_MAX_AGE_MS).toISOString()
  const feedbackCutoff = new Date(
    Date.now() - FEEDBACK_MAX_AGE_MS,
  ).toISOString()

  let sessionsCleared = false
  let reportsDeleted = false
  let feedbackDeleted = false

  // Wipe PII from inactive / expired sessions
  const sessionUpdate = await sb
    .from(SESSIONS_TABLE)
    .update({
      push_subscription: null,
      notify_email: null,
    })
    .or(
      [
        'status.eq.expired',
        'status.eq.inactive',
        'status.eq.stopped',
        'status.eq.ended',
        `ends_at.lt.${nowIso}`,
        `end_time.lt.${nowIso}`,
      ].join(','),
    )

  if (sessionUpdate.error) {
    details.push(`sessions: ${sessionUpdate.error.message}`)
  } else {
    sessionsCleared = true
    details.push('sessions: cleared push_subscription + notify_email')
  }

  const reportDelete = await sb
    .from(REPORTS_TABLE)
    .delete()
    .lt('created_at', reportsCutoff)

  if (reportDelete.error) {
    details.push(`reports: ${reportDelete.error.message}`)
  } else {
    reportsDeleted = true
    details.push('reports: deleted rows older than 24h')
  }

  // Prefer SQL function; fall back to direct delete
  const feedbackRpc = await sb.rpc('cleanup_old_parking_feedback')
  if (!feedbackRpc.error) {
    feedbackDeleted = true
    details.push(
      `feedback: cleanup_old_parking_feedback → ${String(feedbackRpc.data ?? 0)}`,
    )
  } else {
    const feedbackDelete = await sb
      .from(FEEDBACK_TABLE)
      .delete()
      .lt('created_at', feedbackCutoff)
    if (feedbackDelete.error) {
      details.push(`feedback: ${feedbackDelete.error.message}`)
    } else {
      feedbackDeleted = true
      details.push('feedback: deleted rows older than 180d')
    }
  }

  return { sessionsCleared, reportsDeleted, feedbackDeleted, details }
}

export default async function handler(req: ApiReq, res: ApiRes): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (method !== 'POST' && method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Meetod pole lubatud' })
    return
  }

  if (
    !INTERNAL_SECRET ||
    !secretsMatch(headerValue(req.headers, 'x-internal-secret'), INTERNAL_SECRET)
  ) {
    res.status(401).json({ ok: false, message: 'Autentimine ebaõnnestus' })
    return
  }

  const sb = getServiceClient()
  if (!sb) {
    res.status(500).json({
      ok: false,
      message: 'Supabase pole seadistatud',
    })
    return
  }

  // Prefer RPC when available
  const rpc = await sb.rpc('clean_old_parking_data')
  if (!rpc.error) {
    res.status(200).json({
      ok: true,
      mode: 'rpc',
      result: rpc.data ?? null,
    })
    return
  }

  const rpcMissing =
    /function|could not find|does not exist|PGRST202/i.test(
      rpc.error.message || '',
    ) || rpc.error.code === 'PGRST202'

  if (!rpcMissing) {
    res.status(500).json({
      ok: false,
      message: 'Puhastus ebaõnnestus',
      detail: rpc.error.message,
    })
    return
  }

  try {
    const fallback = await runDirectCleanup(sb)
    const ok =
      fallback.sessionsCleared ||
      fallback.reportsDeleted ||
      fallback.feedbackDeleted
    res.status(ok ? 200 : 500).json({
      ok,
      mode: 'fallback',
      ...fallback,
    })
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: 'Puhastus ebaõnnestus',
      detail: err instanceof Error ? err.message : 'unknown',
    })
  }
}
