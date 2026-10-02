export type ThemeMode = 'light' | 'dark'

/**
 * Versioned theme preference. Only set when the user taps the toggle.
 * Keep in sync with the inline boot script in index.html.
 */
export const THEME_STORAGE_KEY = 'parktallinn:theme:v2'

/** Pre-v2 keys — cleared so auto-dark users reset to light once. */
const LEGACY_THEME_KEYS = ['parkvibe_theme'] as const

function clearLegacyThemeKeys(): void {
  try {
    for (const key of LEGACY_THEME_KEYS) {
      localStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Initial theme: explicit v2 preference only → otherwise always light.
 * Does NOT follow prefers-color-scheme.
 */
export function getInitialTheme(): ThemeMode {
  clearLegacyThemeKeys()
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'light'
}

/** Persist only after an explicit user toggle. */
export function persistTheme(mode: ThemeMode) {
  clearLegacyThemeKeys()
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/** Single DOM applicator: html class, color-scheme, theme-color meta. */
export function applyDocumentTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('map-dark', mode === 'dark')
  root.dataset.theme = mode
  root.style.colorScheme = mode
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', mode === 'dark' ? '#12161c' : '#F2F4F7')
  }
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark'
}
