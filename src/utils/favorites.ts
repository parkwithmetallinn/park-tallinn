/**
 * Local Favorites + Home / Work places — 100% client-side.
 * Backed by browser localStorage (works in Capacitor WebView with no network).
 *
 * Keys (do not rename — existing installs keep favorites):
 *   parkvibe_favorites — string[] of parking lot ids
 *   parkvibe_home / parkvibe_work — SavedPlace JSON
 */

export const FAVORITES_STORAGE_KEY = 'parkvibe_favorites'
export const HOME_STORAGE_KEY = 'parkvibe_home'
export const WORK_STORAGE_KEY = 'parkvibe_work'

/** Fired on same-tab changes so React hooks can re-read. */
export const FAVORITES_CHANGE_EVENT = 'parkvibe:favorites-change'
export const PLACES_CHANGE_EVENT = 'parkvibe:places-change'

export type SavedPlaceKind = 'home' | 'work'

export type SavedPlace = {
  lat: number
  lng: number
  /** Short label (e.g. street / POI name). */
  name: string
  /** Full address line when available. */
  address: string
  updatedAt: number
}

function notifyFavorites(): void {
  try {
    window.dispatchEvent(new Event(FAVORITES_CHANGE_EVENT))
  } catch {
    /* SSR / non-browser */
  }
}

function notifyPlaces(): void {
  try {
    window.dispatchEvent(new Event(PLACES_CHANGE_EVENT))
  } catch {
    /* SSR / non-browser */
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode */
  }
}

// ── Favorites (parking lot IDs) ─────────────────────────────────────────────

function readFavoriteIds(): string[] {
  const parsed = readJson<unknown>(FAVORITES_STORAGE_KEY)
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
}

function writeFavoriteIds(ids: string[]): void {
  writeJson(FAVORITES_STORAGE_KEY, ids)
  notifyFavorites()
}

/** All saved parking IDs (insertion order, newest last). */
export function getFavorites(): string[] {
  return readFavoriteIds()
}

export function isFavorite(id: string): boolean {
  const key = String(id ?? '').trim()
  if (!key) return false
  return readFavoriteIds().includes(key)
}

/** Toggle favorite; returns the updated id list. */
export function toggleFavorite(id: string): string[] {
  const key = String(id ?? '').trim()
  if (!key) return readFavoriteIds()
  const current = readFavoriteIds()
  const next = current.includes(key)
    ? current.filter((x) => x !== key)
    : [...current, key]
  writeFavoriteIds(next)
  return next
}

export function addFavorite(id: string): string[] {
  const key = String(id ?? '').trim()
  if (!key) return readFavoriteIds()
  const current = readFavoriteIds()
  if (current.includes(key)) return current
  const next = [...current, key]
  writeFavoriteIds(next)
  return next
}

export function removeFavorite(id: string): string[] {
  const key = String(id ?? '').trim()
  if (!key) return readFavoriteIds()
  const next = readFavoriteIds().filter((x) => x !== key)
  writeFavoriteIds(next)
  return next
}

export function clearFavorites(): void {
  writeFavoriteIds([])
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
  writeFavoriteIds(next)
}

// ── Home / Work ─────────────────────────────────────────────────────────────

function placeKey(kind: SavedPlaceKind): string {
  return kind === 'home' ? HOME_STORAGE_KEY : WORK_STORAGE_KEY
}

function parsePlace(raw: unknown): SavedPlace | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const lat = Number(o.lat)
  const lng = Number(o.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const name = String(o.name ?? '').trim() || 'Koht'
  const address = String(o.address ?? o.label ?? '').trim()
  const updatedAt = Number(o.updatedAt)
  return {
    lat,
    lng,
    name,
    address,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

export function getSavedPlace(kind: SavedPlaceKind): SavedPlace | null {
  return parsePlace(readJson(placeKey(kind)))
}

export function getHome(): SavedPlace | null {
  return getSavedPlace('home')
}

export function getWork(): SavedPlace | null {
  return getSavedPlace('work')
}

export function setSavedPlace(
  kind: SavedPlaceKind,
  place: {
    lat: number
    lng: number
    name?: string
    address?: string
    label?: string
  },
): SavedPlace {
  const next: SavedPlace = {
    lat: place.lat,
    lng: place.lng,
    name: String(place.name ?? '').trim() || (kind === 'home' ? 'Kodu' : 'Töö'),
    address: String(place.address ?? place.label ?? '').trim(),
    updatedAt: Date.now(),
  }
  writeJson(placeKey(kind), next)
  notifyPlaces()
  return next
}

export function setHome(place: {
  lat: number
  lng: number
  name?: string
  address?: string
  label?: string
}): SavedPlace {
  return setSavedPlace('home', place)
}

export function setWork(place: {
  lat: number
  lng: number
  name?: string
  address?: string
  label?: string
}): SavedPlace {
  return setSavedPlace('work', place)
}

export function clearSavedPlace(kind: SavedPlaceKind): void {
  writeJson(placeKey(kind), null)
  notifyPlaces()
}

export function clearHome(): void {
  clearSavedPlace('home')
}

export function clearWork(): void {
  clearSavedPlace('work')
}
