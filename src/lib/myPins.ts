/**
 * Personal map pins ("Minu pinnid").
 *
 * Data is local-only on purpose — stored in this device's localStorage and
 * never sent to a server. Syncing across devices would require accounts and
 * a backend; that is intentionally out of scope.
 */

export type MyPinColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'gray'

export type MyPin = {
  id: string
  name: string
  note?: string
  lat: number
  lng: number
  color: MyPinColor
  address?: string
  createdAt: number
  updatedAt: number
}

export const MY_PINS_STORAGE_KEY = 'parking.myPins.v1'
export const MY_PINS_HINT_KEY = 'parking.myPins.hintSeen'
export const MY_PINS_MAX = 200

/** iOS-like palette for personal pins. */
export const MY_PIN_COLORS: Record<MyPinColor, string> = {
  red: '#FF3B30',
  orange: '#FF9500',
  yellow: '#FFCC00',
  green: '#34C759',
  blue: '#007AFF',
  purple: '#AF52DE',
  pink: '#FF2D55',
  gray: '#8E8E93',
}

export const MY_PIN_COLOR_KEYS = Object.keys(MY_PIN_COLORS) as MyPinColor[]

export type AddMyPinInput = {
  name: string
  note?: string
  lat: number
  lng: number
  color?: MyPinColor
  address?: string
}

export type MyPinWriteResult =
  | { ok: true; pins: MyPin[]; pin: MyPin; storageFailed?: boolean }
  | { ok: false; reason: 'quota' | 'storage' | 'invalid'; pins: MyPin[] }

let memoryPins: MyPin[] | null = null
let storageUnavailableToastShown = false

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isMyPinColor(v: unknown): v is MyPinColor {
  return typeof v === 'string' && v in MY_PIN_COLORS
}

function sanitizePin(raw: unknown): MyPin | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  if (!isFiniteCoord(o.lat) || !isFiniteCoord(o.lng)) return null
  if (o.lat < -90 || o.lat > 90 || o.lng < -180 || o.lng > 180) return null
  const name =
    typeof o.name === 'string' ? o.name.trim().slice(0, 60) : ''
  if (!name) return null
  const color: MyPinColor = isMyPinColor(o.color) ? o.color : 'red'
  const note =
    typeof o.note === 'string' && o.note.trim()
      ? o.note.trim().slice(0, 280)
      : undefined
  const address =
    typeof o.address === 'string' && o.address.trim()
      ? o.address.trim().slice(0, 200)
      : undefined
  const createdAt =
    typeof o.createdAt === 'number' && Number.isFinite(o.createdAt)
      ? o.createdAt
      : Date.now()
  const updatedAt =
    typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : createdAt
  return {
    id: o.id.trim(),
    name,
    note,
    lat: o.lat,
    lng: o.lng,
    color,
    address,
    createdAt,
    updatedAt,
  }
}

function readRaw(): MyPin[] {
  try {
    const raw = localStorage.getItem(MY_PINS_STORAGE_KEY)
    if (!raw) return memoryPins ?? []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return memoryPins ?? []
    const pins: MyPin[] = []
    for (const item of parsed) {
      const pin = sanitizePin(item)
      if (pin) pins.push(pin)
    }
    memoryPins = pins
    return pins
  } catch {
    return memoryPins ?? []
  }
}

/** Load pins from localStorage (validated). Falls back to in-memory session. */
export function loadMyPins(): MyPin[] {
  return readRaw().slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Persist the full pin list. Returns false when storage write failed
 * (private mode / quota) — pins remain in memory for the session.
 */
export function saveMyPins(pins: MyPin[]): boolean {
  const cleaned = pins
    .map((p) => sanitizePin(p))
    .filter((p): p is MyPin => Boolean(p))
    .slice(0, MY_PINS_MAX)
  memoryPins = cleaned
  try {
    localStorage.setItem(MY_PINS_STORAGE_KEY, JSON.stringify(cleaned))
    return true
  } catch {
    return false
  }
}

export function wasStorageUnavailableToastShown(): boolean {
  return storageUnavailableToastShown
}

export function markStorageUnavailableToastShown(): void {
  storageUnavailableToastShown = true
}

export function addMyPin(input: AddMyPinInput): MyPinWriteResult {
  const pins = loadMyPins()
  if (pins.length >= MY_PINS_MAX) {
    return { ok: false, reason: 'quota', pins }
  }
  const name = input.name.trim().slice(0, 60) || 'Minu pin'
  const now = Date.now()
  const pin: MyPin = {
    id: newId(),
    name,
    note: input.note?.trim().slice(0, 280) || undefined,
    lat: input.lat,
    lng: input.lng,
    color: input.color && isMyPinColor(input.color) ? input.color : 'red',
    address: input.address?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
  const next = [pin, ...pins]
  const saved = saveMyPins(next)
  return { ok: true, pins: next, pin, storageFailed: !saved }
}

export function updateMyPin(
  id: string,
  patch: Partial<
    Pick<MyPin, 'name' | 'note' | 'lat' | 'lng' | 'color' | 'address'>
  >,
): MyPinWriteResult {
  const pins = loadMyPins()
  const idx = pins.findIndex((p) => p.id === id)
  if (idx < 0) return { ok: false, reason: 'invalid', pins }
  const prev = pins[idx]
  const nextPin: MyPin = {
    ...prev,
    name:
      typeof patch.name === 'string'
        ? patch.name.trim().slice(0, 60) || prev.name
        : prev.name,
    note:
      patch.note === undefined
        ? prev.note
        : patch.note.trim()
          ? patch.note.trim().slice(0, 280)
          : undefined,
    lat: isFiniteCoord(patch.lat) ? patch.lat : prev.lat,
    lng: isFiniteCoord(patch.lng) ? patch.lng : prev.lng,
    color: isMyPinColor(patch.color) ? patch.color : prev.color,
    address:
      patch.address === undefined
        ? prev.address
        : patch.address.trim()
          ? patch.address.trim().slice(0, 200)
          : undefined,
    updatedAt: Date.now(),
  }
  const next = pins.slice()
  next[idx] = nextPin
  // Bump edited pin to top of z-order / list
  next.sort((a, b) => b.updatedAt - a.updatedAt)
  saveMyPins(next)
  return { ok: true, pins: next, pin: nextPin }
}

export function removeMyPin(id: string): { pins: MyPin[]; removed: boolean } {
  const pins = loadMyPins()
  const next = pins.filter((p) => p.id !== id)
  saveMyPins(next)
  return { pins: next, removed: next.length !== pins.length }
}

export function loadHintSeen(): boolean {
  try {
    return localStorage.getItem(MY_PINS_HINT_KEY) === '1'
  } catch {
    return false
  }
}

export function markHintSeen(): void {
  try {
    localStorage.setItem(MY_PINS_HINT_KEY, '1')
  } catch {
    /* ignore */
  }
}
