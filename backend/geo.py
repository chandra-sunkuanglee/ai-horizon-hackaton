"""Build map layers from the county parcel boundary file.

Usage:  python backend/geo.py        (after clean.py)
Reads:  ./parcel boundary.csv  (county parcels: PIN, MUNICODE, hex WKB polygons in lon/lat)
Writes: data/municipalities.geojson  one shape per MUNICODE (Pittsburgh split into its wards)
        data/parcel_points.parquet   a point inside each parcel, joined to sales by PIN = PARID
"""
from __future__ import annotations

import glob
import json
import time
from pathlib import Path

import pandas as pd
import shapely

from clean import muni_group, normalize_muni

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"

# Parcels don't cover streets, so merging them leaves road-shaped gaps. Grow each parcel by
# ~35 m, merge, then shrink back ("morphological closing") to get solid municipality shapes.
CLOSE_DEG = 0.0004
SIMPLIFY_DEG = 0.00015


def muni_names() -> dict[str, str]:
    raw = pd.concat(
        [pd.read_csv(f, dtype=str, usecols=["MUNICODE", "MUNIDESC"]) for f in glob.glob(str(ROOT / "20*.csv"))]
    ).dropna()
    return raw.groupby("MUNICODE")["MUNIDESC"].first().map(normalize_muni).to_dict()


def main() -> None:
    t0 = time.time()
    parcels = pd.read_csv(
        ROOT / "parcel boundary.csv", usecols=["PIN", "MUNICODE", "dataspatial_wkb"], dtype=str
    ).dropna(subset=["dataspatial_wkb"])
    parcels["geom"] = shapely.from_wkb(parcels["dataspatial_wkb"].str[2:].values)
    parcels = parcels.drop(columns="dataspatial_wkb")
    print(f"parsed {len(parcels):,} parcels in {time.time() - t0:.0f}s")

    # One interior point per parcel (point_on_surface is always inside, unlike a centroid).
    pts = shapely.point_on_surface(parcels["geom"].values)
    coords = shapely.get_coordinates(pts)
    pd.DataFrame({"parcel_id": parcels["PIN"].values, "lon": coords[:, 0].round(6), "lat": coords[:, 1].round(6)}) \
        .drop_duplicates("parcel_id").to_parquet(OUT / "parcel_points.parquet", index=False)

    names = muni_names()
    features = []
    for code, group in parcels.groupby("MUNICODE"):
        if code not in names:  # parcel-only codes with no sales (e.g. 0 / 999 placeholders)
            continue
        geoms = shapely.make_valid(group["geom"].values)
        shape = shapely.union_all(shapely.buffer(geoms, CLOSE_DEG, quad_segs=2))
        shape = shape.buffer(-CLOSE_DEG, quad_segs=2).simplify(SIMPLIFY_DEG, preserve_topology=True)
        name = names[code]
        features.append(
            {
                "type": "Feature",
                "properties": {"municode": code, "name": name, "muni_group": muni_group(name)},
                "geometry": json.loads(shapely.to_geojson(shapely.set_precision(shape, 1e-5))),
            }
        )
    (OUT / "municipalities.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    size = (OUT / "municipalities.geojson").stat().st_size / 1e6
    print(f"{len(features)} municipality shapes ({size:.1f} MB) in {time.time() - t0:.0f}s total")


if __name__ == "__main__":
    main()
