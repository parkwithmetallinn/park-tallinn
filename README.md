# Park Tallinn

Puhas 3D parkimiskaart Tallinnale (MapLibre). Tänavaäärsed tsoonid on teedega joondatud jooned; eraparklad on polügoonid.

## Käivitamine

```bash
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Funktsioonid

- **Viewport bbox** — ainult ekraanil nähtavad kohad
- **Road-snapped jooned** — OSRM-iga teedele joondatud LineString’id (Liivalaia, Pärnu mnt, Viru, …)
- **Nominatim otsing** — `/api/nominatim` proxy (Vite / Vercel)
- **Bottom sheet** — Waze, Google Maps, Apple Maps navigeerimine
- **Floating glass UI** — ümarad paneelid + backdrop-blur

## Stack

Vite · React · TypeScript · Tailwind · MapLibre GL
