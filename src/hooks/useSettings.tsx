import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  applyAnimationsFlag,
  loadAppSettings,
  resolveMapTheme,
  saveAppSettings,
  setDistanceUnits,
  type AppSettings,
  type MapStyleSetting,
} from '../lib/appSettings'
import { applyDocumentTheme, type ThemeMode } from '../lib/theme'
import { useI18n, type Locale } from '../i18n'

type SettingsContextValue = {
  settings: AppSettings
  theme: ThemeMode
  updateSettings: (patch: Partial<AppSettings>) => void
  setMapStyle: (style: MapStyleSetting) => void
  setLanguage: (locale: Locale) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useI18n()
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings())
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  const theme = useMemo(
    () => resolveMapTheme(settings.mapStyle, systemDark),
    [settings.mapStyle, systemDark],
  )

  // Listen for system theme when map style is automatic
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const onChange = () => setSystemDark(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Apply theme, units, animations whenever settings change
  useEffect(() => {
    applyDocumentTheme(theme)
    setDistanceUnits(settings.units)
    applyAnimationsFlag(settings.animations)
  }, [theme, settings.units, settings.animations])

  // Sync language selector → i18n
  useEffect(() => {
    if (settings.language !== locale) {
      setLocale(settings.language)
    }
  }, [settings.language, locale, setLocale])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveAppSettings(next)
      return next
    })
  }, [])

  const setMapStyle = useCallback(
    (style: MapStyleSetting) => updateSettings({ mapStyle: style }),
    [updateSettings],
  )

  const setLanguage = useCallback(
    (language: Locale) => {
      updateSettings({ language })
      setLocale(language)
    },
    [updateSettings, setLocale],
  )

  const value = useMemo(
    () => ({
      settings,
      theme,
      updateSettings,
      setMapStyle,
      setLanguage,
    }),
    [settings, theme, updateSettings, setMapStyle, setLanguage],
  )

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return ctx
}
