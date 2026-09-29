# Park Tallinn

Puhas 3D parkimiskaart Tallinnale (MapLibre). Tänavaäärsed tsoonid on teedega joondatud jooned; eraparklad on polügoonid.

## Käivitamine

```bash
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Zoom LOD (tasemed)

| Zoom | Vaade | Mis kuvatakse |
|------|--------|----------------|
| **&lt; 13** | Linnaosa | Ainult linnaosade märgid (Vanalinn, Kesklinn, Mustamäe, …) |
| **13–15** | Tsoon | Peamised parklad (EuroPark, Snabb, Citypark) läbipaistva täitega |
| **≥ 15** | Detail | Teeäärsed jooned, kellaga tsoonid, EV, INVA |

Sildid ei kattu: `text-allow-overlap` / `icon-allow-overlap` on `false`; madalama prioriteediga sildid (INVA, EV) peavad loti-nimedele teed andma.

Diagonaalseid “läbi majade” jooni ei joonistata — ainult lühikesed, teele joondatud lõigud detailvaates.

## Andmed

- `public/data/parking_polygons.geojson` — Overpass Tallinn `amenity=parking` polügoonid (~5.4k). Täide operaatori/tsooni värviga (opacity 0.35), 2px ääris; klõps avab bottom sheet’i (operaator, hind, tasuta minutid + Waze / Google / Apple).
- `public/data/street_parking.geojson` — teeäärsed LineString’id (zoom ≥ 15).

## Funktsioonid

- **Viewport bbox** — ainult ekraanil nähtavad kohad
- **Road-snapped jooned** — lühikesed teeäärsed LineString’id (Viru, Harju, Vene, Liivalaia, …)
- **Nominatim otsing** — `/api/nominatim` proxy (Vite / Vercel)
- **Bottom sheet** — Waze, Google Maps, Apple Maps navigeerimine
- **Floating glass UI** — ümarad paneelid + backdrop-blur

## Parkimissessioon (n8n — production)

Bottom sheet / kellapaneel saadavad POST production webhook’ile:

`https://mairon8n.app.n8n.cloud/webhook/parkimine`

```json
{ "action": "start", "carNumber": "123ABC", "zone": "KESKLINN" }
```

```json
{ "action": "stop", "carNumber": "123ABC", "zone": "KESKLINN" }
```

```json
{ "action": "status", "carNumber": "123ABC", "zone": "KESKLINN" }
```

```json
{ "action": "status" }
```

- **start** / **stop** — nõuavad `carNumber` + `zone`
- **status** ühe numbriga — `{ success, message, sessionDetails }`
- **status** ilma `carNumber`-ita (või **Kõik** nupp) — `{ success, message, activeSessions[], count }` ülevaade kõigist aktiivsetest sessioonidest
- UI kuvab backend’i `message`, tunnihinna ja staatuse toast’is / bottom sheet’is / kellapaneelis; nimekiri avaneb modaalis
- CORS-probleemi korral fallback: `/api/parkimine` proxy

Iga päring (start / stop / status) saadab Header Auth. Brauser kutsub
same-origin `/api/parkimine` proxy’t; Vite / Vercel lisavad päised upstream’ile:

```http
X-N8N-API-KEY: SecurityMHMJ26%
Content-Type: application/json
```

Deep-link testimiseks (ilma kaardiklõpsuta):

`http://127.0.0.1:43127/?spot=ev-ignitis-ahtri`
