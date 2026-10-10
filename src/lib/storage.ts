import { normalizeSpot } from './geojson'
import type { ActiveParkingSession } from './parkingSession'
import type { ParkingSpot } from '../types'

const STORAGE_KEY = 'park_tallinn_custom_spots'
/** @deprecated Plate UI removed — kept only so cleanup can target the old key. */
const CAR_NUMBER_KEY = 'park_tallinn_car_number'
const ACTIVE_SESSION_KEY = 'park_tallinn_active_session'
const TIMER_STATE_KEY = 'park_tallinn_timer_state'

/**
 * One-time privacy cleanup: drop legacy license-plate localStorage keys.
 * Does not touch favorites, myPins hint, or master cache meta.
 */
export function clearLegacyPlateStorage(): void {
  try {
    localStorage.removeItem(CAR_NUMBER_KEY)
  } catch {
    /* private mode / quota */
  }
  try {
    sessionStorage.removeItem(CAR_NUMBER_KEY)
  } catch {
    /* ignore */
  }
}

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

export function loadActiveSession(): ActiveParkingSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveParkingSession & {
      carNumber?: string
    }
    const zone = String(parsed?.zone ?? '').trim()
    if (!zone) return null
    // Drop legacy plate field if present in older snapshots
    return {
      zone,
      spotName: parsed.spotName,
      startedAt: parsed.startedAt,
      status: parsed.status || 'ACTIVE',
      hourlyRate: parsed.hourlyRate,
    }
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
    const clean: ActiveParkingSession = {
      zone: session.zone,
      spotName: session.spotName,
      startedAt: session.startedAt,
      status: session.status,
      hourlyRate: session.hourlyRate,
    }
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(clean))
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
