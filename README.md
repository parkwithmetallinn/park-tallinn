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

## Parkimissessioon (n8n)

Bottom sheet → **Alusta / Lõpeta parkimissessioon** saadab POST:

`https://mairon8n.app.n8n.cloud/webhook/parkimine`

```json
{ "action": "start", "carNumber": "123ABC", "zone": "KESKLINN" }
```

```json
{ "action": "stop", "carNumber": "123ABC", "zone": "KESKLINN" }
```

Vastus: `{ success, message, sessionDetails }` (start → `startTime` / `ACTIVE`; stop → `endTime` / `STOPPED`) — kuvatakse toast’ina. Aktiivset sessiooni saab lõpetada ka parkimiskella paneelist. CORS-probleemi korral kasutatakse `/api/parkimine` proxy’t.
