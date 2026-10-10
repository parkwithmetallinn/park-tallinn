/**
 * MapLibre HTML markers for community report status.
 * Markup/CSS shared with {@link FullIndicator}.
 * Decorative only — `pointer-events: none` so lot clicks pass through.
 */

export type CommunityMarkerStatus = 'full' | 'free' | 'unknown'

const LABELS: Record<CommunityMarkerStatus, string> = {
  full: 'Parkla on täis',
  free: 'Vabu kohti',
  unknown: 'Teadmata',
}

const CORE_TEXT: Record<CommunityMarkerStatus, string> = {
  full: '!',
  free: '✓',
  unknown: '?',
}

export function createFullIndicatorElement(): HTMLDivElement {
  return createCommunityStatusElement('full')
}

export function createCommunityStatusElement(
  status: CommunityMarkerStatus,
): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = `parking-full-indicator parking-status-indicator parking-status-indicator--${status}`
  wrap.setAttribute('aria-label', LABELS[status])
  wrap.title = LABELS[status]
  wrap.dataset.status = status

  const ring = document.createElement('span')
  ring.className = 'parking-full-indicator__ring'
  ring.setAttribute('aria-hidden', 'true')

  const core = document.createElement('span')
  core.className = 'parking-full-indicator__core'
  core.setAttribute('aria-hidden', 'true')
  core.textContent = CORE_TEXT[status]

  wrap.append(ring, core)
  return wrap
}

/** Update an existing marker element when the status changes. */
export function applyCommunityStatusToElement(
  el: HTMLElement,
  status: CommunityMarkerStatus,
): void {
  el.className = `parking-full-indicator parking-status-indicator parking-status-indicator--${status}`
  el.setAttribute('aria-label', LABELS[status])
  el.title = LABELS[status]
  el.dataset.status = status
  const core = el.querySelector('.parking-full-indicator__core')
  if (core) core.textContent = CORE_TEXT[status]
}
