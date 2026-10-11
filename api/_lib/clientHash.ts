/**
 * Shared IP → client_hash helper for rate-limited community APIs.
 * Salt from REPORT_SALT (server-only env).
 */

import { createHash } from 'node:crypto'

export type HashableReq = {
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

function headerValue(
  headers: HashableReq['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === 'string' ? raw : undefined
}

export function firstForwardedIp(req: HashableReq): string {
  const xf = headerValue(req.headers, 'x-forwarded-for')
  if (xf && xf.trim()) return xf.split(',')[0]!.trim()
  const real = headerValue(req.headers, 'x-real-ip')
  if (real && real.trim()) return real.trim()
  return req.socket?.remoteAddress?.trim() || 'unknown'
}

/** sha256(ip + REPORT_SALT) — never expose the raw IP. */
export function clientHash(req: HashableReq): string {
  const salt = String(process.env.REPORT_SALT ?? '').trim()
  const ip = firstForwardedIp(req)
  return createHash('sha256').update(`${ip}${salt}`, 'utf8').digest('hex')
}

export function reportSaltOk(): boolean {
  const salt = String(process.env.REPORT_SALT ?? '').trim()
  return salt.length >= 16
}
