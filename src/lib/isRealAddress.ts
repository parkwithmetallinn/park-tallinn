/**
 * Detect whether a string is a usable street address vs a zone code / title echo.
 */

/** Zone-style codes: EP56, Zone EP56, Tsoon X127, … */
const ZONE_CODE_RE = /^(zone|zoon|tsoon)?\s*[A-ZÄÖÜÕ]{1,3}\d+[A-ZÄÖÜÕ0-9]*$/i

/** Bare operator / layer placeholders that are not addresses. */
const NON_ADDRESS_LABELS = new Set([
  'surface',
  'underground',
  'multi-storey',
  'multi_storey',
  'tänav',
  'tanav',
  'parkla',
  'free',
  'zone',
  'paid',
  'kell',
  'ep',
  'sn',
  'sb',
  'cp',
  'ut',
])

export function isZoneCodeLike(value: string): boolean {
  const t = value.trim()
  if (!t) return false
  if (ZONE_CODE_RE.test(t)) return true
  if (/^(zone|tsoon|zoon)\s+/i.test(t) && /[A-ZÄÖÜÕ]{1,3}\d+/i.test(t)) {
    return true
  }
  return false
}

/**
 * True when `candidate` looks like a real street address, not a zone/name echo.
 */
export function isRealAddress(
  candidate: string | null | undefined,
  opts?: { name?: string | null; code?: string | null },
): boolean {
  const a = (candidate ?? '').trim()
  if (!a) return false
  if (isZoneCodeLike(a)) return false

  const lower = a.toLowerCase()
  if (NON_ADDRESS_LABELS.has(lower)) return false

  const name = (opts?.name ?? '').trim()
  if (name && lower === name.toLowerCase()) return false

  const code = (opts?.code ?? '').trim()
  if (code && lower === code.toLowerCase()) return false
  if (code && lower === `zone ${code}`.toLowerCase()) return false
  if (code && lower === `tsoon ${code}`.toLowerCase()) return false

  // Must contain a letter (street / place) — reject pure digits / punctuation
  if (!/[A-Za-zÄÖÜÕäöüõŠšŽž]/.test(a)) return false

  return true
}
