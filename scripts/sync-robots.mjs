#!/usr/bin/env node
/**
 * Sync public/robots.txt with VITE_ALLOW_INDEXING.
 * Usage: node scripts/sync-robots.mjs
 * Called from prebuild so the indexing switch stays a single env flag.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env')
let allow = false
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8')
  const m = text.match(/^VITE_ALLOW_INDEXING\s*=\s*(.+)$/m)
  if (m) allow = String(m[1]).trim().replace(/^["']|["']$/g, '') === 'true'
}
if (process.env.VITE_ALLOW_INDEXING === 'true') allow = true

const body = allow
  ? `# Public launch indexing enabled (VITE_ALLOW_INDEXING=true)
User-agent: *
Allow: /
`
  : `# Indexing off while on tunnel/dev (VITE_ALLOW_INDEXING=false).
# At launch: set VITE_ALLOW_INDEXING=true and rebuild.
User-agent: *
Disallow: /
`

writeFileSync(resolve(root, 'public/robots.txt'), body)
console.log(`[sync-robots] indexing=${allow ? 'allow' : 'disallow'}`)
