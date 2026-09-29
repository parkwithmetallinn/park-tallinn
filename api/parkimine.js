/**
 * Vercel serverless proxy for the n8n parking webhook.
 * Injects Header Auth on every upstream POST so the browser never relies
 * on CORS-exposed custom headers reaching n8n directly.
 */

const UPSTREAM =
  process.env.PARKING_WEBHOOK_URL ||
  'https://mairon8n.app.n8n.cloud/webhook/parkimine'

const API_KEY = process.env.N8N_API_KEY || process.env.PARKING_WEBHOOK_API_KEY || 'SecurityMHMJ26%'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-N8N-API-KEY')
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' })
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
    const contentType = upstream.headers.get('content-type') || 'application/json'
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
