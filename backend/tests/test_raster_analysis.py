"""Tests for the Raster Analysis Agent.

All tests use synthetic rasters built with rasterio — no real Nepal data required.
The conftest.py raster_factory fixture writes minimal GeoTIFFs to tmp_path.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from backend.agents.raster.agent import analyse_year, _cog_path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tif(
    path: Path,
    data: np.ndarray,
    epsg: int = 32645,
    res: float = 30.0,
    origin_x: float = 500000.0,
    origin_y: float = 3100000.0,
    nodata: float = 0.0,
) -> Path:
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_origin

    h, w = data.shape[-2], data.shape[-1]
    if data.ndim == 2:
        data = data[np.newaxis]

    with rasterio.open(
        path, "w",
        driver="GTiff", width=w, height=h, count=1,
        dtype=data.dtype, crs=CRS.from_epsg(epsg),
        transform=from_origin(origin_x, origin_y, res, res),
        nodata=nodata,
    ) as dst:
        dst.write(data)
    return path


def _geom_covering(origin_x, origin_y, res, w, h, epsg_utm=32645):
    """Return a shapely polygon (in EPSG:4326) that covers a raster extent."""
    import pyproj
    from shapely.geometry import box
    from shapely.ops import transform

    # Build bbox in the UTM space, add 10% margin
    x0 = origin_x - res
    y1 = origin_y + res
    x1 = origin_x + (w + 1) * res
    y0 = origin_y - (h + 1) * res

    transformer = pyproj.Transformer.from_crs(epsg_utm, 4326, always_xy=True)
    lon_min, lat_min = transformer.transform(x0, y0)
    lon_max, lat_max = transformer.transform(x1, y1)
    return box(lon_min, lat_min, lon_max, lat_max)


# ---------------------------------------------------------------------------
# analyse_year — pixel counting
# ---------------------------------------------------------------------------

class TestAnalyseYearPixelCounting:
    def test_counts_classified_pixels(self, tmp_path):
        data = np.array([[1, 1, 2], [2, 3, 1]], dtype=np.uint8)  # 3×Forest, 2×Agri, 1×Water
        cog = _make_tif(tmp_path / "2010.tif", data, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 3, 2)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        codes = {c.code: c.pixels for c in stats.classes}
        assert codes[1] == 3   # Forest
        assert codes[2] == 2   # Agriculture
        assert codes[3] == 1   # Water

    def test_excludes_nodata_fill(self, tmp_path):
        # Nodata fill = 0; class code 0 pixels should count as nodata
        data = np.array([[1, 0, 1], [0, 0, 1]], dtype=np.uint8)
        cog = _make_tif(tmp_path / "2010.tif", data, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 3, 2)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        assert stats.total_pixels == 3  # only Forest pixels
        codes = {c.code: c.pixels for c in stats.classes}
        assert codes[1] == 3

    def test_share_pct_sums_to_100(self, tmp_path):
        data = np.random.choice([1, 2, 3, 4], size=(4, 5)).astype(np.uint8)
        cog = _make_tif(tmp_path / "2010.tif", data, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 5, 4)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        total_share = sum(c.share_pct for c in stats.classes)
        assert abs(total_share - 100.0) < 0.01

    def test_nodata_pct_reported(self, tmp_path):
        # 2×2 raster: 2 nodata, 2 classified
        data = np.array([[0, 0], [1, 2]], dtype=np.uint8)
        cog = _make_tif(tmp_path / "2010.tif", data, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 2, 2)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        assert stats.cloud_or_nodata_pct == pytest.approx(50.0, abs=1.0)


class TestAnalyseYearArea:
    def test_area_equals_pixel_count_times_pixel_area(self, tmp_path):
        data = np.full((10, 10), fill_value=1, dtype=np.uint8)  # all Forest
        cog = _make_tif(tmp_path / "2010.tif", data, res=30.0, nodata=255)
        geom = _geom_covering(500000, 3100000, 30.0, 10, 10)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        forest = next(c for c in stats.classes if c.code == 1)
        expected_km2 = forest.pixels * 900.0 / 1_000_000  # 30m × 30m = 900 m²
        assert forest.area_km2 == pytest.approx(expected_km2, rel=1e-4)

    def test_crs_label(self, tmp_path):
        data = np.ones((5, 5), dtype=np.uint8)
        cog = _make_tif(tmp_path / "2010.tif", data, epsg=32645, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 5, 5)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        assert stats.crs_used == "EPSG:32645"

    def test_raises_for_missing_cog(self, tmp_path):
        from shapely.geometry import box
        geom = box(84.0, 27.0, 85.0, 28.0)  # valid WGS84 bbox
        missing = tmp_path / "missing.tif"  # does not exist

        with pytest.raises(FileNotFoundError):
            analyse_year(geom, year=2099, dataset_version="nonexistent",
                         municipality_id="test", boundary_version="b1", cog_path=missing)


class TestAnalyseYearQualityFlags:
    def test_no_flags_for_clean_raster(self, tmp_path):
        data = np.full((5, 5), fill_value=1, dtype=np.uint8)
        cog = _make_tif(tmp_path / "2010.tif", data, nodata=255)
        geom = _geom_covering(500000, 3100000, 30.0, 5, 5)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        assert stats.data_quality_flags == []

    def test_high_nodata_flag(self, tmp_path):
        # 3 valid + 7 nodata in a 10-pixel raster
        data = np.array([[0]*7 + [1, 2, 3]], dtype=np.uint8).reshape(1, 10)
        cog = _make_tif(tmp_path / "2010.tif", data, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 10, 1)

        stats = analyse_year(geom, year=2010, dataset_version="v1",
                             municipality_id="test", boundary_version="b1", cog_path=cog)

        assert any("nodata" in f for f in stats.data_quality_flags)


# ---------------------------------------------------------------------------
# Golden-file test — reference synthetic municipality
# ---------------------------------------------------------------------------

class TestGoldenSyntheticMunicipality:
    """Regression against a known synthetic reference.

    A 20×20 raster with a known class distribution.
    Replace synthetic data with QGIS-extracted reference when real rasters are
    available.
    """

    def test_forest_area_matches_reference(self, tmp_path):
        # 20×20 = 400 pixels at 30m resolution
        # Forest (code 1): 160 pixels → 160×900 m² = 144 000 m² = 0.144 km²
        data = np.ones((20, 20), dtype=np.uint8)
        data[10:, :] = 2  # lower half = Agriculture
        assert (data == 1).sum() == 200
        assert (data == 2).sum() == 200

        cog = _make_tif(tmp_path / "2015.tif", data, nodata=0)
        geom = _geom_covering(500000, 3100000, 30.0, 20, 20)

        stats = analyse_year(geom, year=2015, dataset_version="v1",
                             municipality_id="test-golden", boundary_version="b1", cog_path=cog)

        forest = next(c for c in stats.classes if c.code == 1)
        agri = next(c for c in stats.classes if c.code == 2)

        assert forest.pixels == 200
        assert agri.pixels == 200
        assert forest.share_pct == pytest.approx(50.0, abs=0.1)
        assert agri.share_pct == pytest.approx(50.0, abs=0.1)
        assert forest.area_km2 == pytest.approx(0.18, abs=0.01)  # 200 × 900 m² / 1e6
