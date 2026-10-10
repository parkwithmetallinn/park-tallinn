/**
 * Unit tests for api/reports groupReports + comment-null insert payload.
 * Run: node --experimental-strip-types --test scripts/test-group-reports.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupReports,
  normalizeStatus,
  reportInsertRow,
} from '../api/reports.ts'

const NOW = Date.parse('2026-10-10T12:00:00.000Z')

function row(parkingId, status, hash, minutesAgo = 5) {
  return {
    parking_id: parkingId,
    status_type: status,
    client_hash: hash,
    created_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  }
}

test('2 FULL votes → isFull true, status FULL', () => {
  const g = groupReports(
    [
      row('lot-a', 'FULL', 'h1'),
      row('lot-a', 'FULL', 'h2'),
    ],
    NOW,
  )
  assert.equal(g.length, 1)
  assert.equal(g[0].isFull, true)
  assert.equal(g[0].status, 'FULL')
})

test('1 FULL vote → isFull false (needs ≥2)', () => {
  const g = groupReports([row('lot-a', 'FULL', 'h1')], NOW)
  assert.equal(g[0].isFull, false)
  assert.equal(g[0].status, 'UNKNOWN')
})

test('2 FULL + 2 FREE → isFull false', () => {
  const g = groupReports(
    [
      row('lot-a', 'FULL', 'h1'),
      row('lot-a', 'FULL', 'h2'),
      row('lot-a', 'FREE', 'h3'),
      row('lot-a', 'FREE', 'h4'),
    ],
    NOW,
  )
  assert.equal(g[0].isFull, false)
  assert.equal(g[0].status, 'FREE')
})

test('same voter changes mind — only latest vote counts', () => {
  const g = groupReports(
    [
      row('lot-a', 'FULL', 'h1', 20),
      row('lot-a', 'FULL', 'h2', 15),
      // h1 switches to FREE more recently
      row('lot-a', 'FREE', 'h1', 2),
    ],
    NOW,
  )
  // Latest per voter: h1=FREE, h2=FULL → 1 FULL, 1 FREE → not isFull
  assert.equal(g[0].isFull, false)
  assert.equal(g[0].status, 'FREE')
})

test('normalizeStatus rejects PRICES and CLOSED', () => {
  assert.equal(normalizeStatus('FULL'), 'FULL')
  assert.equal(normalizeStatus('FREE'), 'FREE')
  assert.equal(normalizeStatus('PRICES'), null)
  assert.equal(normalizeStatus('CLOSED'), null)
  assert.equal(normalizeStatus('prices'), null)
})

test('reportInsertRow always stores comment: null (privacy)', () => {
  const payload = reportInsertRow({
    parkingId: 'w/1',
    statusType: 'FULL',
    clientHash: 'abc',
  })
  assert.equal(payload.comment, null)
  assert.equal(payload.parking_id, 'w/1')
  assert.equal(payload.status_type, 'FULL')
})
