import fs from 'fs'

;(globalThis as unknown as { window: typeof globalThis }).window = globalThis

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => {
    store.set(k, String(v))
  },
  removeItem: (k) => {
    store.delete(k)
  },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
}

// Resolve same-origin /api/* against the local Vite proxy
const origFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  if (url.startsWith('/api/')) {
    return origFetch(`http://127.0.0.1:43127${url}`, init)
  }
  return origFetch(input, init)
}) as typeof fetch

async function main() {
  const {
    prepareParkingPolygons,
    preciseCollectionToSpots,
  } = await import('../src/lib/preciseParkingPolygons.ts')
  const {
    prepareStreetParking,
    streetCollectionToSpots,
  } = await import('../src/lib/streetParkingLines.ts')
  const { resolveSpotAddress, representativePoint } = await import(
    '../src/lib/resolveSpotAddress.ts'
  )
  const { getCachedAddress } = await import('../src/lib/addressCache.ts')

  const raw = JSON.parse(
    fs.readFileSync(
      new URL('../public/data/estonia_parking_master.geojson', import.meta.url),
      'utf8',
    ),
  )
  const spots = [
    ...preciseCollectionToSpots(prepareParkingPolygons(raw)),
    ...streetCollectionToSpots(prepareStreetParking(raw)),
  ]

  function pick(pred: (s: (typeof spots)[number]) => boolean) {
    const s = spots.find(pred)
    if (!s) throw new Error('sample not found')
    return s
  }

  const samples = [
    [
      'EuroPark zone',
      pick((s) => s.layer === 'europark' && /^Zone EP/i.test(s.name)),
    ],
    ['Snabb spot', pick((s) => s.layer === 'snabb' && /^Zone /i.test(s.name))],
    [
      'Free lot',
      pick(
        (s) =>
          s.layer === 'free_street' && s.kind === 'lot' && Boolean(s.polygon),
      ),
    ],
    [
      'Polygon lot',
      pick((s) => Boolean(s.polygon) && s.layer === 'europark'),
    ],
    [
      'Line segment',
      pick((s) => Boolean(s.line) && s.featureType === 'on-street-line'),
    ],
  ] as const

  for (const [label, s] of samples) {
    const pt = representativePoint(s)
    console.log(`\n=== ${label} | ${s.id} | ${s.layer} | ${s.kind}`)
    console.log('title:', s.name, '| zone:', s.zone_code)
    console.log('raw address field:', JSON.stringify(s.address))
    console.log('repr point:', pt.lat.toFixed(5), pt.lng.toFixed(5))
    const t0 = Date.now()
    const r1 = await resolveSpotAddress(s)
    console.log(
      'resolved#1:',
      r1.address,
      '|',
      r1.source,
      `| ${Date.now() - t0}ms`,
    )
    const t2 = Date.now()
    const r2 = await resolveSpotAddress(s)
    console.log(
      'resolved#2:',
      r2.address,
      '|',
      r2.source,
      `| ${Date.now() - t2}ms`,
    )
    console.log('cached source:', getCachedAddress(s.id)?.source)
    if (r2.source !== 'cache' && r1.source !== 'source') {
      console.warn('WARN: second call did not hit cache')
    }
    if (/^zone\s/i.test(r1.address) || r1.address === s.name) {
      console.error('ERROR: still showing zone/title as address')
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
