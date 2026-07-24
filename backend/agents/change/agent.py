"""Change Detection Agent — transition matrix, net change, trend series, CAGR, breakpoints.

Data flow:
- Reads per-year LandCoverStatistics from jobs.result (written by RasterAnalysisAgent).
- Re-reads exactly two COGs (from_year and to_year) for the pixel-level transition matrix.
- Writes ChangeMatrix result back to jobs.result for the Validation Agent.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.agents.raster.agent import _cog_path, _fetch_geom_wgs84
from backend.config import get_settings
from backend.contracts.geo_utils import (
    NEPAL_EQUAL_AREA_EPSG,
    pixels_to_km2,
    reproject_geometry,
)
from backend.contracts.models import (
    CAGREntry,
    Breakpoint,
    ChangeMatrix,
    CLASS_NAMES,
    LandCoverStatistics,
    NetChange,
    Transition,
    TrendPoint,
)

logger = logging.getLogger(__name__)
settings = get_settings()

VERSION = "change_detection:v0.1.0"


def _read_masked_band(
    cog_path: Path,
    geom_raster_crs,
    raster_epsg: int,
    geom_4326,
) -> tuple[np.ndarray, float]:
    """Return (band_array, pixel_area_m2) for a COG masked to a municipality.

    Returns the raw filled array (nodata pixels kept) so the caller can align
    two year arrays at the same pixel positions for a pixel-level comparison.
    """
    import rasterio
    from rasterio.mask import mask as rasterio_mask
    from backend.contracts.geo_utils import compute_pixel_area_m2

    with rasterio.open(cog_path) as src:
        actual_epsg = src.crs.to_epsg()
        if actual_epsg != raster_epsg:
            geom_mask = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=actual_epsg)
        else:
            geom_mask = geom_raster_crs

        masked_data, _ = rasterio_mask(
            src,
            [geom_mask.__geo_interface__],
            crop=True,
            all_touched=False,
            nodata=src.nodata if src.nodata is not None else 0,
            filled=True,
        )
        nodata_fill = int(src.nodata) if src.nodata is not None else 0
        pixel_area_m2 = compute_pixel_area_m2(src.transform, src.crs)

    band = masked_data[0].astype(np.int16)
    # Mask out fill-value (outside boundary) AND semantic NoData (class 0) for transitions
    band[masked_data[0] == nodata_fill] = 0

    return band, pixel_area_m2


def _build_transition_matrix(
    arr_from: np.ndarray,
    arr_to: np.ndarray,
    pixel_area_m2: float,
) -> list[Transition]:
    """Pixel-level transition count between two aligned, masked arrays.

    Only pixels where BOTH years have classified data (codes 1-8) are counted.
    This ensures row sums reflect mutually-observed land, not single-year nodata.
    """
    valid = (arr_from > 0) & (arr_to > 0)
    from_vals = arr_from[valid].ravel().astype(np.int32)
    to_vals = arr_to[valid].ravel().astype(np.int32)

    transitions: list[Transition] = []
    for fc in np.unique(from_vals):
        fc_mask = from_vals == fc
        source_total = int(fc_mask.sum())
        to_codes, to_counts = np.unique(to_vals[fc_mask], return_counts=True)
        for tc, count in zip(to_codes, to_counts):
            count = int(count)
            area_km2 = round(pixels_to_km2(count, pixel_area_m2), 4)
            pct = round(100.0 * count / source_total, 4)
            transitions.append(
                Transition(
                    from_code=int(fc),
                    from_class=CLASS_NAMES.get(int(fc), f"Class{fc}"),
                    to_code=int(tc),
                    to_class=CLASS_NAMES.get(int(tc), f"Class{tc}"),
                    pixels=count,
                    area_km2=area_km2,
                    pct_of_source=pct,
                    # Flag non-trivial cross-class transitions
                    priority_flag=(fc != tc and pct > 1.0),
                )
            )
    return transitions


def _net_change(
    stats_from: LandCoverStatistics,
    stats_to: LandCoverStatistics,
) -> list[NetChange]:
    from_by_code = {c.code: c.area_km2 for c in stats_from.classes}
    to_by_code = {c.code: c.area_km2 for c in stats_to.classes}
    all_codes = sorted(set(from_by_code) | set(to_by_code))

    result: list[NetChange] = []
    for code in all_codes:
        from_area = from_by_code.get(code, 0.0)
        to_area = to_by_code.get(code, 0.0)
        delta = round(to_area - from_area, 4)
        delta_pct = round(100.0 * delta / from_area, 2) if from_area > 0 else 0.0
        result.append(
            NetChange(
                code=code,
                class_name=CLASS_NAMES.get(code, f"Class{code}"),
                delta_km2=delta,
                delta_pct=delta_pct,
            )
        )
    return result


def _cagr(
    stats_from: LandCoverStatistics,
    stats_to: LandCoverStatistics,
) -> list[CAGREntry]:
    n_years = stats_to.year - stats_from.year
    if n_years <= 0:
        return []

    from_by_code = {c.code: c.area_km2 for c in stats_from.classes}
    to_by_code = {c.code: c.area_km2 for c in stats_to.classes}
    all_codes = sorted(set(from_by_code) | set(to_by_code))

    result: list[CAGREntry] = []
    for code in all_codes:
        fa = from_by_code.get(code, 0.0)
        ta = to_by_code.get(code, 0.0)
        if fa > 0 and ta > 0:
            rate = (ta / fa) ** (1.0 / n_years) - 1.0
        else:
            rate = 0.0
        result.append(
            CAGREntry(
                code=code,
                class_name=CLASS_NAMES.get(code, f"Class{code}"),
                cagr_pct=round(100.0 * rate, 3),
            )
        )
    return result


def _detect_breakpoints(trend_series: list[TrendPoint]) -> list[Breakpoint]:
    """Find class-area discontinuities using a variance-split approach.

    For each class, find the split year that maximises between-group variance.
    A breakpoint is flagged when variance reduction exceeds 30%.
    Confidence = high (>60%), moderate (40-60%), low (30-40%).
    """
    if len(trend_series) < 5:
        return []

    years = [p.year for p in trend_series]
    all_codes: set[int] = set()
    for p in trend_series:
        all_codes.update(c.code for c in p.classes)

    breakpoints: list[Breakpoint] = []
    for code in sorted(all_codes):
        if code == 0:
            continue
        series = np.array(
            [
                next((c.area_km2 for c in p.classes if c.code == code), 0.0)
                for p in trend_series
            ]
        )
        total_var = float(np.var(series))
        if total_var < 1e-6:
            continue

        best_split, best_ratio = None, 0.0
        for i in range(2, len(series) - 2):
            left, right = series[:i], series[i:]
            within_var = (
                float(np.var(left)) * len(left) + float(np.var(right)) * len(right)
            ) / len(series)
            ratio = 1.0 - within_var / total_var
            if ratio > best_ratio:
                best_ratio = ratio
                best_split = i

        if best_split is not None and best_ratio > 0.30:
            conf: str
            if best_ratio > 0.60:
                conf = "high"
            elif best_ratio > 0.40:
                conf = "moderate"
            else:
                conf = "low"
            breakpoints.append(
                Breakpoint(
                    code=code,
                    class_name=CLASS_NAMES.get(code, f"Class{code}"),
                    year=years[best_split],
                    confidence=conf,
                )
            )

    return breakpoints


class ChangeDetectionAgent:
    """Builds the full ChangeMatrix from per-year statistics and raw COG data."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def detect(self, job_id: str, envelope: dict) -> ChangeMatrix:
        """Compute transition matrix, net change, trend series, CAGR, and breakpoints.

        Reads per-year statistics from jobs.result (previously stored by RasterAnalysisAgent).
        Re-reads exactly two COGs for the pixel-level transition matrix.
        Writes ChangeMatrix back to jobs.result.
        """
        municipality_id = envelope["municipality_id"]
        dataset_version = envelope["dataset_version"]
        years = sorted(envelope["years"])
        from_year, to_year = years[0], years[-1]

        # Load statistics stored by RasterAnalysisAgent
        row = self._db.execute(
            text("SELECT result FROM jobs WHERE id = :id"),
            {"id": job_id},
        ).first()
        if row is None or not row.result:
            raise RuntimeError(f"No raster analysis result found for job {job_id}")

        raw_stats: list[dict] = row.result.get("statistics", [])
        if not raw_stats:
            raise RuntimeError(f"Empty statistics in job {job_id} — raster analysis may have failed")

        statistics = [LandCoverStatistics(**s) for s in raw_stats]
        stats_by_year = {s.year: s for s in statistics}

        if from_year not in stats_by_year or to_year not in stats_by_year:
            raise ValueError(
                f"Missing statistics for from_year={from_year} or to_year={to_year}"
            )

        stats_from = stats_by_year[from_year]
        stats_to = stats_by_year[to_year]

        # Re-read the two boundary COGs for the pixel-level transition matrix
        geom_4326 = _fetch_geom_wgs84(self._db, municipality_id)
        geom_utm = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=NEPAL_EQUAL_AREA_EPSG)

        arr_from, pixel_area_m2 = _read_masked_band(
            _cog_path(dataset_version, from_year),
            geom_utm,
            NEPAL_EQUAL_AREA_EPSG,
            geom_4326,
        )
        arr_to, _ = _read_masked_band(
            _cog_path(dataset_version, to_year),
            geom_utm,
            NEPAL_EQUAL_AREA_EPSG,
            geom_4326,
        )

        if arr_from.shape != arr_to.shape:
            raise RuntimeError(
                f"Array shape mismatch between {from_year} {arr_from.shape} "
                f"and {to_year} {arr_to.shape} — grid alignment violated"
            )

        transitions = _build_transition_matrix(arr_from, arr_to, pixel_area_m2)

        # Trend series: wrap per-year stats in TrendPoint objects
        trend_series = [
            TrendPoint(year=s.year, classes=s.classes)
            for s in sorted(statistics, key=lambda s: s.year)
        ]

        matrix = ChangeMatrix(
            municipality_id=municipality_id,
            from_year=from_year,
            to_year=to_year,
            crs_used=stats_from.crs_used,
            transitions=transitions,
            net_change=_net_change(stats_from, stats_to),
            trend_series=trend_series,
            cagr=_cagr(stats_from, stats_to),
            breakpoints=_detect_breakpoints(trend_series),
        )

        # Merge into jobs.result
        self._db.execute(
            text(
                """
                UPDATE jobs
                SET result = COALESCE(result, '{}'::jsonb) || CAST(:patch AS jsonb)
                WHERE id = :job_id
                """
            ),
            {
                "patch": json.dumps({"change_matrix": [matrix.model_dump(mode="json")]}),
                "job_id": job_id,
            },
        )
        self._db.commit()

        logger.info(
            "Change detection complete for job %s: %d transitions, %d breakpoints",
            job_id,
            len(transitions),
            len(matrix.breakpoints),
        )
        return matrix
