import { normalizeSpot } from './geojson'
import type { ActiveParkingSession } from './parkingSession'
import type { ParkingSpot } from '../types'

const STORAGE_KEY = 'park_tallinn_custom_spots'
const CAR_NUMBER_KEY = 'park_tallinn_car_number'
const ACTIVE_SESSION_KEY = 'park_tallinn_active_session'
const TIMER_STATE_KEY = 'park_tallinn_timer_state'

export type TimerMode = 'elapsed' | 'prepaid'

/** Persisted timer — prepaid uses absolute endsAt so reload restores countdown. */
export type ParkingTimerState = {
  mode: TimerMode
  /** ISO timestamp when prepaid countdown reaches 0 */
  endsAt?: string | null
}

export function loadCustomSpots(): ParkingSpot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ParkingSpot[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((s) => normalizeSpot(s))
  } catch {
    return []
  }
}

export function saveCustomSpot(spot: ParkingSpot): void {
  const existing = loadCustomSpots()
  existing.push(normalizeSpot(spot))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
}

export function loadCarNumber(): string {
  try {
    return localStorage.getItem(CAR_NUMBER_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function saveCarNumber(value: string): void {
  try {
    localStorage.setItem(CAR_NUMBER_KEY, value.trim().toUpperCase())
  } catch {
    /* ignore */
  }
}

export function loadActiveSession(): ActiveParkingSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveParkingSession
    if (!parsed?.carNumber || !parsed?.zone) return null
    return parsed
  } catch {
    return null
  }
}

export function saveActiveSession(session: ActiveParkingSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(ACTIVE_SESSION_KEY)
      return
    }
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

export function loadTimerState(): ParkingTimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ParkingTimerState
    if (parsed?.mode !== 'elapsed' && parsed?.mode !== 'prepaid') return null
    return parsed
  } catch {
    return null
  }
}

export function saveTimerState(state: ParkingTimerState | null): void {
  try {
    if (!state) {
      localStorage.removeItem(TIMER_STATE_KEY)
      return
    }
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/** Remaining prepaid seconds from absolute endsAt (0 if past). */
export function prepaidSecondsRemaining(endsAt?: string | null): number {
  if (!endsAt) return 0
  const endMs = Date.parse(endsAt)
  if (!Number.isFinite(endMs)) return 0
  return Math.max(0, Math.floor((endMs - Date.now()) / 1000))
}
