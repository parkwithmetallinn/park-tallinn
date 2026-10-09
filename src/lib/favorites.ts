/**
 * Favorite parking lot IDs — local-only in browser localStorage.
 * Key: parkvibe_favorites
 */

export const FAVORITES_STORAGE_KEY = 'parkvibe_favorites'

/** Fired on same-tab favorite changes so React hooks can re-read. */
export const FAVORITES_CHANGE_EVENT = 'parkvibe:favorites-change'

function notifyChange(): void {
  try {
    window.dispatchEvent(new Event(FAVORITES_CHANGE_EVENT))
  } catch {
    /* SSR / non-browser */
  }
}

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      const id = String(item ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  } catch {
    return []
  }
}

function writeRaw(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* quota / private mode — ignore */
  }
  notifyChange()
}

/** All saved parking IDs (insertion order, newest last). */
export function getFavorites(): string[] {
  return readRaw()
}

export function isFavorite(id: string): boolean {
  const key = String(id ?? '').trim()
  if (!key) return false
  return readRaw().includes(key)
}

/** Toggle favorite; returns the updated id list. */
export function toggleFavorite(id: string): string[] {
  const key = String(id ?? '').trim()
  if (!key) return readRaw()
  const current = readRaw()
  const next = current.includes(key)
    ? current.filter((x) => x !== key)
    : [...current, key]
  writeRaw(next)
  return next
}

export function clearFavorites(): void {
  writeRaw([])
}

export function setFavorites(ids: string[]): void {
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of ids) {
    const id = String(item ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  writeRaw(next)
}
