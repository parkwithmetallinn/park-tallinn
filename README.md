# Park Tallinn

Kaardipõhine app Tallinna **tasuta**, **kellaajaga** ja **Pargi & Reisi** parkimiseks — avalikud parklad, tänavaäärsed lõigud ja navigeerimine Waze’i / Google Mapsi.

## Käivitamine

```bash
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Funktsioonid

- **Waze-stiilis 3D kaart** (MapLibre GL): pitch 55°, helehall taust, valged teed, hallid hooned, helesinine vesi
- Lilla marsruudijoon + tänavanime callout’id sõlmkohtades («3D navi kaardil»)
- Filtrid: 100% tasuta, tänavaäärsed, kellaga, avalikud parklad, P&R
- Lähima soodsa koha bänner + Waze / Google Maps
- Parkimiskella taimer
- Kasutaja saab lisada uusi kohti (brauserisse)

## Andmed

Kohad on orienteeruvad. Kontrolli alati kohapealseid liiklusmärke — tingimused muutuvad.

## Stack

Vite · React · TypeScript · Tailwind CSS · **MapLibre GL** (Waze-stiilis 3D, pitch 55°)

Vektorplaadid: [OpenFreeMap](https://openfreemap.org/). Marsruudid: OSRM.
