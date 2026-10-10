#!/usr/bin/env python3
"""
Extract Tallinn public-street free parking (Tasuta) outside municipal paid zones.

Clips OSM highways to the union of Tallinn GIS districts, subtracts official
paid-zone rings (Kesklinn / Südalinn / Vanalinn / …), and writes curb
LineStrings tagged as unlimited free. Does NOT invent off-street lots.

Also refreshes Nõmme verified lots via the sibling extract-nomme-parking.py
allowlist (invoked separately).

Reads:  /tmp/estonia.osm.pbf (or $EE_OSM_PBF)
        data-source/districts.geojson
        src/data/parking.ts paid-zone rings (embedded JSON below is generated)
Writes: data-source/tallinn_free_streets.geojson
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import osmium
from shapely.geometry import LineString, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
PBF = Path(os.environ.get("EE_OSM_PBF", "/tmp/estonia.osm.pbf"))
DISTRICTS = ROOT / "data-source" / "districts.geojson"
PARKING_TS = ROOT / "src" / "data" / "parking.ts"
OUT = ROOT / "data-source" / "tallinn_free_streets.geojson"

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


def load_tallinn_union():
    dist = json.loads(DISTRICTS.read_text())
    polys = []
    for feat in dist["features"]:
        if feat.get("properties", {}).get("role") != "district":
            continue
        polys.append(shape(feat["geometry"]))
    if not polys:
        raise SystemExit("No district polygons found")
    return unary_union(polys)


def load_paid_zone_union():
    """Parse PAID_ZONES coords from parking.ts ([lat,lng] → shapely rings)."""
    text = PARKING_TS.read_text()
    # Grab each coords: [ [lat,lng], ... ] block inside PAID_ZONES
    # Simpler: use runtime rings from tallinnZoneEnrichment via a small JSON dump.
    # Fallback: embed known rings by evaluating the exported districts approach —
    # read from a generated file if present, else parse TS loosely.
    rings_path = ROOT / "src" / "data" / "tallinnPaidZoneRings.json"
    if rings_path.exists():
        data = json.loads(rings_path.read_text())
        polys = []
        for ring in data.get("rings", []):
            # ring is [lng,lat]
            if len(ring) >= 3:
                from shapely.geometry import Polygon

                polys.append(Polygon(ring))
        return unary_union(polys) if polys else None

    # Parse [lat, lng] arrays from PAID_ZONES in parking.ts
    blocks = re.findall(
        r"coords:\s*\[((?:.|\n)*?)\],\n\s*note:",
        text,
    )
    from shapely.geometry import Polygon

    polys = []
    for block in blocks:
        pairs = re.findall(
            r"\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]",
            block,
        )
        if len(pairs) < 3:
            continue
        # parking.ts uses [lat, lng] — shapely wants [lng, lat]
        ring = [(float(lng), float(lat)) for lat, lng in pairs]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        try:
            polys.append(Polygon(ring))
        except Exception:
            continue
    # Also include KESKLINN_RING_FIXED from tallinnZoneEnrichment.ts
    enrich = (ROOT / "src" / "lib" / "tallinnZoneEnrichment.ts").read_text()
    m = re.search(
        r"KESKLINN_RING_FIXED[^=]*=\s*\[((?:.|\n)*?)\]\s*",
        enrich,
    )
    if m:
        pairs = re.findall(r"\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]", m.group(1))
        if len(pairs) >= 3:
            ring = [(float(lng), float(lat)) for lat, lng in pairs]
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            try:
                polys.append(Polygon(ring))
            except Exception:
                pass
    return unary_union(polys) if polys else None


class Extractor(osmium.SimpleHandler):
    def __init__(self, free_area) -> None:
        super().__init__()
        self.free_area = free_area
        self.feats: list[dict] = []
        self.seen: set[str] = set()

    def way(self, w) -> None:
        tags = {t.k: t.v for t in w.tags}
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

        coords = []
        for n in w.nodes:
            if n.location.valid():
                coords.append((n.location.lon, n.location.lat))
        if len(coords) < 2:
            return
        line = LineString(coords)
        if not line.intersects(self.free_area):
            return
        clipped = line.intersection(self.free_area)
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
            fid = f"tlh-street-{w.id}" if i == 0 else f"tlh-street-{w.id}-{i}"
            if fid in self.seen:
                continue
            self.seen.add(fid)
            self.feats.append(
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
                        "source": "tallinn_road_gis",
                        "description": (
                            "Avalikel tänavatel väljaspool tasulisi tsoone on "
                            "parkimine üldjuhul tasuta (Tasuta), välja arvatud "
                            "eraldi tähistatud eraparklad või eraldi piiratud lõigud."
                        ),
                        "highway": hw,
                        "verified_free_hint": True,
                    },
                    "geometry": mapping(part),
                }
            )


def main() -> None:
    if not PBF.exists():
        raise SystemExit(f"Missing PBF: {PBF}")
    print("[tallinn] building free-street area (districts − paid zones)…")
    districts = load_tallinn_union()
    paid = load_paid_zone_union()
    free_area = districts.difference(paid) if paid is not None else districts
    print(
        f"[tallinn] free_area approx km²={free_area.area * 111.32 * 111.32 * 0.55:.1f}"
    )
    print(f"[tallinn] extracting from {PBF} …")
    h = Extractor(free_area)
    h.apply_file(str(PBF), locations=True)
    fc = {
        "type": "FeatureCollection",
        "name": "tallinn_free_streets",
        "properties": {
            "rule": (
                "Public streets outside Tallinn municipal paid zones are "
                "unlimited free (Tasuta) unless privately signed."
            ),
            "source": "OSM highway network clipped to Tallinn districts − paid zones",
            "featureCount": len(h.feats),
        },
        "features": h.feats,
    }
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
    print(f"[tallinn] streets={len(h.feats)} → {OUT}")


if __name__ == "__main__":
    main()
