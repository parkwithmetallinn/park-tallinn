# Park Tallinn / Parkimine

Puhas 3D parkimiskaart Tallinnale ja Pärnule (MapLibre). Tänavaäärsed tsoonid on teedega joondatud jooned; eraparklad on polügoonid. Linna vahetus otsinguribal (Tallinn | Pärnu).

## Käivitamine (veeb)

```bash
cp .env.example .env   # täida N8N_WEBHOOK_URL ja N8N_API_KEY (server only)
npm install
npm run dev
```

Ava [http://127.0.0.1:43127](http://127.0.0.1:43127).

### Keskkonnamuutujad

| Muutuja | Kus | Kirjeldus |
|---------|-----|-----------|
| `N8N_WEBHOOK_URL` | **Server only** (Vite proxy, Vercel `api/`) | n8n webhook URL — ei kuulu Capaciitori bundlisse |
| `N8N_API_KEY` | **Server only** | Header Auth väärtus päisele `X-N8N-API-KEY` |
| `VITE_API_BASE_URL` | Client / **nõutav native buildis** | Absoluutne API host (nt `https://parkimine.ee`) Capaciitori WebView jaoks |
| `VITE_SITE_URL` | Client | Canonical / OG URL (ilma lõpuslashita) |
| `VITE_ALLOW_INDEXING` | Client | `true` lubab indekseerimise; vaikimisi `false` |
| `VITE_CF_WEB_ANALYTICS_TOKEN` / `VITE_PLAUSIBLE_DOMAIN` | Client | Valikuline analüütika |

Brauserer / native klient kutsub ainult `/api/*` (või `VITE_API_BASE_URL` + `/api/*`). Ära commit’i `.env` faili — ainult `.env.example` / `.env.mobile.example`.

## iOS (Capacitor)

App ID: `ee.parkimine.app` · nimi: **Parkimine** · `webDir`: `dist` (`capacitor.config.json`).

### Eeltingimused

1. macOS + Xcode + CocoaPods (`sudo gem install cocoapods`).
2. Tootmisveeb peab olema üleval (Vercel vms), sest native shellil **ei ole** Vite/Vercel `/api` proxy’t.
3. Seadista native buildi jaoks API host:

```bash
cp .env.mobile.example .env.mobile
# Muuda VITE_API_BASE_URL oma live hostiks, nt https://parkimine.ee
```

Või ekspordi CI-s:

```bash
export VITE_API_BASE_URL=https://parkimine.ee
export VITE_SITE_URL=https://parkimine.ee
```

### Ehitus ja Xcode

```bash
npm install
# Esimene kord (ios/ kaust):
npx cap add ios

# Iga web-muudatuse järel:
npm run build:mobile   # või: VITE_API_BASE_URL=… npm run build
npx cap sync ios
npx cap open ios       # avab Xcode
```

Lühike alias: `npm run cap:ios` (build + sync + open; kasuta `build:mobile` kui vajad `.env.mobile` / mode `mobile`).

Vite `mode=mobile` loeb `.env.mobile` (ja `.env`). Veendu, et `VITE_API_BASE_URL` on seatud **enne** `vite build`, muidu API päringud lähevad `capacitor://localhost` peale.

### Serveri (tootmise) muutujad

Native app ei näe `N8N_*` võtmeid. Need peavad olema seadistatud **hostingus**, mida `VITE_API_BASE_URL` sihib:

| Muutuja | Hosting (Vercel / Node) |
|---------|-------------------------|
| `N8N_WEBHOOK_URL` | Jah — `/api/parkimine` proxy |
| `N8N_API_KEY` | Jah — süstitakse `X-N8N-API-KEY` päisesse |

CORS: kui API on teisel domeenil kui Capaciitori origin, peab backend lubama Capaciitori skeme / App Transport. Lihtsaim tee: kasuta sama tootmisdomeeni (`VITE_API_BASE_URL=https://your-vercel-app`) ja Verceli olemasolevaid `/api/*` rewrite’e.

### Info.plist / õigused (Xcode)

Lisa asukoha kasutus (kaart + GPS):

- `NSLocationWhenInUseUsageDescription` — nt „Kasutame asukohta lähimate parklate ja marsruudi jaoks.“

## Zoom LOD (tasemed)

| Zoom | Vaade | Mis kuvatakse |
|------|--------|----------------|
| **&lt; 13** | Linnaosa | Ainult linnaosade märgid (Vanalinn, Kesklinn, Mustamäe, …) |
| **13–15** | Tsoon | Verifitseeritud parkla-polügoonid (Tasuline / Kellaga / Tasuta / hall) |
| **≥ 15** | Detail | Lotid + märgid, kellaga tsoonid, EV, INVA |

Sildid ei kattu: `text-allow-overlap` / `icon-allow-overlap` on `false`; madalama prioriteediga sildid (INVA, EV) peavad loti-nimedele teed andma.

**Tänava-/teeäärseid polyline-overlay’sid ei joonistata** — baaskaardi teed jäävad standardseks; kaardil on ainult verifitseeritud off-street parkla polügoonid ja märgid.

## Andmed

- `public/data/estonia_parking_master.geojson` / `ee_parking_max.geojson` — Eesti OSM-stiilis parkimiskiht. Laadimisel kasutatakse **ainult lot-polügoone**; street_side / curb LineString’id jäetakse tühjaks (`src/lib/estoniaParkingMaster.ts`).
- `public/data/nomme_verified_lots.geojson` — **ainult** verifitseeritud Nõmme platsid (Laagri P&R, Nõmme–Harku terviseraja parklaid). Juhuslikke OSM-lotte Nõmmel ei kuvata (`src/lib/nommeEnrichment.ts`).
- Klassifikatsioon (ainult lotid): **Tasuta** = roheline (ainult verifitseeritud piiramatu 24/7 tasuta); **Kellaga** = kollane (kellaga / aegpiirang); **Tasuline** = punane; märgendita / unknown → **hall** (mitte roheline).
- `public/data/parnu_parking_master.geojson` — Pärnu OSM-parkimine (bbox extract). Tsoonireeglid (`src/data/parnuZones.ts` + `freeRules`) määravad FREE/KELL sildid, hinnad ja „praegu tasuta“. gis.parnu.ee FeatureServer ei olnud build-keskkonnast kättesaadav; ametlik ajakava on parnu.ee/parkimine järgi.
- `src/data/parnuChargers.ts` — EV seemned (Eleport Niidu 18b 200 kW, Neste 200 kW, Tesla Supercharger).
- `public/data/districts.geojson` — ametlikud Tallinna 8 linnaosa + Vanalinn (Tallinn GIS → EPSG:4326, ≤5 m simplify, mere mask, topoloogia). Ehita: `npm run build:districts`. Kontrolli: `npm run check:districts`.
- Lotid: täide klassifikatsiooni värviga (punane / kollane / roheline / hall), 2px ääris; klõps avab bottom sheet’i (operaator, hind, tasuta minutid + Waze / Google / Apple). Otsingu Destination Interceptor suunab ≤400 m lähima parkla tsentroidile.

## Funktsioonid

- **Viewport bbox** — ainult ekraanil nähtavad kohad
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
