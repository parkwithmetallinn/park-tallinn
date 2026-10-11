import { useCallback, useSyncExternalStore } from 'react'
import {
  clearHome as clearHomeStorage,
  clearWork as clearWorkStorage,
  getHome,
  getWork,
  HOME_STORAGE_KEY,
  PLACES_CHANGE_EVENT,
  setHome as setHomeStorage,
  setWork as setWorkStorage,
  WORK_STORAGE_KEY,
  type SavedPlace,
} from '../utils/favorites'

function subscribe(onStoreChange: () => void): () => void {
  const onPlaces = () => onStoreChange()
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === HOME_STORAGE_KEY ||
      e.key === WORK_STORAGE_KEY ||
      e.key === null
    ) {
      onStoreChange()
    }
  }
  window.addEventListener(PLACES_CHANGE_EVENT, onPlaces)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PLACES_CHANGE_EVENT, onPlaces)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): string {
  return JSON.stringify({ home: getHome(), work: getWork() })
}

function getServerSnapshot(): string {
  return JSON.stringify({ home: null, work: null })
}

type Snapshot = { home: SavedPlace | null; work: SavedPlace | null }

function parseSnapshot(serialized: string): Snapshot {
  try {
    const parsed = JSON.parse(serialized) as Snapshot
    return {
      home: parsed?.home ?? null,
      work: parsed?.work ?? null,
    }
  } catch {
    return { home: null, work: null }
  }
}

/**
 * Reactive Home / Work places backed by localStorage (`parkvibe_home` / `parkvibe_work`).
 */
export function useSavedPlaces() {
  const serialized = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  const { home, work } = parseSnapshot(serialized)

  const setHome = useCallback(
    (place: {
      lat: number
      lng: number
      name?: string
      address?: string
      label?: string
    }) => setHomeStorage(place),
    [],
  )

  const setWork = useCallback(
    (place: {
      lat: number
      lng: number
      name?: string
      address?: string
      label?: string
    }) => setWorkStorage(place),
    [],
  )

  const clearHome = useCallback(() => clearHomeStorage(), [])
  const clearWork = useCallback(() => clearWorkStorage(), [])

  return { home, work, setHome, setWork, clearHome, clearWork }
}
