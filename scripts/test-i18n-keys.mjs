/**
 * Key-parity test: en.ts and ru.ts must have the same leaf keys as et.ts.
 * Missing or extra keys fail the test.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { et } from '../src/i18n/et.ts'
import { en } from '../src/i18n/en.ts'
import { ru } from '../src/i18n/ru.ts'
import { flattenMessages } from '../src/i18n/flatten.ts'

function leafKeys(tree) {
  return Object.keys(flattenMessages(tree)).sort()
}

function diff(expected, actual) {
  const exp = new Set(expected)
  const act = new Set(actual)
  const missing = expected.filter((k) => !act.has(k))
  const extra = actual.filter((k) => !exp.has(k))
  return { missing, extra }
}

test('en messages match et keys', () => {
  const etKeys = leafKeys(et)
  const enKeys = leafKeys(en)
  const { missing, extra } = diff(etKeys, enKeys)
  assert.deepEqual(
    missing,
    [],
    `en missing keys:\n${missing.join('\n')}`,
  )
  assert.deepEqual(extra, [], `en extra keys:\n${extra.join('\n')}`)
})

test('ru messages match et keys', () => {
  const etKeys = leafKeys(et)
  const ruKeys = leafKeys(ru)
  const { missing, extra } = diff(etKeys, ruKeys)
  assert.deepEqual(
    missing,
    [],
    `ru missing keys:\n${missing.join('\n')}`,
  )
  assert.deepEqual(extra, [], `ru extra keys:\n${extra.join('\n')}`)
})

test('all message leaves are non-empty strings (et)', () => {
  const flat = flattenMessages(et)
  for (const [k, v] of Object.entries(flat)) {
    // Gloss may be empty for et (no parenthetical needed)
    if (k.endsWith('Gloss')) continue
    assert.equal(typeof v, 'string', k)
    assert.ok(v.trim().length > 0, `empty: ${k}`)
  }
})
