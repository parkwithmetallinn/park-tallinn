// Kopeerib MapLibre'i worker-failid node_modules/maplibre-gl/dist -> public/maplibre/ (versioon alati sama mis pakil).
// Käivitub automaatselt enne dev/build (package.json: predev, prebuild). public/maplibre/ on .gitignore'is.
import { copyFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const src = resolve('node_modules/maplibre-gl/dist')
const dst = resolve('public/maplibre')
const worker = 'maplibre-gl-worker.mjs'
if (!existsSync(join(src, worker))) { console.error(`[copy-maplibre-worker] ${worker} puudub kaustas ${src}. Kontrolli maplibre-gl versiooni.`); process.exit(1) }

rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
const copied = new Set()
const copy = (name) => {
  if (copied.has(name)) return
  const from = join(src, name)
  if (!existsSync(from)) { console.error(`[copy-maplibre-worker] puudub: ${name}`); process.exit(1) }
  copyFileSync(from, join(dst, name)); copied.add(name)
  // kopeeri rekursiivselt kõik relatiivsed importidki (./xxx.mjs)
  const text = readFileSync(from, 'utf8')
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']\.\/([^"'/]+\.m?js)["']/g)) copy(m[1])
}
copy(worker)
console.log(`[copy-maplibre-worker] kopeeritud: ${[...copied].join(', ')} -> public/maplibre/`)
