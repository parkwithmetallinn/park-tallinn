export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'parkvibe_theme'

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolve initial theme: saved override → system preference → light. */
export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return systemPrefersDark() ? 'dark' : 'light'
}

export function persistTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function applyDocumentTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('map-dark', mode === 'dark')
  root.style.colorScheme = mode
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', mode === 'dark' ? '#12161c' : '#F2F4F7')
  }
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark'
}
