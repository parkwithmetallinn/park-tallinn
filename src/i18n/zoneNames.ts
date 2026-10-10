import { tKey } from './runtime'
import type { Locale } from './types'

const ZONE_KEYS: Record<
  string,
  { nameKey: string; glossKey: string }
> = {
  VANALINN: { nameKey: 'zones.vanalinn', glossKey: 'zones.vanalinnGloss' },
  SÜDALINN: { nameKey: 'zones.sydalinn', glossKey: 'zones.sydalinnGloss' },
  SYDALINN: { nameKey: 'zones.sydalinn', glossKey: 'zones.sydalinnGloss' },
  KESKLINN: { nameKey: 'zones.kesklinn', glossKey: 'zones.kesklinnGloss' },
  PIRITA: { nameKey: 'zones.pirita', glossKey: 'zones.piritaGloss' },
}

/**
 * Official zone names stay in Estonian (Vanalinn, …).
 * For en/ru, append a short gloss in parentheses when available.
 */
export function zoneDisplayName(
  codeOrName: string,
  locale: Locale,
): string {
  const raw = codeOrName.trim()
  if (!raw) return raw
  const upper = raw.toUpperCase()
  const entry =
    ZONE_KEYS[upper] ||
    Object.values(ZONE_KEYS).find(
      (z) => tKey(z.nameKey, undefined, 'et').toLowerCase() === raw.toLowerCase(),
    )
  if (!entry) return raw

  const official = tKey(entry.nameKey, undefined, 'et')
  if (locale === 'et') return official

  const gloss = tKey(entry.glossKey, undefined, locale).trim()
  return gloss ? `${official} (${gloss})` : official
}
