# Park Tallinn

Kaardipõhine app Tallinna **tasuta**, **kellaajaga** ja **Pargi & Reisi** parkimiseks — avalikud parklad, tänavaäärsed lõigud ja navigeerimine Waze’i / Google Mapsi.

## Käivitamine

```bash
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Funktsioonid

- **Zoomipõhine kaart:** välja zoomides linnaosa polügoonid + klastrid; üksikud tänavakohad alles z≥15
- **Waze-stiilis 3D** (MapLibre): pitch 55°, lilla marsruut + tänavacallout’id
- Filtrid, lähim koht, taimer, Waze / Google Maps
- ~2800+ kohta andmestikus (GPU klasterdamine, mitte DOM-nupud)

## Andmed

Kohad on orienteeruvad. Kontrolli alati kohapealseid liiklusmärke — tingimused muutuvad.

## Stack

Vite · React · TypeScript · Tailwind CSS · **MapLibre GL** (Waze-stiilis 3D, pitch 55°)

Vektorplaadid: [OpenFreeMap](https://openfreemap.org/). Marsruudid: OSRM.
