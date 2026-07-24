"""Shared pytest configuration and fixtures for the NGLIP backend test suite."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: marks tests as slow (skip with -m 'not slow')")


@pytest.fixture
def raster_factory(tmp_path):
    """Return a factory function that writes a minimal GeoTIFF to tmp_path."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_origin

    def _make(
        name: str = "test.tif",
        width: int = 64,
        height: int = 64,
        epsg: int = 32645,
        res: float = 30.0,
        origin_x: float = 500000.0,
        origin_y: float = 3100000.0,
        data: np.ndarray | None = None,
        nodata: float = 0.0,
    ) -> Path:
        path = tmp_path / name
        transform = from_origin(origin_x, origin_y, res, res)
        arr = (
            data
            if data is not None
            else np.random.choice([1, 2, 3, 6], size=(1, height, width)).astype(np.uint8)
        )
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=width,
            height=height,
            count=1,
            dtype="uint8",
            crs=CRS.from_epsg(epsg),
            transform=transform,
            nodata=nodata,
        ) as dst:
            dst.write(arr)
        return path

    return _make
