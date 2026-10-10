/**
 * Tallinn paid street parking: price ESTIMATE for the four city zones.
 *
 * Tariffs checked 2026-10-09 against https://www.tallinn.ee/en/services/parking-arrangement
 * (per-minute prices and paid hours) and the operators' mobile-parking pages (free period).
 * Re-check those pages before changing a number. There is no daily maximum in the city tariff.
 *
 * Rules implemented
 *  - Billing per started minute; money is counted in integer thousandths of a euro and rounded
 *    half-up to the cent only once, at the end (no floating point drift).
 *  - A minute is charged only inside the zone's paid hours (Europe/Tallinn local time).
 *  - The first 15 minutes of the session are free when the start time was marked
 *    (parking clock / note). Charging starts after them (they are NOT charged afterwards).
 *    The free period runs from the start of the session, also when the session starts before
 *    paid hours begin.
 *  - Public holidays follow the weekday tariff (free only if the holiday is a Sunday), so no
 *    holiday table is needed.
 * Not included: mobile-parking service fee (about 0.5 EUR per start), private car parks.
 */

export const TARIFF_CHECKED_AT = '2026-10-09'
export const TIME_ZONE = 'Europe/Tallinn'
export const MAX_DURATION_MINUTES = 7 * 24 * 60

export type ZoneCode = 'VANALINN' | 'SÜDALINN' | 'KESKLINN' | 'PIRITA'

interface TimeWindow {
  /** Local weekdays, 0 = Sunday ... 6 = Saturday */
  days: readonly number[]
  /** Minutes after local midnight: from (inclusive) to (exclusive) */
  from: number
  to: number
}

interface ZoneTariff {
  name: string
  /** Thousandths of a euro per started minute (0.025 EUR = 25) */
  milliPerMinute: number
  freeMinutes: number
  windows: readonly TimeWindow[]
  /** Yearly season, both ends inclusive, as [month, day] */
  season?: { from: readonly [number, number]; to: readonly [number, number] }
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const
const ALL_DAY = { from: 0, to: 24 * 60 } as const

export const TARIFFS: Record<ZoneCode, ZoneTariff> = {
  VANALINN: {
    name: 'Vanalinn',
    milliPerMinute: 100, // 0.10 EUR/min = 6.00 EUR/h, 24/7
    freeMinutes: 15,
    windows: [{ days: EVERY_DAY, ...ALL_DAY }],
  },
  SÜDALINN: {
    name: 'Südalinn',
    milliPerMinute: 80, // 0.08 EUR/min = 4.80 EUR/h, 24/7
    freeMinutes: 15,
    windows: [{ days: EVERY_DAY, ...ALL_DAY }],
  },
  KESKLINN: {
    name: 'Kesklinn',
    milliPerMinute: 25, // 0.025 EUR/min = 1.50 EUR/h
    freeMinutes: 15,
    windows: [
      { days: [1, 2, 3, 4, 5], from: 7 * 60, to: 19 * 60 }, // Mon-Fri 07-19
      { days: [6], from: 8 * 60, to: 15 * 60 }, // Sat 08-15, Sunday free
    ],
  },
  PIRITA: {
    name: 'Pirita',
    milliPerMinute: 10, // 0.01 EUR/min = 0.60 EUR/h
    freeMinutes: 15,
    windows: [{ days: EVERY_DAY, from: 10 * 60, to: 22 * 60 }], // 10-22
    season: { from: [5, 15], to: [9, 15] }, // 15 May - 15 Sep
  },
}

export type PriceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_ZONE'
  | 'INVALID_TIME'
  | 'END_BEFORE_START'
  | 'TOO_LONG'

export interface PriceInput {
  zone: unknown
  startTime: unknown
  endTime: unknown
  /** Was the start time marked (parking clock / note)? Default true. */
  startMarked?: unknown
}

export interface PriceQuote {
  zone: ZoneCode
  currency: 'EUR'
  startTime: string
  endTime: string
  /** Started minutes of the whole session */
  durationMinutes: number
  /** Minutes outside the zone's paid hours */
  unchargedMinutes: number
  /** Paid-hour minutes waived by the free-minutes rule */
  freeMinutesUsed: number
  /** Minutes that are actually charged. durationMinutes = uncharged + freeUsed + billable */
  billableMinutes: number
  ratePerMinute: number
  hourlyRate: number
  totalPriceCents: number
  totalPrice: number
  totalPriceFormatted: string
  assumptions: {
    startMarked: boolean
    freeMinutes: number
    billing: 'per started minute'
    rounding: 'half-up to the cent'
    timeZone: typeof TIME_ZONE
    tariffCheckedAt: typeof TARIFF_CHECKED_AT
  }
  notes: string[]
}

export type PriceResult =
  | { ok: true; quote: PriceQuote }
  | { ok: false; code: PriceErrorCode; message: string }

const fail = (code: PriceErrorCode, message: string): PriceResult => ({ ok: false, code, message })

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/** Parse an ISO-8601 instant. The offset (Z or +hh:mm) is mandatory. */
function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = ISO_RE.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [
    number, number, number, number, number, number,
  ]
  if (h > 23 || mi > 59 || s > 59) return null
  const cal = new Date(Date.UTC(y, mo - 1, d))
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function normalizeZone(input: unknown): ZoneCode | null {
  if (typeof input !== 'string') return null
  const z = input.trim().toUpperCase().replace(/^SUU?DALINN$/, 'SÜDALINN')
  return Object.prototype.hasOwnProperty.call(TARIFFS, z) ? (z as ZoneCode) : null
}

const offsetFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** Europe/Tallinn UTC offset in minutes for the UTC hour containing `ms` (DST changes on the hour). */
function makeOffsetLookup(): (ms: number) => number {
  const cache = new Map<number, number>()
  return (ms: number): number => {
    const hour = Math.floor(ms / 3_600_000)
    const cached = cache.get(hour)
    if (cached !== undefined) return cached
    const t = hour * 3_600_000
    const p: Record<string, number> = {}
    for (const part of offsetFormat.formatToParts(t)) {
      if (part.type !== 'literal') p[part.type] = Number(part.value)
    }
    const offset =
      (Date.UTC(p.year as number, (p.month as number) - 1, p.day as number, p.hour as number, p.minute as number, p.second as number) - t) /
      60_000
    cache.set(hour, offset)
    return offset
  }
}

function isPaidMinute(zone: ZoneTariff, local: Date): boolean {
  if (zone.season) {
    const md = (local.getUTCMonth() + 1) * 100 + local.getUTCDate()
    const from = zone.season.from[0] * 100 + zone.season.from[1]
    const to = zone.season.to[0] * 100 + zone.season.to[1]
    if (md < from || md > to) return false
  }
  const day = local.getUTCDay()
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  return zone.windows.some((w) => w.days.includes(day) && minutes >= w.from && minutes < w.to)
}

const formatEuro = (cents: number): string => `${(cents / 100).toFixed(2).replace('.', ',')} €`

export function calculatePrice(input: PriceInput): PriceResult {
  const zoneCode = normalizeZone(input.zone)
  if (!zoneCode) return fail('INVALID_ZONE', 'Tundmatu tsoon (Vanalinn, Südalinn, Kesklinn või Pirita)')

  if (input.startMarked !== undefined && typeof input.startMarked !== 'boolean') {
    return fail('INVALID_INPUT', 'startMarked peab olema true või false')
  }
  const startMarked = input.startMarked !== false

  const startMs = parseInstant(input.startTime)
  const endMs = parseInstant(input.endTime)
  if (startMs === null || endMs === null) {
    return fail('INVALID_TIME', 'Aeg peab olema ISO 8601 kujul koos ajavööndiga, nt 2026-10-09T10:00:00+03:00')
  }
  const year = new Date(startMs).getUTCFullYear()
  if (year < 2000 || year > 2100) return fail('INVALID_TIME', 'Aeg on lubatud vahemikust väljas')
  if (endMs < startMs) return fail('END_BEFORE_START', 'Lõppaeg on enne algusaega')

  const durationMinutes = Math.ceil((endMs - startMs) / 60_000)
  if (durationMinutes > MAX_DURATION_MINUTES) {
    return fail('TOO_LONG', 'Hinnangut arvutatakse kuni 7 ööpäeva pikkusele parkimisele')
  }

  const zone = TARIFFS[zoneCode]
  const offsetOf = makeOffsetLookup()
  let unchargedMinutes = 0
  let freeMinutesUsed = 0
  let billableMinutes = 0
  for (let i = 0; i < durationMinutes; i++) {
    const instant = startMs + i * 60_000
    const local = new Date(instant + offsetOf(instant) * 60_000)
    if (!isPaidMinute(zone, local)) unchargedMinutes++
    else if (startMarked && i < zone.freeMinutes) freeMinutesUsed++
    else billableMinutes++
  }

  const milli = billableMinutes * zone.milliPerMinute
  const totalPriceCents = Math.floor((milli + 5) / 10)

  const notes = [
    'See on hinnang, mitte arve. Lõplik tasu sõltub parkimisoperaatorist.',
    'Mobiilse parkimise teenustasu (umbes 0,5 € alustamise kohta) ei ole arvestatud.',
  ]
  if (startMarked) {
    notes.push('15 tasuta minutit kehtib ainult siis, kui parkimise algusaeg on märgitud (parkimiskell või paber).')
  }

  return {
    ok: true,
    quote: {
      zone: zoneCode,
      currency: 'EUR',
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      durationMinutes,
      unchargedMinutes,
      freeMinutesUsed,
      billableMinutes,
      ratePerMinute: zone.milliPerMinute / 1000,
      hourlyRate: (zone.milliPerMinute * 60) / 1000,
      totalPriceCents,
      totalPrice: totalPriceCents / 100,
      totalPriceFormatted: formatEuro(totalPriceCents),
      assumptions: {
        startMarked,
        freeMinutes: zone.freeMinutes,
        billing: 'per started minute',
        rounding: 'half-up to the cent',
        timeZone: TIME_ZONE,
        tariffCheckedAt: TARIFF_CHECKED_AT,
      },
      notes,
    },
  }
}
