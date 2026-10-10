import type { Locale } from './types'
import { tKey } from './runtime'

/** Known API / client error codes → message keys under `api.*`. */
const CODE_TO_KEY: Record<string, string> = {
  INVALID_ZONE: 'api.INVALID_ZONE',
  TOO_LONG: 'api.TOO_LONG',
  END_BEFORE_START: 'api.END_BEFORE_START',
  RATE_LIMITED: 'api.RATE_LIMITED',
  UNAUTHORIZED: 'api.UNAUTHORIZED',
  NOT_FOUND: 'api.NOT_FOUND',
  SERVER_ERROR: 'api.SERVER_ERROR',
  NETWORK_ERROR: 'api.NETWORK_ERROR',
  VALIDATION_ERROR: 'api.VALIDATION_ERROR',
  UNKNOWN: 'api.UNKNOWN',
  TSOON_PUUDUB: 'api.TSOON_PUUDUB',
  VIGANE_PARING: 'api.VIGANE_PARING',
}

/** Map common Estonian server phrases to codes when `code` is absent. */
function inferCodeFromEtMessage(message: string): string | null {
  const m = message.trim().toLowerCase()
  if (m.includes('tsoon puudub')) return 'TSOON_PUUDUB'
  if (m.includes('vigane päring')) return 'VIGANE_PARING'
  if (m.includes('ühendus ebaõnnestus') || m.includes('kontrolli võrku')) {
    return 'NETWORK_ERROR'
  }
  if (m.includes('autentimine')) return 'UNAUTHORIZED'
  if (m.includes('ei leitud') || m.includes('not found')) return 'NOT_FOUND'
  if (m.includes('liiga palju')) return 'RATE_LIMITED'
  return null
}

/**
 * Show server `message` only when UI language is Estonian.
 * Otherwise prefer translation by `code`, then inferred code, then generic.
 */
export function resolveApiError(
  locale: Locale,
  opts: { message?: string | null; code?: string | null },
): string {
  const code = (opts.code || '').trim().toUpperCase()
  const msg = (opts.message || '').trim()

  if (locale === 'et' && msg) return msg

  if (code && CODE_TO_KEY[code]) {
    return tKey(CODE_TO_KEY[code] as 'api.UNKNOWN', undefined, locale)
  }

  const inferred = msg ? inferCodeFromEtMessage(msg) : null
  if (inferred && CODE_TO_KEY[inferred]) {
    return tKey(CODE_TO_KEY[inferred] as 'api.UNKNOWN', undefined, locale)
  }

  if (locale === 'et' && msg) return msg
  return tKey('api.UNKNOWN', undefined, locale)
}
