# Park Tallinn

Kaardipõhine parkimisäpp (MapLibre GL). Ajutine OSM/OpenFreeMap vektorkaart; hiljem asendub ~100 MB Maa-ameti vektorkaardiga.

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

## 100×100 m ruudustik

- `src/lib/grid.ts` — Web Mercator 100 m lahtrid
- `src/lib/spatialIndex.ts` — punktid indekseeritud lahtri võtme järgi
- `src/lib/parkingRepository.ts` — viewport-päring (täna lokaalne indeks; homme HTTP)

Tänavatasemel (z ≥ 15) laetakse kaardile **ainult nähtavate lahtrite** punktid. Välja zoomides individuaalseid punkte ei renderdata.

## Parkimiskihid

Üks GeoJSON allikas, eraldi MapLibre kihid filtriga `provider`:

| Kiht | Provider |
|------|----------|
| EuroPark | `europark` |
| Snabb | `snabb` |
| Tasuta tänav | `free_street` |
| Kellaga | `timed` |
| P&R | `park_ride` |
| Avalik | `municipal` |

## Stack

Vite · React · TypeScript · Tailwind · MapLibre GL
