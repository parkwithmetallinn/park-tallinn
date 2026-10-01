# Park Tallinn

Puhas 3D parkimiskaart Tallinnale (MapLibre). Tänavaäärsed tsoonid on teedega joondatud jooned; eraparklad on polügoonid.

## Käivitamine

```bash
cp .env.example .env   # täida VITE_N8N_WEBHOOK_URL ja VITE_N8N_API_KEY
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

### Keskkonnamuutujad

| Muutuja | Kirjeldus |
|---------|-----------|
| `VITE_N8N_WEBHOOK_URL` | n8n webhook URL (nt `https://…/webhook/parkimine`) |
| `VITE_N8N_API_KEY` | Header Auth väärtus päisele `X-N8N-API-KEY` |

Kasutatakse klientis (`src/lib/parkingSession.ts`) ning Vite / Vercel `/api/parkimine` proxy’s. Ära commit’i `.env` faili — ainult `.env.example`.

## Zoom LOD (tasemed)

| Zoom | Vaade | Mis kuvatakse |
|------|--------|----------------|
| **&lt; 13** | Linnaosa | Ainult linnaosade märgid (Vanalinn, Kesklinn, Mustamäe, …) |
| **13–15** | Tsoon | Peamised parklad (EuroPark, Snabb, Citypark) läbipaistva täitega |
| **≥ 15** | Detail | Teeäärsed jooned, kellaga tsoonid, EV, INVA |

Sildid ei kattu: `text-allow-overlap` / `icon-allow-overlap` on `false`; madalama prioriteediga sildid (INVA, EV) peavad loti-nimedele teed andma.

Diagonaalseid “läbi majade” jooni ei joonistata — ainult lühikesed, teele joondatud lõigud detailvaates.

## Andmed

- `public/data/estonia_parking_master.geojson` — ühtne Eesti OSM-stiilis parkimiskiht (~10.8k feature’t). Laadimisel jagatakse lot-polügoonideks ja teeäärseks (street_side / lane / LineString) kihiks (`src/lib/estoniaParkingMaster.ts`). Vanad `parking_polygons.geojson` / `street_parking.geojson` failid on asendatud.
- Lotid: täide operaatori/tsooni värviga (opacity 0.35), 2px ääris; klõps avab bottom sheet’i (operaator, hind, tasuta minutid + Waze / Google / Apple).
- Teeäär: curb-jooned (zoom ≥ 12). Roheline = tasuta, punane = tasuline, sinine = kellaga. Filtrid rakenduvad mõlemale kihile; otsingu Destination Interceptor suunab ≤400 m lähima parkla tsentroidile.

## Funktsioonid

- **Viewport bbox** — ainult ekraanil nähtavad kohad
- **Road-snapped jooned** — lühikesed teeäärsed LineString’id (Viru, Harju, Vene, Liivalaia, …)
- **Nominatim otsing** — `/api/nominatim` proxy (Vite / Vercel)
- **Bottom sheet** — Waze, Google Maps, Apple Maps navigeerimine
- **Floating glass UI** — ümarad paneelid + backdrop-blur

## Parkimissessioon (n8n)

Bottom sheet / kellapaneel saadavad POST webhook’ile (`VITE_N8N_WEBHOOK_URL`),
tavaliselt same-origin `/api/parkimine` proxy kaudu:

```json
{ "action": "start", "carNumber": "123ABC", "zone": "KESKLINN" }
```

```json
{ "action": "stop", "carNumber": "123ABC", "zone": "KESKLINN" }
```

```json
{ "action": "status", "carNumber": "123ABC" }
```

```json
{ "action": "status" }
```

```json
{ "action": "extend", "carNumber": "123ABC", "zone": "KESKLINN", "minutes": 15 }
```

- **start** / **stop** / **extend** — nõuavad `carNumber` + `zone`
- **status** ühe numbriga — body on täpselt `{ action, carNumber }` (ilma zone’ta)
- **status** ilma `carNumber`-ita (või **Kõik** nupp) — `{ activeSessions[], count }`
- Header Auth: `X-N8N-API-KEY` = `VITE_N8N_API_KEY` (ei ole hardcode’itud lähtekoodis)

Deep-link testimiseks (ilma kaardiklõpsuta):

`http://127.0.0.1:43127/?spot=ev-ignitis-ahtri`
