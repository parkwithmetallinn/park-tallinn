import { et } from './et'
import { en } from './en'
import { ru } from './ru'
import { getMessageAt } from './flatten'
import type { Locale, MessageTree } from './types'
import { LOCALE_STORAGE_KEY, LOCALES } from './types'

const DICTS: Record<Locale, MessageTree> = { et, en, ru }

let currentLocale: Locale = 'et'

export function getLocale(): Locale {
  return currentLocale
}

export function setRuntimeLocale(locale: Locale): void {
  currentLocale = locale
}

export function detectDeviceLocale(): Locale {
  try {
    const raw = (
      typeof navigator !== 'undefined'
        ? navigator.language || (navigator as { userLanguage?: string }).userLanguage
        : ''
    )
      ?.toLowerCase()
      .trim()
    if (!raw) return 'et'
    if (raw.startsWith('et')) return 'et'
    if (raw.startsWith('ru')) return 'ru'
    if (raw.startsWith('en')) return 'en'
  } catch {
    /* ignore */
  }
  return 'et'
}

export function loadStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (raw && (LOCALES as string[]).includes(raw)) return raw as Locale
  } catch {
    /* private mode */
  }
  return null
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

export function resolveInitialLocale(): Locale {
  return loadStoredLocale() ?? detectDeviceLocale()
}

type Params = Record<string, string | number>

function applyParams(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] != null ? String(params[k]) : `{${k}}`,
  )
}

/** Translate by dotted key; falls back to Estonian then the key. */
export function tKey(
  key: string,
  params?: Params,
  locale: Locale = currentLocale,
): string {
  const primary = getMessageAt(DICTS[locale], key)
  if (primary) return applyParams(primary, params)
  const fallback = getMessageAt(et, key)
  if (fallback) return applyParams(fallback, params)
  return key
}

export function getDict(locale: Locale = currentLocale): MessageTree {
  return DICTS[locale]
}
