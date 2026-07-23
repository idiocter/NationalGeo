#!/usr/bin/env python3
"""Ingest land-cover rasters for a new dataset version.

Discovers GeoTIFFs by year pattern in a source directory, runs full
validation (CRS, resolution, class codes), converts to COG, and registers
the dataset version in the database.

Usage:
    # Ingest from a directory where files are named YYYY.tif or lc_YYYY.tif
    python -m backend.scripts.ingest_rasters \\
        --source-dir data/rasters/raw/v3.1 \\
        --version landcover-v3.1 \\
        --source-url "https://icimod.org/datasets/..." \\
        --license "CC-BY-4.0" \\
        --note "Initial ingest from ICIMOD Nepal land cover dataset" \\
        [--years 2000-2022] \\
        [--dry-run]

Expected filename patterns:
    2000.tif, 2001.tif, ... 2022.tif
    lc_2000.tif, lc_2001.tif, ...
    nepal_landcover_2000.tif, ...
    Any file containing a 4-digit year 2000–2030 in its name.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

YEAR_PATTERN = re.compile(r"(20[0-2][0-9])")


def discover_rasters(source_dir: Path, year_range: tuple[int, int]) -> dict[int, Path]:
    """Find all .tif files in source_dir that contain a year in [year_range]."""
    found: dict[int, Path] = {}
    for path in sorted(source_dir.glob("*.tif")):
        match = YEAR_PATTERN.search(path.stem)
        if match:
            year = int(match.group(1))
            if year_range[0] <= year <= year_range[1]:
                if year in found:
                    logger.warning("Duplicate year %d — keeping first: %s", year, found[year])
                else:
                    found[year] = path
    return found


def run(
    source_dir: Path,
    version: str,
    source_url: str,
    license: str,
    operator_note: str,
    year_range: tuple[int, int],
    dry_run: bool,
) -> int:
    from backend.agents.ingestion.validation import (
        check_class_codes,
        read_metadata,
        validate_grid_alignment,
    )

    raster_paths = discover_rasters(source_dir, year_range)

    if not raster_paths:
        logger.error("No rasters found in %s for years %d–%d", source_dir, *year_range)
        return 1

    logger.info(
        "Found %d rasters (%d–%d) in %s",
        len(raster_paths),
        min(raster_paths),
        max(raster_paths),
        source_dir,
    )

    if dry_run:
        logger.info("[DRY RUN] Validating rasters without registering…")
        try:
            metadatas = [read_metadata(p, y) for y, p in sorted(raster_paths.items())]
        except Exception as exc:
            logger.error("Metadata read failed: %s", exc)
            return 1

        errors = validate_grid_alignment(metadatas)
        if errors:
            for e in errors:
                logger.error("  Grid alignment: %s", e)
            return 1
        logger.info("  Grid alignment: OK")

        for meta in metadatas:
            from backend.agents.ingestion.validation import compute_class_histogram
            hist = compute_class_histogram(meta.path)
            code_errors = check_class_codes(hist)
            if code_errors:
                for e in code_errors:
                    logger.error("  Year %d: %s", meta.year, e)
            else:
                logger.info(
                    "  Year %d: OK — %d classes, %d total pixels",
                    meta.year,
                    len(hist),
                    sum(hist.values()),
                )
        logger.info("[DRY RUN] Validation complete — no DB writes performed.")
        return 0

    # Full ingestion
    from backend.agents.ingestion.agent import IngestionAgent
    from backend.database_sync import get_sync_db

    logger.info("Starting ingestion of version '%s'…", version)
    with get_sync_db() as db:
        agent = IngestionAgent(db)
        result = agent.ingest_landcover(
            raster_paths=raster_paths,
            version=version,
            source_url=source_url,
            license=license,
            operator_note=operator_note,
        )

    if not result.success:
        logger.error("Ingestion failed:")
        for e in result.errors:
            logger.error("  %s", e)
        return 1

    logger.info("Ingestion complete:")
    logger.info("  Version  : %s", result.dataset_version)
    logger.info("  Years    : %s", result.years_ingested)
    logger.info("  COGs     : %d files", len(result.cog_paths))
    for year, path in sorted(result.cog_paths.items()):
        logger.info("    %d → %s", year, path)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest land-cover rasters into NGLIP"
    )
    parser.add_argument(
        "--source-dir", required=True, type=Path,
        help="Directory containing raw GeoTIFF files named with 4-digit years",
    )
    parser.add_argument(
        "--version", required=True,
        help="Dataset version string, e.g. 'landcover-v3.1'",
    )
    parser.add_argument("--source-url", default="", help="URL to the source dataset")
    parser.add_argument("--license", default="", help="Dataset license identifier")
    parser.add_argument("--note", default="", dest="operator_note", help="Operator note")
    parser.add_argument(
        "--years", default="2000-2022",
        help="Year range to ingest (default: 2000-2022). Format: YYYY-YYYY",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Validate rasters without writing to the database",
    )
    args = parser.parse_args()

    if not args.source_dir.is_dir():
        logger.error("Source directory not found: %s", args.source_dir)
        sys.exit(1)

    year_parts = args.years.split("-")
    if len(year_parts) != 2:
        logger.error("--years must be in YYYY-YYYY format, got: %s", args.years)
        sys.exit(1)
    year_range = (int(year_parts[0]), int(year_parts[1]))

    sys.exit(
        run(
            source_dir=args.source_dir,
            version=args.version,
            source_url=args.source_url,
            license=args.license,
            operator_note=args.operator_note,
            year_range=year_range,
            dry_run=args.dry_run,
        )
    )


if __name__ == "__main__":
    main()
