/**
 * Parking price estimate API (no DB / no secrets).
 *
 * POST JSON: { zone, startTime, endTime, startMarked? }
 *   zoneId is accepted as an alias for zone.
 * Times must be ISO 8601 with a timezone offset (or Z).
 */

import { calculatePrice } from './_lib/pricing.js'

type ApiReq = {
  method?: string
  body?: unknown
}

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void
    end: (body?: unknown) => void
  }
  setHeader?: (name: string, value: string) => void
}

function parseBody(req: ApiReq): Record<string, unknown> | null {
  let body = req.body
  if (body == null || body === '') return null
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body) as unknown
    } catch {
      return null
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

export default function handler(req: ApiReq, res: ApiRes): void {
  res.setHeader?.('Cache-Control', 'no-store')

  const method = String(req.method || 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (method !== 'POST') {
    res.setHeader?.('Allow', 'POST')
    res.status(405).json({
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Kasuta POST päringut',
    })
    return
  }

  const body = parseBody(req)
  if (!body) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_INPUT',
      message: 'Päringu keha peab olema JSON-objekt',
    })
    return
  }

  const result = calculatePrice({
    zone: body.zone ?? body.zoneId,
    startTime: body.startTime,
    endTime: body.endTime,
    startMarked: body.startMarked,
  })

  if (!result.ok) {
    res.status(result.code === 'TOO_LONG' ? 422 : 400).json({
      ok: false,
      error: result.code,
      code: result.code,
      message: result.message,
    })
    return
  }

  res.status(200).json({
    ok: true,
    quote: result.quote,
    ...result.quote,
  })
}
