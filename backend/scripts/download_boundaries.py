#!/usr/bin/env python3
"""Download Nepal local-unit boundaries from OCHA COD and prepare for import.

Source: OCHA Common Operational Dataset – Nepal Admin Boundaries
        https://data.humdata.org/dataset/cod-ab-npl

Downloads Admin Level-3 (local units / municipalities, ~775 features),
normalises column names to match import_boundaries.py, infers municipality
type where possible, and saves to data/boundaries/nepal_local_units.gpkg.

Usage (from repo root):
    python -m backend.scripts.download_boundaries
    # then import into PostGIS:
    make import-boundaries
"""
from __future__ import annotations

import io
import logging
import sys
import zipfile
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

OCHA_ZIP_URL = (
    "https://data.humdata.org/dataset/07db728a-4f0f-4e98-8eb0-8fa9df61f01c"
    "/resource/191e22eb-f21e-48f0-9180-872eeda0b8b6"
    "/download/npl_admin_boundaries.geojson.zip"
)
ADMIN3_FILE = "npl_admin3.geojson"
OUTPUT = Path("data/boundaries/nepal_local_units.gpkg")

# Known Metropolitan Cities (6) — as of 2017 restructuring
_METROPOLITAN: set[str] = {
    "Kathmandu", "Pokhara", "Lalitpur", "Bharatpur", "Biratnagar", "Birgunj",
}

# Known Sub-Metropolitan Cities (11)
_SUB_METROPOLITAN: set[str] = {
    "Dharan", "Hetauda", "Itahari", "Butwal", "Dhangadhi", "Tulsipur",
    "Siddharthanagar", "Janakpur", "Ghorahi", "Nepalgunj", "Kalaiya",
}

# pcode prefixes for predominantly rural provinces help as a secondary signal,
# but name-based lookup is more reliable for the metro/sub-metro cases.


def _infer_type(name: str) -> str:
    if name in _METROPOLITAN:
        return "metropolitan"
    if name in _SUB_METROPOLITAN:
        return "sub_metropolitan"
    # OCHA names don't include the type suffix, so we can't distinguish
    # "municipality" from "rural_municipality" by name alone. Default to
    # municipality; the field is display-only and doesn't affect analysis.
    return "municipality"


def _download_zip(url: str) -> bytes:
    try:
        import requests
    except ImportError:
        logger.error("pip install requests")
        sys.exit(1)

    logger.info("Downloading %s …", url)
    resp = requests.get(url, stream=True, timeout=300)
    resp.raise_for_status()

    total = int(resp.headers.get("Content-Length", 0))
    buf = bytearray()
    for chunk in resp.iter_content(chunk_size=1 << 17):
        buf.extend(chunk)
        if total:
            pct = 100 * len(buf) / total
            print(f"\r  {len(buf)/1e6:.1f} / {total/1e6:.1f} MB  ({pct:.0f}%)", end="", flush=True)
    print()
    return bytes(buf)


def main() -> None:
    try:
        import geopandas as gpd
    except ImportError:
        logger.error("pip install geopandas pyogrio requests")
        sys.exit(1)

    if OUTPUT.exists():
        logger.info("Already exists: %s  (delete to re-download)", OUTPUT)
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    raw = _download_zip(OCHA_ZIP_URL)
    logger.info("Downloaded %.1f MB", len(raw) / 1e6)

    logger.info("Extracting %s …", ADMIN3_FILE)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        if ADMIN3_FILE not in zf.namelist():
            logger.error("Expected %s in zip. Found: %s", ADMIN3_FILE, zf.namelist())
            sys.exit(1)
        with zf.open(ADMIN3_FILE) as f:
            gdf = gpd.read_file(f)

    logger.info("Loaded %d features", len(gdf))

    # Ensure WGS84
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        logger.info("Reprojecting → EPSG:4326 …")
        gdf = gdf.to_crs(epsg=4326)

    # Rename OCHA columns → import_boundaries.py expectations
    gdf = gdf.rename(columns={
        "adm3_pcode": "id",
        "adm3_name":  "NAME_EN",
        "adm3_name1": "NAME_NP",
        "adm1_name":  "PROVINCE",
        "adm2_name":  "DISTRICT",
        "area_sqkm":  "AREA_KM2",
    })

    # Infer municipality type from known metro/sub-metro lists
    gdf["TYPE"] = gdf["NAME_EN"].apply(_infer_type)

    type_counts = gdf["TYPE"].value_counts()
    logger.info("Type breakdown: %s", type_counts.to_dict())

    # Keep only import-relevant columns
    keep = [c for c in
            ["id", "NAME_EN", "NAME_NP", "PROVINCE", "DISTRICT",
             "TYPE", "AREA_KM2", "geometry"]
            if c in gdf.columns]
    gdf = gdf[keep]

    logger.info("Sample:")
    for _, row in gdf.head(3).iterrows():
        logger.info("  %s — %s — %s / %s — %s",
                    row["id"], row["NAME_EN"], row["DISTRICT"],
                    row["PROVINCE"], row["TYPE"])

    logger.info("Saving to %s …", OUTPUT)
    gdf.to_file(OUTPUT, driver="GPKG", engine="pyogrio")
    logger.info("Saved %d municipalities", len(gdf))
    logger.info("")
    logger.info("Next: run  make import-boundaries")


if __name__ == "__main__":
    main()
