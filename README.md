# Park Tallinn

Kaardipõhine Eesti parkimisäpp (MapLibre GL). Ajutine OSM/OpenFreeMap vektorkaart; hiljem asendub ~100 MB Maa-ameti vektorkaardiga.

## Käivitamine

```bash
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Aluskaart (1 rea vahetus)

Fail: `src/config/basemap.ts`

```ts
export const VECTOR_TILE_SOURCE_URL = 'https://tiles.openfreemap.org/planet'
// → 'https://tiles.example.ee/maaamet/v1'
```

Või sea `STYLE_URL` täielikule stiili JSON-ile.

## Viewport bounding box

- `src/lib/bbox.ts` — vaateakna piiride laiendamine
- `src/lib/spatialIndex.ts` — punktide bbox-päring
- `src/lib/parkingRepository.ts` — viewport-päring (täna lokaalne indeks; homme HTTP)

Tänavatasemel (z ≥ 15) laetakse kaardile **ainult ekraanil nähtava bbox-i** punktid. Välja zoomides kuvatakse linnaosade koondtsoonid.

## Andmeskeem (Eesti parkimisturg)

Iga punkt/polügoon kannab: `operator`, `zone_code`, `free_minutes`, `price_per_hour`, `featureType`, `layer`.

| Kiht | Näited |
|------|--------|
| `municipal` | Vanalinn, Südalinn, Kesklinn, Pirita |
| `europark` / `snabb` / `citypark` / `uhisteenused` / `parkit` | Eraoperaatorid |
| `free_street` / `timed` | Tasuta & kellaga tänavad |
| `ev` | Enefit Volt, Eleport, Ignitis |
| `inva` / `loading` | Inva-kohad, kauba laadimine |
| `park_ride` | Pargi & Reisi |

Mock-andmestik: `src/data/mockKesklinn.ts` (~28 päriselulist kohta Kesklinna/Vanalinna).

## Stack

Vite · React · TypeScript · Tailwind · MapLibre GL
