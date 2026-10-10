// Kontrollib, et src/data/zones.ts (kuvatavad hinnad) ja api/_lib/pricing.ts (arvutus) on sünkroonis.
// Käivita: node --test scripts/test-zones-sync.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { ZONE_RATES } from '../src/data/zones.ts'
import { TARIFFS, calculatePrice } from '../api/_lib/pricing.ts'

for (const [code, z] of Object.entries(ZONE_RATES)) {
  test(`${code}: kuvatav hind klapib arvutusega`, () => {
    const t = TARIFFS[code]
    assert.ok(t, 'TARIFFS puudub tsoon ' + code)
    assert.equal(Math.round(z.pricePerMinute * 1000), t.milliPerMinute, 'minutihind')
    assert.equal(Math.round(z.pricePerHour * 100), Math.round(z.pricePerMinute * 60 * 100), 'tunnihind = minut x 60')
    assert.equal(z.freeMinutes, t.freeMinutes, 'tasuta minutid')
  })
}
test('tunnihind kuvatakse sama nagu 60 min arvutus ilma tasuta ajata', () => {
  const t0 = '2026-10-05T10:00:00+03:00', t1 = '2026-10-05T11:00:00+03:00'
  for (const code of ['VANALINN', 'SÜDALINN', 'KESKLINN']) {
    const r = calculatePrice({ zone: code, startTime: t0, endTime: t1, startMarked: false })
    assert.equal(r.ok, true)
    assert.equal(r.quote.totalPriceCents, Math.round(ZONE_RATES[code].pricePerHour * 100), code)
  }
})
