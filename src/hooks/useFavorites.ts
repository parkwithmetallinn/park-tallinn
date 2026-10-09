import { useCallback, useSyncExternalStore } from 'react'
import {
  clearFavorites as clearFavoritesStorage,
  FAVORITES_CHANGE_EVENT,
  FAVORITES_STORAGE_KEY,
  getFavorites,
  toggleFavorite as toggleFavoriteStorage,
} from '../lib/favorites'

function subscribe(onStoreChange: () => void): () => void {
  const onFav = () => onStoreChange()
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAVORITES_STORAGE_KEY || e.key === null) onStoreChange()
  }
  window.addEventListener(FAVORITES_CHANGE_EVENT, onFav)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(FAVORITES_CHANGE_EVENT, onFav)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): string {
  return JSON.stringify(getFavorites())
}

function getServerSnapshot(): string {
  return '[]'
}

function parseIds(serialized: string): string[] {
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((x) => String(x)).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Reactive favorites list backed by localStorage (`parkvibe_favorites`).
 */
export function useFavorites() {
  const serialized = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  const favoriteIds = parseIds(serialized)

  const isFavorite = useCallback(
    (id: string) => favoriteIds.includes(String(id ?? '').trim()),
    [favoriteIds],
  )

  const toggleFavorite = useCallback((id: string) => {
    return toggleFavoriteStorage(id)
  }, [])

  const clearFavorites = useCallback(() => {
    clearFavoritesStorage()
  }, [])

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    clearFavorites,
    count: favoriteIds.length,
  }
}
