/**
 * Crowdsourced "lot is full" marks — localStorage with 60-minute TTL.
 * Does not mutate GeoJSON; MapView greys out marked spots.
 */

const STORAGE_KEY = 'parktallinn:fullSpots:v1'
const TTL_MS = 60 * 60 * 1000

type FullSpotEntry = { id: string; until: number }

function readEntries(): FullSpotEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FullSpotEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e) => e && typeof e.id === 'string' && typeof e.until === 'number',
    )
  } catch {
    return []
  }
}

function writeEntries(entries: FullSpotEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* ignore quota */
  }
}

/** Active (non-expired) full-spot ids. */
export function loadFullSpotIds(now = Date.now()): Set<string> {
  const fresh = readEntries().filter((e) => e.until > now)
  if (fresh.length !== readEntries().length) writeEntries(fresh)
  return new Set(fresh.map((e) => e.id))
}

export function isSpotFull(id: string, ids?: Set<string>): boolean {
  const set = ids ?? loadFullSpotIds()
  return set.has(id)
}

/** Mark a spot full for 60 minutes; returns the updated id set. */
export function markSpotFull(id: string, now = Date.now()): Set<string> {
  const until = now + TTL_MS
  const others = readEntries().filter((e) => e.until > now && e.id !== id)
  others.push({ id, until })
  writeEntries(others)
  return new Set(others.map((e) => e.id))
}

/** Clear a single mark (optional helper). */
export function clearSpotFull(id: string, now = Date.now()): Set<string> {
  const fresh = readEntries().filter((e) => e.until > now && e.id !== id)
  writeEntries(fresh)
  return new Set(fresh.map((e) => e.id))
}
