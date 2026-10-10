/**
 * Internal Web Push sender for n8n (or other trusted callers).
 *
 * POST only. Requires header `x-internal-secret` === INTERNAL_SECRET
 * (constant-time compare). Body: { subscription, title, body, url }.
 *
 * Env (server only — never log values):
 *   INTERNAL_SECRET
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT
 *
 * Never logs the subscription or VAPID keys.
 */

import webpush from 'web-push'
import { timingSafeEqual } from 'node:crypto'

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || ''
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || ''

const ALLOWED_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
] as const

const TITLE_MAX = 80
const BODY_MAX = 200

type ApiReq = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
}

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void
    end: (body?: unknown) => void
  }
}

type PushSubscriptionLike = {
  endpoint: string
  keys?: Record<string, string>
  [key: string]: unknown
}

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

function isSubscription(v: unknown): v is PushSubscriptionLike {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as PushSubscriptionLike).endpoint === 'string' &&
    (v as PushSubscriptionLike).endpoint.length > 0
  )
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return ALLOWED_PUSH_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}

function normalizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '/'
  const t = raw.trim()
  if (!t.startsWith('/') || t.startsWith('//')) return '/'
  return t
}

function clampTitle(raw: unknown): string {
  const base =
    typeof raw === 'string' && raw.trim() ? raw.trim() : 'Tallinna parkimine'
  return base.slice(0, TITLE_MAX)
}

function clampBody(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.slice(0, BODY_MAX)
}

export default async function handler(
  req: ApiReq,
  res: ApiRes,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false })
    return
  }

  if (
    !INTERNAL_SECRET ||
    !secretsMatch(req.headers?.['x-internal-secret'], INTERNAL_SECRET)
  ) {
    res.status(401).json({ ok: false })
    return
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    res.status(500).json({ ok: false })
    return
  }

  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body) as unknown
    } catch {
      res.status(400).json({ ok: false })
      return
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ ok: false })
    return
  }

  const b = body as Record<string, unknown>
  const subscription = b.subscription
  if (!isSubscription(subscription)) {
    res.status(400).json({ ok: false })
    return
  }

  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    res.status(400).json({ ok: false, message: 'Vigane push endpoint' })
    return
  }

  const payload = JSON.stringify({
    title: clampTitle(b.title),
    body: clampBody(b.body),
    url: normalizeUrl(b.url),
  })

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    await webpush.sendNotification(subscription, payload, {
      TTL: 600,
      urgency: 'high',
    })
    res.status(200).json({ ok: true })
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode?: unknown }).statusCode)
        : NaN
    if (statusCode === 404 || statusCode === 410) {
      res.status(200).json({ ok: false, gone: true })
      return
    }
    res.status(200).json({ ok: false })
  }
}
