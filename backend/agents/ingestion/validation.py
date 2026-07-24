"""Raster validation utilities for the Ingestion Agent.

All functions are pure (no DB, no side effects) so they are easy to test
and can be called from both Celery tasks and CLI scripts.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

VALID_CLASS_CODES: frozenset[int] = frozenset(range(9))  # 0–8 per codebook


@dataclass
class RasterMetadata:
    path: Path
    year: int
    crs_epsg: int | None
    crs_wkt: str
    width: int
    height: int
    res_x: float       # pixel width in CRS units
    res_y: float       # pixel height (absolute value)
    origin_x: float    # top-left x
    origin_y: float    # top-left y
    nodata: float | None
    dtype: str
    band_count: int
    checksum: str      # SHA-256 of the file


@dataclass
class IngestReport:
    """Accumulated result of validating a batch of rasters."""
    passed: list[RasterMetadata] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


def read_metadata(path: Path, year: int) -> RasterMetadata:
    """Read raster metadata without loading pixel data."""
    import rasterio

    checksum = _file_checksum(path)
    with rasterio.open(path) as src:
        return RasterMetadata(
            path=path,
            year=year,
            crs_epsg=src.crs.to_epsg() if src.crs else None,
            crs_wkt=src.crs.to_wkt() if src.crs else "",
            width=src.width,
            height=src.height,
            res_x=src.transform.a,
            res_y=abs(src.transform.e),
            origin_x=src.transform.c,
            origin_y=src.transform.f,
            nodata=src.nodata,
            dtype=str(src.dtypes[0]),
            band_count=src.count,
            checksum=checksum,
        )


def validate_grid_alignment(metadatas: list[RasterMetadata]) -> list[str]:
    """Check all rasters share identical CRS, resolution, and grid origin.

    Returns a list of error strings — empty means all rasters are aligned.
    This is the core Ingestion Agent contract: all 23 years must share the
    same grid so pixel-pair comparison in the Change Detection Agent is valid.
    """
    if len(metadatas) < 2:
        return []

    errors: list[str] = []
    ref = metadatas[0]

    for meta in metadatas[1:]:
        name = meta.path.name

        if meta.crs_wkt != ref.crs_wkt:
            errors.append(
                f"{name} (year {meta.year}): CRS mismatch — "
                f"got EPSG:{meta.crs_epsg}, reference is EPSG:{ref.crs_epsg}"
            )
        if abs(meta.res_x - ref.res_x) > 1e-6:
            errors.append(
                f"{name} (year {meta.year}): x-resolution mismatch "
                f"({meta.res_x:.8f} vs {ref.res_x:.8f})"
            )
        if abs(meta.res_y - ref.res_y) > 1e-6:
            errors.append(
                f"{name} (year {meta.year}): y-resolution mismatch "
                f"({meta.res_y:.8f} vs {ref.res_y:.8f})"
            )
        if abs(meta.origin_x - ref.origin_x) > 1e-2:
            errors.append(
                f"{name} (year {meta.year}): x-origin mismatch "
                f"({meta.origin_x:.4f} vs {ref.origin_x:.4f})"
            )
        if abs(meta.origin_y - ref.origin_y) > 1e-2:
            errors.append(
                f"{name} (year {meta.year}): y-origin mismatch "
                f"({meta.origin_y:.4f} vs {ref.origin_y:.4f})"
            )

    return errors


def compute_class_histogram(path: Path, band: int = 1) -> dict[int, int]:
    """Count pixels per class code, reading in tiles to avoid loading the full array.

    Returns a dict {class_code: pixel_count}. NoData pixels are excluded.
    """
    import numpy as np
    import rasterio

    counts: dict[int, int] = {}

    with rasterio.open(path) as src:
        nodata = src.nodata
        for _, window in src.block_windows(band):
            data = src.read(band, window=window)
            flat = data.ravel()
            if nodata is not None:
                flat = flat[flat != nodata]
            codes, pixel_counts = np.unique(flat, return_counts=True)
            for code, n in zip(codes, pixel_counts):
                key = int(code)
                counts[key] = counts.get(key, 0) + int(n)

    return counts


def check_class_codes(histogram: dict[int, int]) -> list[str]:
    """Return errors for any class code outside the codebook (codes 0–8)."""
    unexpected = set(histogram.keys()) - VALID_CLASS_CODES
    if unexpected:
        return [f"Unexpected class codes found: {sorted(unexpected)}"]
    return []


def _file_checksum(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
