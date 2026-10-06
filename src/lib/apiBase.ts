/**
 * Absolute API origin for native shells (Capacitor) and cross-origin deploys.
 *
 * Web (Vercel / Vite): leave unset — same-origin `/api/*` proxies work.
 * iOS / Android build: set `VITE_API_BASE_URL` to your production host
 * (e.g. https://parkimine.ee) so the WebView can reach Nominatim, routing,
 * and the parking-session proxy. Never put n8n secrets in VITE_* vars.
 */
export function apiUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_BASE_URL ?? '')
    .trim()
    .replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}
