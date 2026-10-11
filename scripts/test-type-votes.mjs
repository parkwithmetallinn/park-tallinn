/**
 * Unit tests for type-vote grouping (2 matching votes → verified).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groupTypeVotes, mergeVerifiedResults } from '../api/type-votes.ts'

const now = Date.parse('2026-10-10T12:00:00.000Z')

describe('groupTypeVotes', () => {
  it('requires two independent matching votes', () => {
    const rows = [
      {
        parking_id: 'lot-a',
        proposed_type: 'FREE',
        client_hash: 'h1',
        ip_hash: 'ip1',
        created_at: '2026-10-10T11:50:00.000Z',
      },
      {
        parking_id: 'lot-a',
        proposed_type: 'FREE',
        client_hash: 'h2',
        ip_hash: 'ip2',
        created_at: '2026-10-10T11:55:00.000Z',
      },
    ]
    const out = groupTypeVotes(rows, now)
    assert.equal(out.length, 1)
    assert.equal(out[0].parkingId, 'lot-a')
    assert.equal(out[0].verifiedType, 'FREE')
    assert.equal(out[0].voteCount, 2)
  })

  it('same IP hash does not count as two independent votes', () => {
    const rows = [
      {
        parking_id: 'lot-a',
        proposed_type: 'FREE',
        client_hash: 'h1',
        ip_hash: 'ip-shared',
        created_at: '2026-10-10T11:50:00.000Z',
      },
      {
        parking_id: 'lot-a',
        proposed_type: 'FREE',
        client_hash: 'h2',
        ip_hash: 'ip-shared',
        created_at: '2026-10-10T11:55:00.000Z',
      },
    ]
    assert.deepEqual(groupTypeVotes(rows, now), [])
  })

  it('ignores a single vote', () => {
    const rows = [
      {
        parking_id: 'lot-b',
        proposed_type: 'PAID',
        client_hash: 'h1',
        created_at: '2026-10-10T11:50:00.000Z',
      },
    ]
    assert.deepEqual(groupTypeVotes(rows, now), [])
  })

  it('keeps only the latest vote per client_hash', () => {
    const rows = [
      {
        parking_id: 'lot-c',
        proposed_type: 'FREE',
        client_hash: 'h1',
        created_at: '2026-10-10T11:40:00.000Z',
      },
      {
        parking_id: 'lot-c',
        proposed_type: 'TIMED',
        client_hash: 'h1',
        created_at: '2026-10-10T11:50:00.000Z',
      },
      {
        parking_id: 'lot-c',
        proposed_type: 'TIMED',
        client_hash: 'h2',
        created_at: '2026-10-10T11:55:00.000Z',
      },
    ]
    const out = groupTypeVotes(rows, now)
    assert.equal(out.length, 1)
    assert.equal(out[0].verifiedType, 'TIMED')
  })
})

describe('mergeVerifiedResults', () => {
  it('lets persisted verified rows win', () => {
    const fromVotes = [
      {
        parkingId: 'x',
        verifiedType: 'FREE',
        voteCount: 2,
        lastVotedMinutesAgo: 1,
      },
    ]
    const fromTable = [
      {
        parkingId: 'x',
        verifiedType: 'PAID',
        voteCount: 3,
        lastVotedMinutesAgo: 10,
      },
    ]
    const merged = mergeVerifiedResults(fromVotes, fromTable)
    assert.equal(merged[0].verifiedType, 'PAID')
  })
})
