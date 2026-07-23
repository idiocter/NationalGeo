"""Shared geospatial utilities for NGLIP.

All area computations must pass through compute_pixel_area_m2.
All raster-to-area conversions must assert CRS is projected first.
These are the guardrails that prevent silent projection bugs.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np
    import rasterio
    from rasterio.transform import Affine
    from rasterio.crs import CRS
    from shapely.geometry.base import BaseGeometry


# Nepal equal-area projection used for all area math
NEPAL_EQUAL_AREA_EPSG = 32645  # WGS 84 / UTM Zone 45N


def compute_pixel_area_m2(transform: "Affine", crs: "CRS") -> float:
    """Return pixel area in m² from an equal-area projected raster transform.

    Raises AssertionError if the CRS is geographic (lat/lon).
    This is the #1 silent bug in land-cover projects — enforced here.
    """
    assert crs.is_projected, (
        f"CRS {crs.to_epsg()} is geographic — area in degrees is meaningless. "
        f"Reproject to EPSG:{NEPAL_EQUAL_AREA_EPSG} before computing area."
    )
    return abs(transform.a * transform.e)


def pixels_to_km2(pixel_count: int, pixel_area_m2: float) -> float:
    """Convert pixel count to km² using the pixel area in m²."""
    return (pixel_count * pixel_area_m2) / 1_000_000.0


def validate_raster_grid_alignment(raster_paths: list[Path]) -> None:
    """Assert all rasters share identical CRS, resolution, and grid origin.

    Raises ValueError on first mismatch — does not silently skip.
    Called by the Ingestion Agent before accepting a new dataset version.
    """
    import rasterio

    if len(raster_paths) < 2:
        return

    with rasterio.open(raster_paths[0]) as ref:
        ref_crs = ref.crs.to_wkt()
        ref_transform = ref.transform
        ref_shape = (ref.height, ref.width)

    for path in raster_paths[1:]:
        with rasterio.open(path) as src:
            if src.crs.to_wkt() != ref_crs:
                raise ValueError(
                    f"CRS mismatch: {path.name} has {src.crs.to_epsg()}, "
                    f"reference has {raster_paths[0].name}"
                )
            if abs(src.transform.a - ref_transform.a) > 1e-6:
                raise ValueError(
                    f"Resolution mismatch: {path.name} x-res={src.transform.a:.6f}, "
                    f"reference={ref_transform.a:.6f}"
                )
            if abs(src.transform.c - ref_transform.c) > 1e-2:
                raise ValueError(
                    f"Grid origin mismatch: {path.name} x-origin={src.transform.c:.2f}, "
                    f"reference={ref_transform.c:.2f}"
                )


def reproject_geometry(geom: "BaseGeometry", from_epsg: int, to_epsg: int) -> "BaseGeometry":
    """Reproject a shapely geometry between two EPSG CRS codes."""
    import pyproj
    from shapely.ops import transform

    transformer = pyproj.Transformer.from_crs(
        from_epsg, to_epsg, always_xy=True
    )
    return transform(transformer.transform, geom)


def class_histogram(data: "np.ndarray", valid_codes: frozenset[int] | None = None) -> dict[int, int]:
    """Return pixel counts per class code from a masked array.

    Args:
        data: 2D numpy array of class codes (masked where nodata).
        valid_codes: if provided, raise on any code not in this set.
    """
    import numpy as np

    flat = data.compressed() if hasattr(data, "compressed") else data.ravel()
    codes, counts = np.unique(flat, return_counts=True)

    if valid_codes is not None:
        unexpected = set(int(c) for c in codes) - valid_codes
        if unexpected:
            raise ValueError(f"Unexpected class codes in raster: {unexpected}")

    return {int(c): int(n) for c, n in zip(codes, counts)}
