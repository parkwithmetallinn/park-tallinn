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

**Rakendusse (Vite `public/` → `dist/`) lähevad ainult runtime-failid:**

- `public/data/ee_parking_max.geojson` — Eesti OSM-stiilis parkimiskiht. Laadimisel kasutatakse **ainult lot-polügoone**; street_side / curb LineString’id jäetakse tühjaks (`src/lib/estoniaParkingMaster.ts`).
- `public/data/nomme_verified_lots.geojson` — **ainult** verifitseeritud Nõmme platsid (Laagri P&R, Nõmme–Harku terviseraja parklaid). Juhuslikke OSM-lotte Nõmmel ei kuvata (`src/lib/nommeEnrichment.ts`).
- `public/data/parnu_parking_master.geojson` — Pärnu OSM-parkimine (bbox extract). Tsoonireeglid (`src/data/parnuZones.ts` + `freeRules`) määravad FREE/KELL sildid, hinnad ja „praegu tasuta“.
- `public/data/ev_chargers.geojson` — EV laadijad (OSM extract).
- Klassifikatsioon (ainult lotid): **Tasuta** = roheline; **Kellaga** = kollane; **Tasuline** = punane; unknown → **hall**.
- `src/data/parnuChargers.ts` — EV seemned (Eleport / Neste / Tesla).
- `src/data/districts.json` — Tallinna linnaosad (bundled). Allikas regeneratsiooniks: `data-source/districts.geojson` (`npm run build:districts` / `check:districts`).

**Build / regeneratsioon (ei lähe äppi):** `data-source/` — nt `ee_parking_max.raw.geojson`, `estonia_parking_master.geojson`, `tallinn_free_streets.geojson`, `nomme_free_streets.geojson`, `city_zones.geojson`, `districts.geojson`.

Lotid: täide klassifikatsiooni värviga, 2px ääris; klõps avab bottom sheet’i. Otsingu Destination Interceptor suunab ≤400 m lähima parkla tsentroidile.

## Funktsioonid

- **Viewport bbox** — ainult ekraanil nähtavad kohad
- **Nominatim otsing** — `/api/nominatim` proxy (Vite / Vercel)
- **Bottom sheet** — Waze, Google Maps, Apple Maps navigeerimine
- **Floating UI** — ümarad paneelid solid ~95% taustaga (ilma backdrop-blur’ita, et MapLibre püsiks 60 FPS)
- **Mobiili bottom sheet** — detail + lähimad parklad max-h-[45dvh], swipe-dismiss, safe-area inset
- **Menüü (☰)** — vasakul otsingu kõrval: Profiil (kohalik localStorage), Seaded (`parking-app:settings`), Abi ja tagasiside (FAQ + `POST /api/feedback` tüüp `APP_FEEDBACK`). Autentimist pole.
- **Mitmekeelsus (et / en / ru)** — kerge kontekst + sõnastikud `src/i18n/{et,en,ru}.ts`. Seadme keel (`navigator.language`) → käsitsi Teave / Seaded paneelis → `localStorage` (`parkvibe_locale_v1` + `parking-app:settings`). Kuupäev/raha: `Intl` + `Europe/Tallinn`. Serveri eestikeelne `message` ainult kui UI keel on `et`; muidu tõlge `code` järgi. Võtmete pariteet: `npm run test:i18n`.

## Parkimissessioon (n8n)

Bottom sheet / kellapaneel saadavad POST same-origin `/api/parkimine` proxy kaudu
(server lisab `X-N8N-API-KEY` `N8N_API_KEY` keskkonnamuutujast).
Klient **ei kogu ega saada** sõiduki numbrimärki — ainult `action` + `zone` / `endsAt` / meeldetuletused:

```json
{ "action": "start", "zone": "KESKLINN" }
```

```json
{ "action": "stop", "zone": "KESKLINN" }
```

```json
{ "action": "status" }
```

```json
{ "action": "extend", "endsAt": "2026-10-11T12:00:00.000Z" }
```

```json
{ "action": "notify", "email": "nimi@email.ee" }
```

- **start** / **stop** — nõuavad `zone` (ilma numbrimärgita)
- **status** — `{ activeSessions[], count }` või aktiivse sessiooni detailid
- **extend** / **notify** — ettemaksu pikendus ja push/e-posti meeldetuletus
- Vastused normaliseeritakse `ACTIVE` | `NOT_FOUND` | `ERROR` (`src/lib/parkingSession.ts`). `NOT_FOUND` ei ole viga.
- App load / window focus / visibilitychange (≤1× / 15 s) kutsub `status` kui kohalik sessioon olemas.
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
