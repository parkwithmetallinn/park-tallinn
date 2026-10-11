// Kasutus: node scripts/check-dist-worker.mjs [dist-kaust]   (käivita pärast `npm run build`)
// Kontrollib, et iga kausta dist/assets ja dist/maplibre .js/.mjs faili relatiivne import (./xxx.mjs) viitab olemasolevale failile.
// Püüab kinni vea "worker impordib faili, mida ehitus ei loonud" (Vercelis 404, kaart jääb tühjaks).
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const dist = resolve(process.argv[2] || 'dist')
const dirs = ['assets', 'maplibre'].map((d) => join(dist, d)).filter((d) => existsSync(d))
if (!dirs.length) { console.error('Kausta ei leitud: ' + join(dist, 'assets') + ' (käivita enne npm run build)'); process.exit(2) }

const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.(m?js)$/.test(f)).map((f) => join(d, f)))
const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew URL\(\s*)["'](\.{1,2}\/[^"']+\.(?:m?js|css|wasm))["']/g
let missing = 0, checked = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(re)) {
    checked++
    const target = resolve(dirname(f), m[1])
    if (!existsSync(target)) { missing++; console.log(`PUUDUB  ${f.replace(dist, 'dist')} impordib ${m[1]}`) }
  }
}
const worker = files.filter((f) => /worker/i.test(f))
console.log(`Kontrollitud ${files.length} faili, ${checked} relatiivset importi, worker-faile: ${worker.length ? worker.map((w) => w.replace(dist, 'dist')).join(', ') : 'pole'}`)
if (missing) { console.log(`\nVIGA: ${missing} puuduvat faili. Kaart ei tööta tootmises.`); process.exit(1) }
console.log('OK: kõik relatiivsed impordid on olemas')
