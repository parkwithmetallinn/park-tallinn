/**
 * Unit checks for isRealAddress.
 * Run: npm run test:address
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const result = spawnSync(
  'npx',
  [
    '--yes',
    'tsx',
    '-e',
    `
import assert from 'node:assert/strict'
import { isRealAddress, isZoneCodeLike } from './src/lib/isRealAddress.ts'

assert.equal(isZoneCodeLike('Zone EP56'), true)
assert.equal(isZoneCodeLike('EP56'), true)
assert.equal(isZoneCodeLike('Tsoon EP56'), true)
assert.equal(isZoneCodeLike('Pärnu mnt 12'), false)

const cases: Array<[string, boolean, { name?: string; code?: string }?]> = [
  ['Zone EP56', false],
  ['EP56', false],
  ['Tsoon EP56', false],
  ['Pärnu mnt 12', true],
  ['Liivalaia tn 53, Kesklinn, Tallinn', true],
  ['', false],
  ['Surface', false],
  ['Zone EP56', false, { name: 'Zone EP56', code: 'EP56' }],
  ['EuroPark parkla', false, { name: 'EuroPark parkla', code: 'EP' }],
]

let failed = 0
for (const [input, expected, opts] of cases) {
  const got = isRealAddress(input, opts)
  try {
    assert.equal(got, expected)
    console.log('ok ', JSON.stringify(input), '→', got)
  } catch {
    failed++
    console.error('FAIL', JSON.stringify(input), 'got', got, 'expected', expected)
  }
}
if (failed) process.exit(1)
console.log('\\nAll isRealAddress checks passed')
`,
  ],
  { cwd: root, encoding: 'utf8' },
)

process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
process.exit(result.status ?? 1)
