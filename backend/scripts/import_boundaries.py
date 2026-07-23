#!/usr/bin/env python3
"""Import Nepal municipal boundary files into PostGIS.

Reads a GeoPackage or Shapefile containing Nepal's 753 local units, fixes
invalid geometries, and upserts into the municipalities table.

Usage:
    python -m backend.scripts.import_boundaries \\
        --file data/boundaries/nepal_local_units.gpkg \\
        --layer local_units \\
        [--dry-run]

Required columns in the source file:
    - id or HLCODErev : municipality code (e.g. "np-bag-ktm-01")
    - NAME_EN         : English name
    - NAME_NP         : Nepali name (optional)
    - PROVINCE        : Province name
    - DISTRICT        : District name
    - TYPE            : metropolitan / sub_metropolitan / municipality / rural_municipality
    - AREA_KM2        : total area in km² (optional)
    - POPULATION      : census population (optional)
    - geometry        : polygon/multipolygon in WGS84 (EPSG:4326)
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

TYPE_MAP = {
    "metropolitan city": "metropolitan",
    "sub-metropolitan city": "sub_metropolitan",
    "sub metropolitan city": "sub_metropolitan",
    "municipality": "municipality",
    "rural municipality": "rural_municipality",
    "rural_municipality": "rural_municipality",
}


def _normalise_type(raw: str) -> str:
    return TYPE_MAP.get(raw.lower().strip(), "municipality")


def run(file: Path, layer: str | None, dry_run: bool) -> int:
    import geopandas as gpd
    from sqlalchemy import text

    from backend.database_sync import get_sync_db

    logger.info("Reading %s%s…", file, f" (layer: {layer})" if layer else "")
    gdf = gpd.read_file(file, layer=layer)
    logger.info("Loaded %d features", len(gdf))

    # Fix invalid geometries
    invalid = (~gdf.geometry.is_valid).sum()
    if invalid:
        logger.warning("Fixing %d invalid geometries with buffer(0)…", invalid)
        gdf["geometry"] = gdf.geometry.buffer(0)

    # Ensure WGS84
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        logger.info("Reprojecting from EPSG:%d to EPSG:4326…", gdf.crs.to_epsg())
        gdf = gdf.to_crs(epsg=4326)

    # Normalise column names
    cols = {c.lower(): c for c in gdf.columns}

    def col(candidates: list[str], default: str | None = None) -> str | None:
        for c in candidates:
            if c in cols:
                return cols[c]
        return default

    id_col = col(["hlcoderev", "id", "code", "local_id"])
    name_col = col(["name_en", "name", "local_name_en"])
    name_np_col = col(["name_np", "local_name_np"])
    province_col = col(["province", "province_en", "pr_name"])
    district_col = col(["district", "district_en", "dt_name"])
    type_col = col(["type", "local_type"])
    area_col = col(["area_km2", "area"])
    pop_col = col(["population", "pop"])

    if not id_col or not name_col:
        logger.error("Cannot find required id/name columns. Columns found: %s", list(gdf.columns))
        return 1

    if dry_run:
        logger.info("[DRY RUN] Would import %d municipalities — skipping DB write.", len(gdf))
        for _, row in gdf.iterrows():
            logger.info("  %s — %s", row[id_col], row[name_col])
        return 0

    imported = 0
    skipped = 0

    with get_sync_db() as db:
        for _, row in gdf.iterrows():
            mun_id = str(row[id_col]).strip()
            name = str(row[name_col]).strip()
            name_np = str(row[name_np_col]).strip() if name_np_col else None
            province = str(row[province_col]).strip() if province_col else "Unknown"
            district = str(row[district_col]).strip() if district_col else "Unknown"
            mun_type = _normalise_type(str(row[type_col])) if type_col else "municipality"
            area = float(row[area_col]) if area_col and row[area_col] else None
            population = int(row[pop_col]) if pop_col and row[pop_col] else None

            geom_wkt = row.geometry.wkt if row.geometry else None
            if not geom_wkt:
                logger.warning("Skipping %s — no geometry", mun_id)
                skipped += 1
                continue

            db.execute(
                text(
                    """
                    INSERT INTO municipalities
                        (id, name, name_np, province, district, type,
                         total_area_km2, population, geom)
                    VALUES
                        (:id, :name, :name_np, :province, :district, :type,
                         :area, :population,
                         ST_MakeValid(ST_Multi(ST_GeomFromText(:geom, 4326))))
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        name_np = EXCLUDED.name_np,
                        province = EXCLUDED.province,
                        district = EXCLUDED.district,
                        type = EXCLUDED.type,
                        total_area_km2 = EXCLUDED.total_area_km2,
                        population = EXCLUDED.population,
                        geom = EXCLUDED.geom
                    """
                ),
                {
                    "id": mun_id,
                    "name": name,
                    "name_np": name_np,
                    "province": province,
                    "district": district,
                    "type": mun_type,
                    "area": area,
                    "population": population,
                    "geom": geom_wkt,
                },
            )
            imported += 1

        db.commit()

    logger.info("Done — imported: %d, skipped: %d", imported, skipped)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import Nepal municipal boundaries into PostGIS"
    )
    parser.add_argument("--file", required=True, type=Path, help="GeoPackage or Shapefile path")
    parser.add_argument("--layer", default=None, help="Layer name (GeoPackage only)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be imported without writing to DB",
    )
    args = parser.parse_args()

    if not args.file.exists():
        logger.error("File not found: %s", args.file)
        sys.exit(1)

    sys.exit(run(args.file, args.layer, args.dry_run))


if __name__ == "__main__":
    main()
