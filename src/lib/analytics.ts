/**
 * Cookieless analytics — Plausible or Cloudflare Web Analytics.
 * Respects Do Not Track / Global Privacy Control. Never logs coordinates,
 * search text, or session/plate codes.
 */

type AnalyticsEvent =
  | 'filter_used'
  | 'free_now_toggled'
  | 'navigate_clicked'
  | 'spot_added'

type EventProps = {
  filter?: string
  provider?: 'waze' | 'google' | 'apple'
  mode?: string
}

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: Record<string, string> }) => void
  }
}

function dntEnabled(): boolean {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.globalPrivacyControl) return true
    const dnt = nav.doNotTrack || (window as { doNotTrack?: string }).doNotTrack
    return dnt === '1' || dnt === 'yes'
  } catch {
    return false
  }
}

let booted = false

/** Load vendor beacon once (no cookies). No-op when DNT or unset env. */
export function initAnalytics(): void {
  if (booted || typeof window === 'undefined') return
  if (dntEnabled()) return
  booted = true

  const cfToken = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN as string | undefined
  const plausibleDomain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as
    | string
    | undefined

  if (cfToken) {
    const s = document.createElement('script')
    s.defer = true
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: cfToken }))
    document.head.appendChild(s)
  }

  if (plausibleDomain) {
    const s = document.createElement('script')
    s.defer = true
    s.dataset.domain = plausibleDomain
    s.src = 'https://plausible.io/js/script.js'
    document.head.appendChild(s)
  }
}

/** Pageview is handled by the vendor script; custom events go to Plausible when present. */
export function track(event: AnalyticsEvent, props?: EventProps): void {
  if (typeof window === 'undefined' || dntEnabled()) return
  try {
    const clean: Record<string, string> = {}
    if (props?.filter) clean.filter = String(props.filter).slice(0, 32)
    if (props?.provider) clean.provider = props.provider
    if (props?.mode) clean.mode = String(props.mode).slice(0, 32)
    window.plausible?.(event, Object.keys(clean).length ? { props: clean } : undefined)
  } catch {
    /* never break the app for analytics */
  }
}
