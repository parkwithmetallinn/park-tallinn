/**
 * Shared hashing helpers for rate-limited community APIs.
 * Salt from REPORT_SALT (server-only env).
 *
 * Reports / type-votes:
 *   client_hash = sha256(installId + salt)   via X-Install-Id
 *   ip_hash     = sha256(ip + salt)
 *
 * Feedback (and legacy callers) still use clientHash(req) = IP hash.
 */

import { createHash } from 'node:crypto'

export type HashableReq = {
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

export function hashWithSalt(value: string): string {
  const salt = String(process.env.REPORT_SALT ?? '').trim()
  return createHash('sha256').update(`${value}${salt}`, 'utf8').digest('hex')
}

/** Raw X-Install-Id when it looks like a UUID; otherwise null. */
export function installIdFromReq(req: HashableReq): string | null {
  const raw = headerValue(req.headers, 'x-install-id')?.trim() ?? ''
  if (!UUID_RE.test(raw)) return null
  return raw.toLowerCase()
}

/** sha256(installId + REPORT_SALT) — primary voter identity for reports/votes. */
export function installClientHash(req: HashableReq): string | null {
  const id = installIdFromReq(req)
  if (!id) return null
  return hashWithSalt(id)
}

/** sha256(ip + REPORT_SALT) — second axis for independence checks. */
export function ipHash(req: HashableReq): string {
  return hashWithSalt(firstForwardedIp(req))
}

/** sha256(ip + REPORT_SALT) — used by feedback rate limits. */
export function clientHash(req: HashableReq): string {
  return ipHash(req)
}

export function reportSaltOk(): boolean {
  const salt = String(process.env.REPORT_SALT ?? '').trim()
  return salt.length >= 16
}
