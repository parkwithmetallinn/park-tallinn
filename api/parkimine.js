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

  if (!UPSTREAM || !API_KEY) {
    res.status(500).json({
      success: false,
      message: 'Server misconfigured — set N8N_WEBHOOK_URL and N8N_API_KEY',
    })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      /* keep raw string */
    }
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
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
