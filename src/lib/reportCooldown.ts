/**
 * Client-side 5-minute cooldown after submitting a community report
 * for a given parking lot. Server rate limits remain the primary protection.
 */

const STORAGE_KEY = 'parktallinn:reportCooldown:v1'
const COOLDOWN_MS = 5 * 60 * 1000

type CooldownMap = Record<string, number>

function readMap(): CooldownMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CooldownMap
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function writeMap(map: CooldownMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota */
  }
}

function prune(map: CooldownMap, now: number): CooldownMap {
  const next: CooldownMap = {}
  for (const [id, until] of Object.entries(map)) {
    if (typeof until === 'number' && until > now) next[id] = until
  }
  return next
}

/** True when the user may submit another report for this parking id. */
export function canSubmitReport(parkingId: string, now = Date.now()): boolean {
  const id = parkingId.trim()
  if (!id) return false
  const map = prune(readMap(), now)
  writeMap(map)
  return !(map[id] && map[id]! > now)
}

/** Milliseconds remaining in the cooldown (0 if allowed). */
export function reportCooldownRemainingMs(
  parkingId: string,
  now = Date.now(),
): number {
  const id = parkingId.trim()
  if (!id) return 0
  const until = readMap()[id]
  if (typeof until !== 'number' || until <= now) return 0
  return until - now
}

/** Start / refresh the 5-minute cooldown after a successful submit. */
export function markReportSubmitted(
  parkingId: string,
  now = Date.now(),
): void {
  const id = parkingId.trim()
  if (!id) return
  const map = prune(readMap(), now)
  map[id] = now + COOLDOWN_MS
  writeMap(map)
}

export const REPORT_COOLDOWN_MS = COOLDOWN_MS
