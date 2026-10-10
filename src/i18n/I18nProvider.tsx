import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Locale, MessageTree } from './types'
import { LOCALES } from './types'
import {
  getDict,
  persistLocale,
  resolveInitialLocale,
  setRuntimeLocale,
  tKey,
} from './runtime'
import { formatDateTime, formatHourlyRate, formatMoney } from './format'
import { resolveApiError } from './apiErrors'
import { zoneDisplayName } from './zoneNames'

type Params = Record<string, string | number>

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Params) => string
  dict: MessageTree
  formatDateTime: (
    value: string | Date | number | undefined | null,
    opts?: Intl.DateTimeFormatOptions,
  ) => string
  formatMoney: (amount: number, currency?: string) => string
  formatHourlyRate: (rate: number | undefined) => string
  resolveApiError: (opts: {
    message?: string | null
    code?: string | null
  }) => string
  zoneName: (codeOrName: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function applyHtmlLang(locale: Locale): void {
  try {
    document.documentElement.lang = locale
  } catch {
    /* ignore */
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale())

  useEffect(() => {
    setRuntimeLocale(locale)
    applyHtmlLang(locale)
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if (!(LOCALES as string[]).includes(next)) return
    setLocaleState(next)
    persistLocale(next)
    setRuntimeLocale(next)
    applyHtmlLang(next)
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    setRuntimeLocale(locale)
    return {
      locale,
      setLocale,
      t: (key, params) => tKey(key, params, locale),
      dict: getDict(locale),
      formatDateTime: (v, opts) => formatDateTime(v, locale, opts),
      formatMoney: (amount, currency) => formatMoney(amount, locale, currency),
      formatHourlyRate: (rate) => formatHourlyRate(rate, locale),
      resolveApiError: (opts) => resolveApiError(locale, opts),
      zoneName: (codeOrName) => zoneDisplayName(codeOrName, locale),
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}
