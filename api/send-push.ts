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

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(String(provided), 'utf8')
  const b = Buffer.from(String(expected), 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function isSubscription(v) {
  return (
    v &&
    typeof v === 'object' &&
    typeof v.endpoint === 'string' &&
    v.endpoint.length > 0
  )
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false })
    return
  }

  if (!INTERNAL_SECRET || !secretsMatch(req.headers['x-internal-secret'], INTERNAL_SECRET)) {
    res.status(401).json({ ok: false })
    return
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    res.status(500).json({ ok: false })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({ ok: false })
      return
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ ok: false })
    return
  }

  const { subscription, title, body: notifBody, url } = body
  if (!isSubscription(subscription)) {
    res.status(400).json({ ok: false })
    return
  }

  const payload = JSON.stringify({
    title: typeof title === 'string' && title.trim() ? title : 'Tallinna parkimine',
    body: typeof notifBody === 'string' ? notifBody : '',
    url: typeof url === 'string' && url.trim() ? url : '/',
  })

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    await webpush.sendNotification(subscription, payload)
    res.status(200).json({ ok: true })
  } catch (err) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number(err.statusCode)
        : NaN
    if (statusCode === 404 || statusCode === 410) {
      res.status(200).json({ ok: false, gone: true })
      return
    }
    res.status(200).json({ ok: false })
  }
}
