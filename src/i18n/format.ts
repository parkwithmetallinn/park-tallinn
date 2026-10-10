import type { Locale } from './types'
import { TALLINN_TZ } from './types'

const BCP47: Record<Locale, string> = {
  et: 'et-EE',
  en: 'en-GB',
  ru: 'ru-RU',
}

export function localeToBcp47(locale: Locale): string {
  return BCP47[locale] ?? 'et-EE'
}

export function formatDateTime(
  isoOrDate: string | Date | number | undefined | null,
  locale: Locale,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (isoOrDate == null) return ''
  const d =
    typeof isoOrDate === 'string' || typeof isoOrDate === 'number'
      ? new Date(isoOrDate)
      : isoOrDate
  if (Number.isNaN(d.getTime())) return String(isoOrDate)
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    timeZone: TALLINN_TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  }).format(d)
}

export function formatMoney(
  amount: number,
  locale: Locale,
  currency = 'EUR',
): string {
  if (!Number.isFinite(amount)) return ''
  return new Intl.NumberFormat(localeToBcp47(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatHourlyRate(rate: number | undefined, locale: Locale): string {
  if (rate == null || !Number.isFinite(rate)) return ''
  return `${formatMoney(rate, locale)}/h`
}
