/**
 * Vercel serverless proxy for the n8n parking webhook.
 * Injects Header Auth from server-side env on every upstream POST.
 *
 * Env (server only — never VITE_*):
 *   N8N_WEBHOOK_URL
 *   N8N_API_KEY
 */

const UPSTREAM = process.env.N8N_WEBHOOK_URL || ''
const API_KEY = process.env.N8N_API_KEY || ''

const ALLOWED_ACTIONS = new Set(['start', 'stop', 'status'])
const MAX_BODY_BYTES = 4_096
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30

/** Best-effort in-memory rate limit (per serverless isolate). */
const rateBuckets = new Map()

function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function rateLimit(ip) {
  const now = Date.now()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 }
    rateBuckets.set(ip, bucket)
  }
  bucket.count += 1
  return bucket.count <= RATE_MAX
}

function isValidCarNumber(v) {
  if (v == null || v === '') return true
  if (typeof v !== 'string') return false
  const s = v.trim().toUpperCase()
  return s.length >= 2 && s.length <= 12 && /^[A-Z0-9ÄÖÜÕ\- ]+$/i.test(s)
}

function isValidZone(v) {
  if (v == null || v === '') return true
  if (typeof v !== 'string') return false
  const s = v.trim()
  return s.length <= 32 && /^[A-Za-z0-9ÄÖÜÕäöüõ+\-_./ ]*$/.test(s)
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Vigane päring' }
  }
  const action = body.action
  if (!ALLOWED_ACTIONS.has(action)) {
    return { ok: false, message: 'Vigane päring' }
  }
  if (!isValidCarNumber(body.carNumber)) {
    return { ok: false, message: 'Sisesta auto number' }
  }
  if (!isValidZone(body.zone)) {
    return { ok: false, message: 'Tsoon puudub' }
  }
  if ((action === 'start' || action === 'stop') && !String(body.carNumber || '').trim()) {
    return { ok: false, message: 'Sisesta auto number' }
  }
  if (action === 'start' && !String(body.zone || '').trim()) {
    return { ok: false, message: 'Tsoon puudub' }
  }
  // Strip unknown keys — same shape upstream expects
  const clean = { action }
  if (body.carNumber) clean.carNumber = String(body.carNumber).trim().toUpperCase()
  if (body.zone) clean.zone = String(body.zone).trim()
  return { ok: true, body: clean }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    // Same-origin SPA only — tighten preflight (no wildcard credentials surface)
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' })
    return
  }

  if (!rateLimit(clientIp(req))) {
    // Reuse existing client error display path — no new UI copy
    res.status(429).json({
      success: false,
      message: 'Ühendus ebaõnnestus — kontrolli võrku',
    })
    return
  }

  if (!UPSTREAM || !API_KEY) {
    res.status(500).json({
      success: false,
      message: 'Server misconfigured — set N8N_WEBHOOK_URL and N8N_API_KEY',
    })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) {
      res.status(413).json({ success: false, message: 'Vigane päring' })
      return
    }
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({ success: false, message: 'Vigane päring' })
      return
    }
  }

  const validated = validateBody(body)
  if (!validated.ok) {
    res.status(400).json({ success: false, message: validated.message })
    return
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validated.body),
    })

    const text = await upstream.text()
    const contentType =
      upstream.headers.get('content-type') || 'application/json'
    res.status(upstream.status)
    res.setHeader('Content-Type', contentType)
    res.send(text)
  } catch (err) {
    res.status(502).json({
      success: false,
      message: err instanceof Error ? err.message : 'Upstream n8n request failed',
    })
  }
}
