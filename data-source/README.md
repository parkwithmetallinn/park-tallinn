# data-source

Build / regeneratsiooni GeoJSON-allikad — **ei kuulu** Vite `public/` ega Capacitori äppi.

Runtime (shipped) failid on `public/data/`:

- `ee_parking_max.geojson`
- `parnu_parking_master.geojson`
- `nomme_verified_lots.geojson`
- `ev_chargers.geojson`

Siin:

| Fail | Roll |
|------|------|
| `ee_parking_max.raw.geojson` | Overpass/PBF extract → `npm run build:parking-max` |
| `estonia_parking_master.geojson` | Merge-allikas buildile / aadressi-precompute |
| `tallinn_free_streets.geojson` | Street extract (overlay’d runtime’is keelatud) |
| `nomme_free_streets.geojson` | Nõmme street extract (samuti mitteshipitud) |
| `city_zones.geojson` | Build-time tsoonirõngad |
| `districts.geojson` | Linnaosade allikas → `src/data/districts.json` |
