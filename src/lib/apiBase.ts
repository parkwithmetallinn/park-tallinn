/**
 * Absolute API origin for native shells (Capacitor) and cross-origin deploys.
 *
 * Web (Vercel / Vite): leave unset — same-origin `/api/*` proxies work.
 * iOS / Android / production mobile builds: parking-session webhooks go to the
 * n8n cloud host below. Other `/api/*` calls still use `VITE_API_BASE_URL`
 * (your web host) when set. Never put n8n secrets in VITE_* vars.
 */

/** Production n8n host for Capacitor / mobile webhook traffic. */
export const N8N_BACKEND_HOST = 'https://mairon8n.app.n8n.cloud'

/** Public parking-session webhook path on that host. */
export const N8N_PARKIMINE_WEBHOOK_PATH = '/webhook/parkimine'

function trimBase(raw: string): string {
  return raw.trim().replace(/\/$/, '')
}

function envString(key: string): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, unknown> })
      .env
    const v = env?.[key]
    return v == null ? '' : String(v)
  } catch {
    return ''
  }
}

/** True inside Capacitor WebView or a Vite `mobile` production build. */
export function isCapacitorOrMobile(): boolean {
  if (typeof window !== 'undefined') {
    const cap = (
      window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean }
      }
    ).Capacitor
    if (cap?.isNativePlatform?.()) return true
  }
  if (envString('MODE') === 'mobile') return true
  if (envString('PROD') === 'true' && envString('VITE_CAPACITOR') === 'true') {
    return true
  }
  return false
}

/**
 * Absolute origin for general `/api/*` routes (Nominatim, OSRM, reports…).
 * Empty on same-origin web so relative paths hit the Vite/Vercel proxy.
 */
export function apiBase(): string {
  return trimBase(envString('VITE_API_BASE_URL'))
}

export function apiUrl(path: string): string {
  const base = apiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

/**
 * Parking-session webhook URL.
 * - Web / local: same-origin `/api/parkimine` (server injects n8n auth)
 * - Capacitor / mobile: n8n cloud webhook (override with VITE_N8N_WEBHOOK_URL)
 */
export function parkingSessionWebhookUrl(): string {
  const override = trimBase(envString('VITE_N8N_WEBHOOK_URL'))
  if (override) return override

  if (isCapacitorOrMobile()) {
    return `${N8N_BACKEND_HOST}${N8N_PARKIMINE_WEBHOOK_PATH}`
  }

  return apiUrl('/api/parkimine')
}
