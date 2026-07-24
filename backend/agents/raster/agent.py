"""Raster Analysis Agent — per-municipality, per-year land-cover statistics.

Design rules (non-negotiable):
- All area computation uses EPSG:32645 (UTM Zone 45N, equal-area for Nepal).
- Geometry is re-projected from EPSG:4326 to match the raster CRS before masking.
- all_touched=False on every rasterio.mask call — edge pixels are never counted.
- COG windowed reads: the full national raster is never loaded into memory.
- Nodata pixels (raster fill value AND semantic class code 0) are separated and reported.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.contracts.geo_utils import (
    NEPAL_EQUAL_AREA_EPSG,
    compute_pixel_area_m2,
    pixels_to_km2,
    reproject_geometry,
)
from backend.contracts.models import (
    CLASS_NAMES,
    LandCoverClass,
    LandCoverStatistics,
)

logger = logging.getLogger(__name__)
settings = get_settings()

VALID_CLASS_CODES = frozenset(range(9))  # 0–8
VERSION = "raster_analysis:v0.1.0"


def _cog_path(dataset_version: str, year: int) -> Path:
    return Path(settings.object_store_path) / "landcover" / dataset_version / f"{year}.tif"


def _fetch_geom_wgs84(db: Session, municipality_id: str):
    """Return the municipality geometry as a shapely object in EPSG:4326."""
    from shapely.geometry import shape

    row = db.execute(
        text("SELECT ST_AsGeoJSON(geom) AS geom_json FROM municipalities WHERE id = :id"),
        {"id": municipality_id},
    ).first()
    if row is None:
        raise ValueError(f"Municipality '{municipality_id}' not found")
    return shape(json.loads(row.geom_json))


def analyse_year(
    geom_4326,
    year: int,
    dataset_version: str,
    municipality_id: str,
    boundary_version: str,
    cog_path: Path | None = None,
) -> LandCoverStatistics:
    """Compute land-cover statistics for one municipality in one year.

    Reads: cog_path if provided, else <object_store>/landcover/<version>/<year>.tif
    Returns: LandCoverStatistics (Pydantic contract).
    Raises: FileNotFoundError if the COG is missing.
    """
    import rasterio
    from rasterio.mask import mask as rasterio_mask

    cog = cog_path or _cog_path(dataset_version, year)
    if not cog.exists():
        raise FileNotFoundError(f"COG not found for year {year}: {cog}")

    with rasterio.open(cog) as src:
        raster_epsg = src.crs.to_epsg()

        # Reproject municipality geometry to the raster's CRS
        geom_raster = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=raster_epsg)

        # Windowed read with spatial mask — all_touched=False is mandatory
        masked_data, _ = rasterio_mask(
            src,
            [geom_raster.__geo_interface__],
            crop=True,
            all_touched=False,
            nodata=src.nodata if src.nodata is not None else 0,
            filled=True,
        )

        nodata_fill = int(src.nodata) if src.nodata is not None else 0
        pixel_area_m2 = compute_pixel_area_m2(src.transform, src.crs)
        crs_label = f"EPSG:{raster_epsg}"

    band = masked_data[0]  # single-band land-cover raster
    total_pixels = int(band.size)

    # Raster fill-value pixels (outside municipality boundary after masking)
    fill_mask = band == nodata_fill
    cloud_or_nodata_count = int(fill_mask.sum())
    cloud_or_nodata_pct = 100.0 * cloud_or_nodata_count / total_pixels if total_pixels > 0 else 0.0

    # Pixels inside the boundary
    valid_band = band[~fill_mask]
    codes, counts = np.unique(valid_band, return_counts=True)
    histogram: dict[int, int] = {int(c): int(n) for c, n in zip(codes, counts)}

    # Semantic NoData (class code 0 within valid area) — separate from raster fill
    semantic_nodata = histogram.pop(0, 0)

    # Unexpected class codes
    data_quality_flags: list[str] = []
    unexpected = set(histogram.keys()) - VALID_CLASS_CODES
    for code in sorted(unexpected):
        data_quality_flags.append(f"unexpected class code {code}")
        histogram.pop(code, None)

    if cloud_or_nodata_pct >= 20.0:
        data_quality_flags.append(f"high nodata {cloud_or_nodata_pct:.1f}%")
    elif cloud_or_nodata_pct >= 10.0:
        data_quality_flags.append(f"elevated nodata {cloud_or_nodata_pct:.1f}%")

    classified_total = sum(histogram.values())
    unclassified_pct = (
        100.0 * semantic_nodata / (classified_total + semantic_nodata)
        if (classified_total + semantic_nodata) > 0
        else 0.0
    )

    # Build class list — share_pct is relative to classified pixels only (sums to 100%)
    class_entries: list[LandCoverClass] = []
    for code in sorted(histogram):
        count = histogram[code]
        area_km2 = pixels_to_km2(count, pixel_area_m2)
        share_pct = 100.0 * count / classified_total if classified_total > 0 else 0.0
        class_entries.append(
            LandCoverClass(
                code=code,
                name=CLASS_NAMES.get(code, f"Class{code}"),
                pixels=count,
                area_km2=round(area_km2, 4),
                share_pct=round(share_pct, 4),
            )
        )

    # Normalise share_pct so it sums to exactly 100.0 (eliminates floating-point drift)
    if class_entries:
        total_share = sum(c.share_pct for c in class_entries)
        if abs(total_share - 100.0) > 1e-6:
            diff = 100.0 - total_share
            dominant = max(class_entries, key=lambda c: c.pixels)
            class_entries = [
                LandCoverClass(
                    **{**c.model_dump(), "share_pct": round(c.share_pct + (diff if c.code == dominant.code else 0), 4)}
                )
                for c in class_entries
            ]

    return LandCoverStatistics(
        year=year,
        municipality_id=municipality_id,
        boundary_version=boundary_version,
        dataset_version=dataset_version,
        crs_used=crs_label,
        pixel_area_m2=pixel_area_m2,
        total_pixels=classified_total,
        classes=class_entries,
        unclassified_pct=round(unclassified_pct, 4),
        cloud_or_nodata_pct=round(cloud_or_nodata_pct, 4),
        edge_pixel_fraction=0.0,
        data_quality_flags=data_quality_flags,
    )


class RasterAnalysisAgent:
    """Computes LandCoverStatistics for all requested years in one municipality."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def analyse_municipality(self, job_id: str, envelope: dict) -> list[LandCoverStatistics]:
        """Run per-year analysis and write a partial result to jobs.result.

        Raises ValueError if the municipality is not found.
        Missing COGs are logged as warnings and skipped (not hard failures).
        """
        municipality_id = envelope["municipality_id"]
        years = sorted(envelope["years"])
        dataset_version = envelope["dataset_version"]

        geom_4326 = _fetch_geom_wgs84(self._db, municipality_id)

        statistics: list[LandCoverStatistics] = []
        for year in years:
            try:
                stats = analyse_year(
                    geom_4326=geom_4326,
                    year=year,
                    dataset_version=dataset_version,
                    municipality_id=municipality_id,
                    boundary_version=envelope["boundary_version"],
                )
                statistics.append(stats)
                logger.info("Raster analysis year %d OK for %s", year, municipality_id)
            except FileNotFoundError as exc:
                logger.warning("Skipping year %d: %s", year, exc)

        # Persist partial result so subsequent agents can read it without re-reading COGs
        self._db.execute(
            text(
                """
                UPDATE jobs
                SET result = COALESCE(result, '{}'::jsonb) || :patch::jsonb,
                    status = 'running',
                    started_at = COALESCE(started_at, NOW())
                WHERE id = :job_id
                """
            ),
            {
                "patch": json.dumps({"statistics": [s.model_dump(mode="json") for s in statistics]}),
                "job_id": job_id,
            },
        )
        self._db.commit()

        logger.info(
            "Raster analysis complete: %d/%d years for %s",
            len(statistics),
            len(years),
            municipality_id,
        )
        return statistics
