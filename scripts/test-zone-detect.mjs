/**
 * Zone priority tests for detectZone(lng, lat).
 * Run: node --experimental-strip-types --test scripts/test-zone-detect.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { detectZone } from '../src/lib/zoneDetect.ts'

test('Raekoja plats (59.4370, 24.7454) → VANALINN', () => {
  assert.equal(detectZone(24.7454, 59.437), 'VANALINN')
})

test('Viru väljak (59.4366, 24.7535) → SÜDALINN', () => {
  assert.equal(detectZone(24.7535, 59.4366), 'SÜDALINN')
})

test('Punkt (59.4272, 24.7700) → KESKLINN', () => {
  assert.equal(detectZone(24.77, 59.4272), 'KESKLINN')
})
