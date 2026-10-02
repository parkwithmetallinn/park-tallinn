# Park Tallinn

Puhas 3D parkimiskaart Tallinnale ja Pärnule (MapLibre). Tänavaäärsed tsoonid on teedega joondatud jooned; eraparklad on polügoonid. Linna vahetus otsinguribal (Tallinn | Pärnu).

## Käivitamine

```bash
cp .env.example .env   # täida N8N_WEBHOOK_URL ja N8N_API_KEY (server only)
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

### Keskkonnamuutujad

| Muutuja | Kirjeldus |
|---------|-----------|
| `N8N_WEBHOOK_URL` | n8n webhook URL (ainult server / Vite proxy / Vercel `api/`) |
| `N8N_API_KEY` | Header Auth väärtus päisele `X-N8N-API-KEY` (ainult server) |

Brauserer kutsub ainult same-origin `/api/parkimine` — `VITE_*` n8n võtmeid ei kasutata. Ära commit’i `.env` faili — ainult `.env.example`.

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
- `public/data/parnu_parking_master.geojson` — Pärnu OSM-parkimine (bbox extract). Tsoonireeglid (`src/data/parnuZones.ts` + `freeRules`) määravad FREE/KELL sildid, hinnad ja „praegu tasuta“. gis.parnu.ee FeatureServer ei olnud build-keskkonnast kättesaadav; ametlik ajakava on parnu.ee/parkimine järgi.
- `public/data/parnu_districts.geojson` — 10 ametlikku Pärnu asumi (OSM quarter relations): Vana-Pärnu, Ülejõe, Rääma, Tammiste, Kesklinn, Eeslinn, Rannarajoon, Mai, Raeküla, Lodja. Sinised piirjooned + suurtähelised sildid.
- `src/data/parnuChargers.ts` — EV seemned (Eleport Niidu 18b 200 kW, Neste 200 kW, Tesla Supercharger).
- `public/data/districts.geojson` — ametlikud Tallinna 8 linnaosa + Vanalinn (Tallinn GIS → EPSG:4326, ≤5 m simplify, mere mask, topoloogia). Ehita: `npm run build:districts`. Kontrolli: `npm run check:districts`.
- Lotid: täide operaatori/tsooni värviga (opacity 0.35), 2px ääris; klõps avab bottom sheet’i (operaator, hind, tasuta minutid + Waze / Google / Apple).
- Teeäär: curb-jooned (zoom ≥ 12). Roheline = tasuta, punane = tasuline, sinine = kellaga. Filtrid rakenduvad mõlemale kihile; otsingu Destination Interceptor suunab ≤400 m lähima parkla tsentroidile.

## Funktsioonid

- **Viewport bbox** — ainult ekraanil nähtavad kohad
- **Road-snapped jooned** — lühikesed teeäärsed LineString’id (Viru, Harju, Vene, Liivalaia, …)
- **Nominatim otsing** — `/api/nominatim` proxy (Vite / Vercel)
- **Bottom sheet** — Waze, Google Maps, Apple Maps navigeerimine
- **Floating glass UI** — ümarad paneelid + backdrop-blur

## Parkimissessioon (n8n)

Bottom sheet / kellapaneel saadavad POST same-origin `/api/parkimine` proxy kaudu
(server lisab `X-N8N-API-KEY` `N8N_API_KEY` keskkonnamuutujast):

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

Server toetab ainult `start` | `stop` | `status` (extend puudub). Ettemakstud minutid on ainult kohalik taimer (`endsAt` localStorage’is).

- **start** / **stop** — nõuavad `carNumber` + `zone`
- **status** ühe numbriga — body on täpselt `{ action, carNumber }` (ilma zone’ta)
- **status** ilma `carNumber`-ita (või **Kõik** nupp) — `{ activeSessions[], count }`
- Vastused normaliseeritakse `ACTIVE` | `NOT_FOUND` | `ERROR` (`src/lib/parkingSession.ts`). `NOT_FOUND` ei ole viga.
- App load / window focus / visibilitychange (≤1× / 15 s) kutsub `status` kui kohalik sessioon olemas: ACTIVE → sync; NOT_FOUND → kustuta + info toast; ERROR → hoia kohalikku olekut + „ühendus puudub“.
- Header Auth lisab ainult proxy: `X-N8N-API-KEY` = `N8N_API_KEY` (klient päist ei saada)
- Tasuta / kellaga / P&R kohtadel sessiooni alustamine on keelatud (`src/data/zones.ts`)
- Tsoonihinnad: Vanalinn 6.00 · Südalinn 4.80 · Kesklinn 1.50 · Pirita 0.60 €/h (kontrolli tallinn.ee)

Deep-link testimiseks (ilma kaardiklõpsuta):

`http://127.0.0.1:43127/?spot=ev-ignitis-ahtri`

### Aadressirida (detail sheet)

Bottom sheet’i aadressirida ei korda tsoonikoodi. Kui GeoJSON-is puudub päris `addr:*`,
lahendatakse aadress laiskult In-AKS (Maa-amet) pöördgeokodeerimisega, varuna Nominatim/Photon.
Tulemused cache’itakse (~30 päeva). Valikuline eelarvutus:

```bash
npm run precompute:addresses -- --limit=50
npm run precompute:addresses -- --resume
```

Aadressi-validatsiooni test: `npm run test:address`.
