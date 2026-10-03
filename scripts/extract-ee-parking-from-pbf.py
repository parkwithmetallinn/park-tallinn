#!/usr/bin/env python3
"""
Extract maximum Estonian parking coverage from a Geofabrik PBF into GeoJSON.

Reads:  /tmp/estonia.osm.pbf (or $EE_OSM_PBF)
Writes: public/data/ee_parking_max.raw.geojson
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "ee_parking_max.raw.geojson"
PBF = Path(os.environ.get("EE_OSM_PBF", "/tmp/estonia.osm.pbf"))


def has_lane_tags(tags: dict[str, str]) -> bool:
    return any(
        k.startswith("parking:lane")
        or k.startswith("parking:both")
        or k.startswith("parking:left")
        or k.startswith("parking:right")
        for k in tags
    )


def is_parking_tags(tags: dict[str, str]) -> bool:
    amenity = tags.get("amenity", "")
    if amenity in ("parking", "parking_space"):
        return True
    if tags.get("parking") == "park_and_ride":
        return True
    if tags.get("tourism") == "caravan_site":
        return True
    if tags.get("leisure") == "picnic_site" and (
        "parking" in tags or amenity == "parking"
    ):
        return True
    if has_lane_tags(tags):
        return True
    op = (tags.get("operator") or "").lower()
    name = (tags.get("name") or "").lower()
    if amenity == "parking" and ("rmk" in op or "rmk" in name):
        return True
    return False


class ParkingHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.features: list[dict] = []

    def _props(self, obj) -> dict:
        tags = {t.k: t.v for t in obj.tags}
        props = {"@id": f"{obj.type_str()}/{obj.id}", **tags}
        return props

    def node(self, n) -> None:
        tags = {t.k: t.v for t in n.tags}
        if not is_parking_tags(tags):
            return
        if not n.location.valid():
            return
        self.features.append(
            {
                "type": "Feature",
                "id": f"node/{n.id}",
                "properties": self._props(n),
                "geometry": {
                    "type": "Point",
                    "coordinates": [n.location.lon, n.location.lat],
                },
            }
        )

    def way(self, w) -> None:
        tags = {t.k: t.v for t in w.tags}
        if not is_parking_tags(tags):
            return
        coords = []
        for node in w.nodes:
            if node.location.valid():
                coords.append([node.location.lon, node.location.lat])
        if len(coords) < 2:
            return
        closed = (
            len(coords) >= 4
            and coords[0][0] == coords[-1][0]
            and coords[0][1] == coords[-1][1]
        )
        amenity = tags.get("amenity", "")
        is_area = closed and amenity in ("parking", "parking_space") and not has_lane_tags(
            tags
        )
        if is_area or tags.get("tourism") == "caravan_site" and closed:
            geom = {"type": "Polygon", "coordinates": [coords]}
        else:
            geom = {"type": "LineString", "coordinates": coords}
        self.features.append(
            {
                "type": "Feature",
                "id": f"way/{w.id}",
                "properties": self._props(w),
                "geometry": geom,
            }
        )

    def relation(self, r) -> None:
        tags = {t.k: t.v for t in r.tags}
        if not is_parking_tags(tags):
            return
        # Multipolygon parking — collect outer rings when available via members
        # pyosmium relations don't always include full geometry without areas;
        # skip incomplete relations (ways already captured).
        return


def main() -> int:
    if not PBF.exists():
        print(f"Missing PBF: {PBF}", file=sys.stderr)
        return 1
    print(f"[pbf-extract] reading {PBF}")
    handler = ParkingHandler()
    # locations=True resolves node refs on ways
    handler.apply_file(str(PBF), locations=True, idx="flex_mem")
    fc = {
        "type": "FeatureCollection",
        "name": "ee_parking_max_raw",
        "properties": {
            "source": "Geofabrik estonia-latest.osm.pbf",
            "featureCount": len(handler.features),
        },
        "features": handler.features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc), encoding="utf-8")
    mb = OUT.stat().st_size / (1024 * 1024)
    print(f"[pbf-extract] wrote {OUT} features={len(handler.features)} (~{mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
