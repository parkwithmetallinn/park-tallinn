import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePrice, normalizeZone, MAX_DURATION_MINUTES } from '../src/lib/pricing.ts'

const quote = (zone, startTime, endTime, extra = {}) => {
  const r = calculatePrice({ zone, startTime, endTime, ...extra })
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.quote
}
const expectQuote = (q, e) => {
  for (const [k, v] of Object.entries(e)) assert.equal(q[k], v, `${k}: expected ${v}, got ${q[k]}`)
  assert.equal(q.durationMinutes, q.unchargedMinutes + q.freeMinutesUsed + q.billableMinutes, 'minutes must add up')
}

test('Kesklinn weekday: 60 min, first 15 free -> 45 min x 0.025 = 1.125 -> 1.13', () => {
  expectQuote(quote('KESKLINN', '2026-10-05T10:00:00+03:00', '2026-10-05T11:00:00+03:00'),
    { durationMinutes: 60, freeMinutesUsed: 15, billableMinutes: 45, unchargedMinutes: 0, totalPriceCents: 113, totalPrice: 1.13 })
})
test('Kesklinn without marked start time: 60 min -> 1.50', () => {
  expectQuote(quote('KESKLINN', '2026-10-05T10:00:00+03:00', '2026-10-05T11:00:00+03:00', { startMarked: false }),
    { freeMinutesUsed: 0, billableMinutes: 60, totalPriceCents: 150 })
})
test('Kesklinn Sunday is free', () => {
  expectQuote(quote('KESKLINN', '2026-10-11T10:00:00+03:00', '2026-10-11T12:00:00+03:00'),
    { unchargedMinutes: 120, billableMinutes: 0, totalPriceCents: 0 })
})
test('Kesklinn Saturday: paid only until 15:00', () => {
  expectQuote(quote('KESKLINN', '2026-10-10T14:30:00+03:00', '2026-10-10T15:30:00+03:00'),
    { unchargedMinutes: 30, freeMinutesUsed: 15, billableMinutes: 15, totalPriceCents: 38 })
})
test('Kesklinn: parking that ends inside the free period and paid hours end at 19:00', () => {
  expectQuote(quote('KESKLINN', '2026-10-05T18:55:00+03:00', '2026-10-05T19:10:00+03:00'),
    { unchargedMinutes: 10, freeMinutesUsed: 5, billableMinutes: 0, totalPriceCents: 0 })
})
test('Kesklinn Friday evening to Saturday morning only charges paid hours', () => {
  expectQuote(quote('KESKLINN', '2026-10-09T18:30:00+03:00', '2026-10-10T08:30:00+03:00'),
    { durationMinutes: 840, unchargedMinutes: 780, freeMinutesUsed: 15, billableMinutes: 45, totalPriceCents: 113 })
})
test('Public holiday on a weekday is charged like that weekday (24 Feb 2025 was a Monday)', () => {
  expectQuote(quote('KESKLINN', '2025-02-24T10:00:00+02:00', '2025-02-24T11:00:00+02:00'),
    { billableMinutes: 45, totalPriceCents: 113 })
})
test('Session starting before paid hours: free period runs from the start of the session', () => {
  expectQuote(quote('KESKLINN', '2026-03-30T06:50:00+03:00', '2026-03-30T07:20:00+03:00'),
    { unchargedMinutes: 10, freeMinutesUsed: 5, billableMinutes: 15, totalPriceCents: 38 })
})
test('Started minutes: 16 min 30 s counts as 17 minutes', () => {
  expectQuote(quote('KESKLINN', '2026-10-05T10:00:00+03:00', '2026-10-05T10:16:30+03:00'),
    { durationMinutes: 17, billableMinutes: 2, totalPriceCents: 5 })
})
test('Südalinn is 24/7: 2 h = 105 x 0.08 = 8.40', () => {
  expectQuote(quote('SÜDALINN', '2026-10-05T23:00:00+03:00', '2026-10-06T01:00:00+03:00'),
    { durationMinutes: 120, billableMinutes: 105, totalPriceCents: 840 })
})
test('Vanalinn 2 h = 105 x 0.10 = 10.50; 15 min free; 16 min = 0.10', () => {
  expectQuote(quote('VANALINN', '2026-10-05T12:00:00+03:00', '2026-10-05T14:00:00+03:00'), { totalPriceCents: 1050 })
  expectQuote(quote('VANALINN', '2026-10-05T12:00:00+03:00', '2026-10-05T12:15:00+03:00'), { billableMinutes: 0, totalPriceCents: 0 })
  expectQuote(quote('VANALINN', '2026-10-05T12:00:00+03:00', '2026-10-05T12:16:00+03:00'), { billableMinutes: 1, totalPriceCents: 10 })
})
test('Pirita in season: paid from 10:00 (free period was used up before paid hours)', () => {
  expectQuote(quote('PIRITA', '2026-07-10T09:30:00+03:00', '2026-07-10T11:00:00+03:00'),
    { durationMinutes: 90, unchargedMinutes: 30, freeMinutesUsed: 0, billableMinutes: 60, totalPriceCents: 60 })
})
test('Pirita season boundaries are inclusive (15 May - 15 Sep)', () => {
  assert.equal(quote('PIRITA', '2026-05-14T11:00:00+03:00', '2026-05-14T12:00:00+03:00').totalPriceCents, 0)
  assert.equal(quote('PIRITA', '2026-05-15T11:00:00+03:00', '2026-05-15T12:00:00+03:00').totalPriceCents, 45)
  assert.equal(quote('PIRITA', '2026-09-15T12:00:00+03:00', '2026-09-15T13:00:00+03:00').totalPriceCents, 45)
  assert.equal(quote('PIRITA', '2026-09-16T12:00:00+03:00', '2026-09-16T13:00:00+03:00').totalPriceCents, 0)
  assert.equal(quote('PIRITA', '2026-10-10T12:00:00+03:00', '2026-10-10T14:00:00+03:00').totalPriceCents, 0)
})
test('Daylight saving: duration is elapsed time, not clock difference', () => {
  assert.equal(quote('SÜDALINN', '2026-03-28T20:00:00Z', '2026-03-29T04:00:00Z').totalPriceCents, 3720) // clocks go forward
  assert.equal(quote('SÜDALINN', '2026-10-24T20:00:00Z', '2026-10-25T04:00:00Z').totalPriceCents, 3720) // clocks go back
})
test('Zero duration is free', () => {
  expectQuote(quote('VANALINN', '2026-10-05T12:00:00Z', '2026-10-05T12:00:00Z'), { durationMinutes: 0, totalPriceCents: 0 })
})
test('Zone names are normalised', () => {
  for (const z of ['sudalinn', 'Südalinn', ' SÜDALINN ', 'suudalinn']) assert.equal(normalizeZone(z), 'SÜDALINN')
  assert.equal(normalizeZone('EP29'), null)
  assert.equal(normalizeZone('toString'), null)
  assert.equal(normalizeZone(5), null)
})
test('Validation errors', () => {
  const t = ['2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z']
  const code = (input) => { const r = calculatePrice(input); assert.equal(r.ok, false, JSON.stringify(r)); return r.code }
  assert.equal(code({ zone: 'EP29', startTime: t[0], endTime: t[1] }), 'INVALID_ZONE')
  assert.equal(code({ zone: 'KESKLINN', startTime: '2026-10-05T10:00:00', endTime: t[1] }), 'INVALID_TIME') // no offset
  assert.equal(code({ zone: 'KESKLINN', startTime: '2026-02-30T10:00:00Z', endTime: t[1] }), 'INVALID_TIME')
  assert.equal(code({ zone: 'KESKLINN', startTime: '2026-10-05T24:00:00Z', endTime: t[1] }), 'INVALID_TIME')
  assert.equal(code({ zone: 'KESKLINN', startTime: '1999-10-05T10:00:00Z', endTime: '1999-10-05T11:00:00Z' }), 'INVALID_TIME')
  assert.equal(code({ zone: 'KESKLINN', startTime: 12345, endTime: t[1] }), 'INVALID_TIME')
  assert.equal(code({ zone: 'KESKLINN', startTime: t[1], endTime: t[0] }), 'END_BEFORE_START')
  assert.equal(code({ zone: 'KESKLINN', startTime: t[0], endTime: t[1], startMarked: 'yes' }), 'INVALID_INPUT')
  assert.equal(code({ zone: 'KESKLINN', startTime: '2026-10-05T10:00:00Z', endTime: '2026-10-12T10:01:00Z' }), 'TOO_LONG')
  assert.equal(calculatePrice({ zone: 'KESKLINN', startTime: '2026-10-05T10:00:00Z', endTime: '2026-10-12T10:00:00Z' }).ok, true) // exactly 7 days
  assert.equal(MAX_DURATION_MINUTES, 10080)
})
test('A 7 day calculation is fast', () => {
  const t0 = performance.now()
  quote('SÜDALINN', '2026-10-05T10:00:00Z', '2026-10-12T10:00:00Z')
  const ms = performance.now() - t0
  assert.ok(ms < 500, `took ${ms.toFixed(1)} ms`)
})

// ---- independent oracle: no Intl, DST from the EU rule, zone rules written as plain code ----
const lastSunday = (year, month0) => { const d = new Date(Date.UTC(year, month0 + 1, 0)); return d.getUTCDate() - d.getUTCDay() }
const oracleOffset = (ms) => {
  const y = new Date(ms).getUTCFullYear()
  return ms >= Date.UTC(y, 2, lastSunday(y, 2), 1) && ms < Date.UTC(y, 9, lastSunday(y, 9), 1) ? 180 : 120
}
const MILLI = { VANALINN: 100, 'SÜDALINN': 80, KESKLINN: 25, PIRITA: 10 }
const oraclePaid = (zone, d) => {
  const dow = d.getUTCDay(), t = d.getUTCHours() * 60 + d.getUTCMinutes(), mo = d.getUTCMonth() + 1, day = d.getUTCDate()
  if (zone === 'VANALINN' || zone === 'SÜDALINN') return true
  if (zone === 'KESKLINN') return dow >= 1 && dow <= 5 ? t >= 420 && t < 1140 : dow === 6 ? t >= 480 && t < 900 : false
  const inSeason = (mo > 5 || (mo === 5 && day >= 15)) && (mo < 9 || (mo === 9 && day <= 15))
  return inSeason && t >= 600 && t < 1320
}
const oracle = (zone, startMs, endMs, marked) => {
  const dur = Math.ceil((endMs - startMs) / 60000)
  let billable = 0
  for (let i = 0; i < dur; i++) {
    const at = startMs + i * 60000
    if (!oraclePaid(zone, new Date(at + oracleOffset(at) * 60000))) continue
    if (marked && i < 15) continue
    billable++
  }
  return Math.floor((billable * MILLI[zone] + 5) / 10)
}
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

test('3000 random sessions (incl. DST changes, season edges, window edges) match the independent oracle', () => {
  const rand = rng(20261009)
  const zones = Object.keys(MILLI)
  const anchors = []
  for (const y of [2025, 2026, 2027]) {
    anchors.push(Date.UTC(y, 2, lastSunday(y, 2), 1), Date.UTC(y, 9, lastSunday(y, 9), 1), Date.UTC(y, 4, 15, -3), Date.UTC(y, 8, 15, 20), Date.UTC(y, 0, 1))
  }
  let checked = 0
  for (let n = 0; n < 3000; n++) {
    const zone = zones[Math.floor(rand() * zones.length)]
    const base = rand() < 0.5
      ? Date.UTC(2025, 0, 1) + Math.floor(rand() * 3 * 365 * 24 * 60) * 60000
      : anchors[Math.floor(rand() * anchors.length)] + Math.floor((rand() - 0.5) * 72 * 60) * 60000
    const start = base + Math.floor(rand() * 60) * 1000
    const durMin = rand() < 0.1 ? Math.floor(rand() * 10080) : Math.floor(rand() * 600)
    const end = start + durMin * 60000 + Math.floor(rand() * 60) * 1000
    const marked = rand() < 0.7
    const r = calculatePrice({ zone, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), startMarked: marked })
    assert.equal(r.ok, true)
    const q = r.quote
    assert.equal(q.durationMinutes, q.unchargedMinutes + q.freeMinutesUsed + q.billableMinutes)
    assert.equal(q.totalPriceCents, oracle(zone, start, end, marked), `${zone} ${new Date(start).toISOString()} -> ${new Date(end).toISOString()} marked=${marked}`)
    assert.equal(q.totalPrice, q.totalPriceCents / 100)
    checked++
  }
  assert.equal(checked, 3000)
})
