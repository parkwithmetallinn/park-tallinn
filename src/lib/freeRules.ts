/**
 * Evaluate paid-zone freeRules → free now / free until.
 * Used by Pärnu (and future cities) — Tallinn rates stay in data/zones.ts.
 */

export type PaidWindow = {
  /** 0=Sun … 6=Sat (JS getDay) */
  days: number[]
  /** "HH:MM" local */
  start: string
  end: string
}

export type SeasonWindow = {
  startMonth: number
  startDay: number
  endMonth: number
  endDay: number
}

export type FreeRuleSet = {
  timezone: string
  paidWindows: PaidWindow[]
  /** When true, public holidays are free even inside paid windows */
  freeOnPublicHolidays: boolean
  /** If set, paid only inside this season; free outside */
  season: SeasonWindow | null
  discMinutes: number
}

export type FreeEval = {
  freeNow: boolean
  /** ISO timestamp when the current free period ends (or paid period ends if free via disc-only) */
  freeUntil: string | null
  /** Short Estonian reason */
  reason: string
  /** Map badge: FREE while free, KELL while paid-with-disc */
  label: 'FREE' | 'KELL'
  inPaidWindow: boolean
  inSeason: boolean
}

/** Fixed Estonian public holidays (month-day + movable Easter approximations for 2025–2027). */
const EE_FIXED_HOLIDAYS = new Set([
  '01-01', // uusaasta
  '02-24', // iseseisvuspäev
  '05-01', // kevadpüha
  '06-23', // võidupüha
  '06-24', // jaanipäev
  '08-20', // taasiseseisvumispäev
  '12-24', // jõululaupäev
  '12-25', // esimene jõulupüha
  '12-26', // teine jõulupüha
])

/** Good Friday / Easter Monday (YYYY-MM-DD) for nearby years */
const EE_MOVABLE_HOLIDAYS = new Set([
  '2025-04-18',
  '2025-04-21',
  '2026-04-03',
  '2026-04-06',
  '2027-03-26',
  '2027-03-29',
])

function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const bag = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    weekday: weekdayMap[bag.weekday] ?? 0,
    md: `${bag.month}-${bag.day}`,
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
  }
}

function minutesOfDay(hour: number, minute: number) {
  return hour * 60 + minute
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x))
  return minutesOfDay(h || 0, m || 0)
}

export function isEstonianPublicHoliday(date: Date, timeZone = 'Europe/Tallinn'): boolean {
  const p = partsInTz(date, timeZone)
  if (EE_FIXED_HOLIDAYS.has(p.md)) return true
  if (EE_MOVABLE_HOLIDAYS.has(p.ymd)) return true
  return false
}

function inSeason(p: ReturnType<typeof partsInTz>, season: SeasonWindow | null): boolean {
  if (!season) return true
  const key = p.month * 100 + p.day
  const start = season.startMonth * 100 + season.startDay
  const end = season.endMonth * 100 + season.endDay
  if (start <= end) return key >= start && key <= end
  // wraps year
  return key >= start || key <= end
}

function activePaidWindow(
  p: ReturnType<typeof partsInTz>,
  windows: PaidWindow[],
): PaidWindow | null {
  const nowM = minutesOfDay(p.hour, p.minute)
  for (const w of windows) {
    if (!w.days.includes(p.weekday)) continue
    const a = parseHm(w.start)
    const b = parseHm(w.end)
    if (nowM >= a && nowM < b) return w
  }
  return null
}

/** Next local Date (as UTC instant) for HH:MM on the same calendar day in tz — approximate via iterative format. */
function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Start from a UTC guess and adjust
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 4; i++) {
    const p = partsInTz(new Date(utc), timeZone)
    const want = minutesOfDay(hour, minute)
    const got = minutesOfDay(p.hour, p.minute)
    const dayDelta =
      (year - p.year) * 365 + (month - p.month) * 30 + (day - p.day)
    utc += (dayDelta * 24 * 60 + (want - got)) * 60_000
  }
  return new Date(utc)
}

/**
 * Evaluate freeRules at `at` (default now).
 * Disc minutes do not make the spot "free now" for unlimited stay — they are a
 * short free window while paid hours apply (label KELL).
 */
export function evaluateFreeRules(rules: FreeRuleSet, at: Date = new Date()): FreeEval {
  const p = partsInTz(at, rules.timezone)
  const seasonOk = inSeason(p, rules.season)
  const holiday = isEstonianPublicHoliday(at, rules.timezone)
  const window = seasonOk ? activePaidWindow(p, rules.paidWindows) : null

  if (rules.season && !seasonOk) {
    // Free until next season start (approx: season start this/next year)
    const y =
      p.month * 100 + p.day < rules.season.startMonth * 100 + rules.season.startDay
        ? p.year
        : p.year + 1
    const until = zonedLocalToUtc(
      y,
      rules.season.startMonth,
      rules.season.startDay,
      0,
      0,
      rules.timezone,
    )
    return {
      freeNow: true,
      freeUntil: until.toISOString(),
      reason: 'Hooajaväliselt tasuta',
      label: 'FREE',
      inPaidWindow: false,
      inSeason: false,
    }
  }

  if (holiday && rules.freeOnPublicHolidays) {
    return {
      freeNow: true,
      freeUntil: null,
      reason: 'Riigipüha — tasuta',
      label: 'FREE',
      inPaidWindow: false,
      inSeason: seasonOk,
    }
  }

  if (!window) {
    // Free until next paid window starts (scan next 7 days)
    let freeUntil: string | null = null
    for (let d = 0; d < 8 && !freeUntil; d++) {
      const probe = new Date(at.getTime() + d * 86400000)
      const pp = partsInTz(probe, rules.timezone)
      if (rules.season && !inSeason(pp, rules.season)) continue
      if (rules.freeOnPublicHolidays && isEstonianPublicHoliday(probe, rules.timezone)) {
        continue
      }
      for (const w of rules.paidWindows) {
        if (!w.days.includes(pp.weekday)) continue
        const startM = parseHm(w.start)
        const nowM = d === 0 ? minutesOfDay(p.hour, p.minute) : -1
        if (d === 0 && nowM >= startM) continue
        const [hh, mm] = w.start.split(':').map(Number)
        const until = zonedLocalToUtc(pp.year, pp.month, pp.day, hh, mm, rules.timezone)
        if (until > at) {
          freeUntil = until.toISOString()
          break
        }
      }
    }
    return {
      freeNow: true,
      freeUntil,
      reason: p.weekday === 0 ? 'Pühapäev — tasuta' : 'Tasuta väljaspool tasulist aega',
      label: 'FREE',
      inPaidWindow: false,
      inSeason: seasonOk,
    }
  }

  // Inside paid window — not free for unlimited stay; disc applies (KELL)
  const [eh, em] = window.end.split(':').map(Number)
  const until = zonedLocalToUtc(p.year, p.month, p.day, eh, em, rules.timezone)
  return {
    freeNow: false,
    freeUntil: until.toISOString(),
    reason: `Tasuline · ketas ${rules.discMinutes} min`,
    label: 'KELL',
    inPaidWindow: true,
    inSeason: seasonOk,
  }
}

export function formatFreeUntil(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('et-EE', {
      timeZone: 'Europe/Tallinn',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return null
  }
}
