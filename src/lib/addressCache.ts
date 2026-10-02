/**
 * In-memory + localStorage cache for resolved parking spot addresses.
 * Versioned key + ~30 day TTL.
 */

export type CachedAddress = {
  address: string
  source: 'source' | 'inaks' | 'nominatim' | 'photon' | 'missing'
  savedAt: number
}

const VERSION = 'v1'
const STORAGE_KEY = `park_tallinn_spot_addresses_${VERSION}`
const TTL_MS = 30 * 24 * 60 * 60 * 1000

const memory = new Map<string, CachedAddress>()

function readStore(): Record<string, CachedAddress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, CachedAddress>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, CachedAddress>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

function isFresh(entry: CachedAddress | undefined): entry is CachedAddress {
  if (!entry?.address || !entry.savedAt) return false
  return Date.now() - entry.savedAt < TTL_MS
}

const MISSING_MEMORY_TTL_MS = 60_000

export function getCachedAddress(featureId: string): CachedAddress | null {
  const mem = memory.get(featureId)
  if (mem?.source === 'missing') {
    // Brief in-memory negative cache only — never treat as durable
    if (Date.now() - mem.savedAt < MISSING_MEMORY_TTL_MS) return mem
    memory.delete(featureId)
  } else if (isFresh(mem)) {
    return mem
  }

  const store = readStore()
  const disk = store[featureId]
  if (disk?.source === 'missing') {
    delete store[featureId]
    writeStore(store)
  } else if (isFresh(disk)) {
    memory.set(featureId, disk)
    return disk
  }
  if (disk && !isFresh(disk)) {
    delete store[featureId]
    writeStore(store)
  }
  if (mem && !isFresh(mem)) memory.delete(featureId)
  return null
}

export function setCachedAddress(
  featureId: string,
  address: string,
  source: CachedAddress['source'],
): void {
  const entry: CachedAddress = { address, source, savedAt: Date.now() }
  memory.set(featureId, entry)
  // Do not persist transient "missing" failures for 30 days — memory-only, short lived.
  if (source === 'missing') return
  const store = readStore()
  store[featureId] = entry
  // Prune expired opportunistically
  const now = Date.now()
  for (const [id, v] of Object.entries(store)) {
    if (now - (v?.savedAt ?? 0) >= TTL_MS) delete store[id]
  }
  writeStore(store)
}
