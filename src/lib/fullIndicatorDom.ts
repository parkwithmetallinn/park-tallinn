/**
 * MapLibre HTML marker for community "parkla on täis".
 * Markup/CSS shared with {@link FullIndicator} (`.parking-full-indicator`).
 * Decorative only — `pointer-events: none` so lot clicks pass through.
 */

const ARIA = 'Parkla on täis'

export function createFullIndicatorElement(): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'parking-full-indicator'
  wrap.setAttribute('aria-label', ARIA)
  wrap.title = ARIA

  const ring = document.createElement('span')
  ring.className = 'parking-full-indicator__ring'
  ring.setAttribute('aria-hidden', 'true')

  const core = document.createElement('span')
  core.className = 'parking-full-indicator__core'
  core.setAttribute('aria-hidden', 'true')
  core.textContent = '!'

  wrap.append(ring, core)
  return wrap
}
