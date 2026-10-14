/**
 * App-wide user preferences — single namespaced localStorage key.
 * No server sync; device-local only.
 */

import type { Locale } from '../i18n'
import { LOCALES } from '../i18n'
import { resolveInitialLocale } from '../i18n/runtime'
import {
  getInitialTheme,
  persistTheme,
  type ThemeMode,
} from './theme'

export const APP_SETTINGS_KEY = 'parking-app:settings'

/** Keep in sync with package.json "version". */
export const APP_VERSION = '0.0.0'

export type MapStyleSetting = 'light' | 'dark' | 'auto'
export type DistanceUnits = 'metric' | 'imperial'

export type AppSettings = {
  language: Locale
  mapStyle: MapStyleSetting
  units: DistanceUnits
  keepAwakeOnNav: boolean
  animations: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'et',
  mapStyle: 'light',
  units: 'metric',
  keepAwakeOnNav: false,
  animations: true,
}

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as string[]).includes(v)
}

function isMapStyle(v: unknown): v is MapStyleSetting {
  return v === 'light' || v === 'dark' || v === 'auto'
}

function isUnits(v: unknown): v is DistanceUnits {
  return v === 'metric' || v === 'imperial'
}

export function loadAppSettings(): AppSettings {
  const base: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    // Prefer existing i18n / theme prefs when settings key is absent
    language: resolveInitialLocale(),
    mapStyle: getInitialTheme(),
  }
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      language: isLocale(parsed.language) ? parsed.language : base.language,
      mapStyle: isMapStyle(parsed.mapStyle) ? parsed.mapStyle : base.mapStyle,
      units: isUnits(parsed.units) ? parsed.units : base.units,
      keepAwakeOnNav:
        typeof parsed.keepAwakeOnNav === 'boolean'
          ? parsed.keepAwakeOnNav
          : base.keepAwakeOnNav,
      animations:
        typeof parsed.animations === 'boolean'
          ? parsed.animations
          : base.animations,
    }
  } catch {
    return base
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* private mode / quota */
  }
  // Keep boot-script theme key in sync for light/dark (auto resolved at runtime)
  if (settings.mapStyle === 'light' || settings.mapStyle === 'dark') {
    persistTheme(settings.mapStyle)
  }
}

export function resolveMapTheme(
  mapStyle: MapStyleSetting,
  prefersDark?: boolean,
): ThemeMode {
  if (mapStyle === 'light') return 'light'
  if (mapStyle === 'dark') return 'dark'
  const dark =
    prefersDark ??
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? 'dark' : 'light'
}

/** Module-level units so formatDistance call sites stay unchanged. */
let activeUnits: DistanceUnits = 'metric'

export function getDistanceUnits(): DistanceUnits {
  return activeUnits
}

export function setDistanceUnits(units: DistanceUnits): void {
  activeUnits = units
}

export function applyAnimationsFlag(enabled: boolean): void {
  try {
    const root = document.documentElement
    if (enabled) {
      delete root.dataset.animations
    } else {
      root.dataset.animations = 'off'
    }
  } catch {
    /* ignore */
  }
}

export function animationsDisabled(): boolean {
  try {
    if (document.documentElement.dataset.animations === 'off') return true
  } catch {
    /* ignore */
  }
  return false
}
