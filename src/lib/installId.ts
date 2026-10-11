/**
 * Anonymous install UUID for abuse-resistant community votes.
 * Stored only in localStorage — not linked to accounts or personal data.
 */

export const INSTALL_ID_STORAGE_KEY = 'parkvibe_install_id_v1'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  // RFC4122-ish fallback when randomUUID is unavailable.
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Return the persistent install id, creating one on first use. */
export function getInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_STORAGE_KEY)?.trim() ?? ''
    if (UUID_RE.test(existing)) return existing
    const next = createUuid()
    localStorage.setItem(INSTALL_ID_STORAGE_KEY, next)
    return next
  } catch {
    // Private mode / quota — ephemeral id for this session only.
    return createUuid()
  }
}

/** Headers to attach on report / type-vote POSTs. */
export function installIdHeaders(): Record<string, string> {
  return { 'X-Install-Id': getInstallId() }
}
