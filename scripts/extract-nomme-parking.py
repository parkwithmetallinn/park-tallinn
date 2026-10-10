#!/usr/bin/env python3
"""
Extract Nõmme district free street parking + verified off-street lots.

Streets: public OSM highways clipped to the Tallinn GIS Nõmme district
polygon, tagged as unlimited free (Tasuta) curb parking — matching the
official Tallinn rule that Nõmme public streets are free unless privately
signed.

Lots: ONLY allowlisted OSM ways matched to verified official listings
(Tallinn GIS P&R, terviserajad.ee trailheads). No approximated polygons.

Reads:  /tmp/estonia.osm.pbf (or $EE_OSM_PBF)
        data-source/districts.geojson
Writes: data-source/nomme_free_streets.geojson
        public/data/nomme_verified_lots.geojson  (shipped — runtime allowlist)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import osmium
from shapely.geometry import LineString, mapping, shape

ROOT = Path(__file__).resolve().parents[1]
PBF = Path(os.environ.get("EE_OSM_PBF", "/tmp/estonia.osm.pbf"))
DISTRICTS = ROOT / "data-source" / "districts.geojson"
STREETS_OUT = ROOT / "data-source" / "nomme_free_streets.geojson"
LOTS_OUT = ROOT / "public" / "data" / "nomme_verified_lots.geojson"

# Verified OSM way IDs → metadata. Every lot must have a real geometry source.
VERIFIED_LOTS: dict[int, dict] = {
    754351086: {
        "id": "lot-nomme-laagri-pr",
        "name": "P&R Laagri",
        "address": "Pärnu mnt 550, Nõmme",
        "kind": "park_ride",
        "source_ref": "tallinn_gis_pr + osm/way/754351086",
        "fee": "no",
        "park_ride": "yes",
        "parking": "park_and_ride",
        "operator": "Tallinna Linn",
        "desc": "Ametlik Pargi ja Reisi. Valideeri Ühiskaardiga.",
    },
    1058578454: {
        "id": "lot-nomme-kirdeparkla",
        "name": "Nõmme Spordikeskus / Kirdeparkla",
        "address": "Külmallika tn 15a, Nõmme",
        "kind": "trailhead",
        "source_ref": "terviserajad.ee + osm/way/1058578454",
        "fee": "no",
        "parking": "surface",
        "operator": "Nõmme Spordikeskus",
        "desc": "Nõmme–Harku terviseradade Kirdeparkla — tasuta avalik parkla.",
    },
    181458718: {
        "id": "lot-nomme-hiiu-trail",
        "name": "Nõmme–Harku terviseraja Hiiu parkla",
        "address": "Hiiu, Nõmme",
        "kind": "trailhead",
        "source_ref": "terviserajad place listing + osm/way/181458718",
        "fee": "no",
        "parking": "surface",
        "operator": "Nõmme Spordikeskus",
        "desc": "Hiiu terviseraja parkla — tasuta avalik parkla.",
    },
    181458740: {
        "id": "lot-nomme-harku-metsa",
        "name": "Harku metsa parkla",
        "address": "Harku mets, Nõmme",
        "kind": "trailhead",
        "source_ref": "place listing + osm/way/181458740",
        "fee": "no",
        "parking": "surface",
        "operator": "Avalik",
        "desc": "Harku metsa / terviseraja trailhead — tasuta avalik parkla.",
    },
    1132219471: {
        "id": "lot-nomme-harku-metsa-vaike",
        "name": "Harku metsa väike parkla",
        "address": "Harku mets, Nõmme",
        "kind": "trailhead",
        "source_ref": "place listing + osm/way/1132219471",
        "fee": "no",
        "parking": "surface",
        "operator": "Avalik",
        "desc": "Harku metsa väike trailhead parkla — tasuta avalik parkla.",
    },
}

PUBLIC_HIGHWAYS = {
    "residential",
    "living_street",
    "tertiary",
    "tertiary_link",
    "secondary",
    "secondary_link",
    "unclassified",
    "primary",
    "primary_link",
}
SKIP_ACCESS = {"private", "no", "customers", "residents", "employees", "delivery"}


def load_nomme_polygon():
    dist = json.loads(DISTRICTS.read_text())
    for feat in dist["features"]:
        if feat.get("properties", {}).get("id") == "nomme":
            return shape(feat["geometry"])
    raise SystemExit("Nõmme district not found in districts.geojson")


class Extractor(osmium.SimpleHandler):
    def __init__(self, poly) -> None:
        super().__init__()
        self.poly = poly
        self.street_feats: list[dict] = []
        self.lot_feats: list[dict] = []
        self.seen_streets: set[str] = set()

    def way(self, w) -> None:
        tags = {t.k: t.v for t in w.tags}
        coords: list[tuple[float, float]] = []
        for n in w.nodes:
            if n.location.valid():
                coords.append((n.location.lon, n.location.lat))
        if len(coords) < 2:
            return

        if w.id in VERIFIED_LOTS:
            self._emit_lot(w.id, coords, VERIFIED_LOTS[w.id])
            return

        hw = tags.get("highway")
        if hw not in PUBLIC_HIGHWAYS:
            return
        if tags.get("area") == "yes":
            return
        access = (tags.get("access") or "").lower()
        if access in SKIP_ACCESS:
            return

        lane_vals = []
        for k, v in tags.items():
            if (
                k.startswith("parking:lane")
                or k.startswith("parking:both")
                or k.startswith("parking:left")
                or k.startswith("parking:right")
            ):
                lane_vals.append(v.lower())
        if lane_vals and all(v in ("no", "separate") for v in lane_vals):
            return

        line = LineString(coords)
        if not line.intersects(self.poly):
            return
        clipped = line.intersection(self.poly)
        if clipped.is_empty:
            return

        if clipped.geom_type == "LineString":
            parts = [clipped]
        elif clipped.geom_type == "MultiLineString":
            parts = list(clipped.geoms)
        elif clipped.geom_type == "GeometryCollection":
            parts = [g for g in clipped.geoms if g.geom_type == "LineString"]
        else:
            return

        street_name = tags.get("name") or tags.get("name:et") or hw
        for i, part in enumerate(parts):
            if part.length < 1e-5:
                continue
            pc = list(part.coords)
            if len(pc) < 2:
                continue
            fid = f"nomme-street-{w.id}" if i == 0 else f"nomme-street-{w.id}-{i}"
            if fid in self.seen_streets:
                continue
            self.seen_streets.add(fid)
            self.street_feats.append(
                {
                    "type": "Feature",
                    "id": fid,
                    "properties": {
                        "@id": fid,
                        "osm_way": f"way/{w.id}",
                        "amenity": "parking",
                        "parking": "street_side",
                        "fee": "no",
                        "access": "yes",
                        "rules": "free",
                        "name": f"{street_name} — tasuta tänavaparkimine",
                        "addr:street": tags.get("name") or tags.get("name:et") or "",
                        "operator": "Tallinna Linn",
                        "source": "nomme_road_gis",
                        "description": (
                            "Nõmmel on avalikel tänavatel parkimine üldjuhul "
                            "tasuta (Tasuta), välja arvatud eraldi tähistatud "
                            "eraparklad või eraldi piiratud lõigud."
                        ),
                        "highway": hw,
                        "verified_free_hint": True,
                    },
                    "geometry": mapping(part),
                }
            )

    def _emit_lot(self, wid: int, coords: list[tuple[float, float]], meta: dict) -> None:
        ring = list(coords)
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        if len(ring) < 4:
            return
        props = {
            "@id": f"way/{wid}",
            "amenity": "parking",
            "name": meta["name"],
            "fee": meta["fee"],
            "access": "yes",
            "parking": meta["parking"],
            "operator": meta["operator"],
            "address": meta["address"],
            "description": meta["desc"],
            "source": "nomme_verified",
            "source_ref": meta["source_ref"],
            "verified_lot": True,
            "nomme_kind": meta["kind"],
            "rules": "free",
        }
        if meta.get("park_ride"):
            props["park_ride"] = "yes"
            props["parking"] = "park_and_ride"
            props["layer"] = "park_ride"
        else:
            props["layer"] = "free_street"
        self.lot_feats.append(
            {
                "type": "Feature",
                "id": meta["id"],
                "properties": props,
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[list(c) for c in ring]],
                },
            }
        )


def main() -> None:
    if not PBF.exists():
        raise SystemExit(f"Missing PBF: {PBF}")
    poly = load_nomme_polygon()
    print(f"[nomme] extracting from {PBF} …")
    h = Extractor(poly)
    h.apply_file(str(PBF), locations=True)

    streets = {
        "type": "FeatureCollection",
        "name": "nomme_free_streets",
        "properties": {
            "district": "nomme",
            "rule": (
                "All public roads in Nõmme are unlimited free parking (Tasuta) "
                "unless privately signed."
            ),
            "source": "OSM highway network clipped to Tallinn GIS Nõmme district",
            "featureCount": len(h.street_feats),
        },
        "features": h.street_feats,
    }
    lots = {
        "type": "FeatureCollection",
        "name": "nomme_verified_lots",
        "properties": {
            "district": "nomme",
            "rule": "Only allowlisted verified off-street lots — no approximated polygons.",
            "featureCount": len(h.lot_feats),
            "allowlistOsmWays": list(VERIFIED_LOTS.keys()),
        },
        "features": h.lot_feats,
    }

    STREETS_OUT.write_text(
        json.dumps(streets, ensure_ascii=False, separators=(",", ":"))
    )
    LOTS_OUT.write_text(json.dumps(lots, ensure_ascii=False, separators=(",", ":")))
    print(f"[nomme] streets={len(h.street_feats)} → {STREETS_OUT}")
    print(f"[nomme] lots={len(h.lot_feats)} → {LOTS_OUT}")
    for f in h.lot_feats:
        print(f"  · {f['id']}: {f['properties']['name']}")


if __name__ == "__main__":
    main()
