/**
 * Re-export local favorites / Home / Work manager.
 * Canonical implementation: src/utils/favorites.ts
 */

export {
  addFavorite,
  clearFavorites,
  clearHome,
  clearSavedPlace,
  clearWork,
  FAVORITES_CHANGE_EVENT,
  FAVORITES_STORAGE_KEY,
  getFavorites,
  getHome,
  getSavedPlace,
  getWork,
  HOME_STORAGE_KEY,
  isFavorite,
  PLACES_CHANGE_EVENT,
  removeFavorite,
  setFavorites,
  setHome,
  setSavedPlace,
  setWork,
  toggleFavorite,
  WORK_STORAGE_KEY,
  type SavedPlace,
  type SavedPlaceKind,
} from '../utils/favorites'
