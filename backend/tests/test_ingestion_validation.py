"""Tests for Ingestion Agent validation utilities.

These tests use synthetic rasters built with rasterio's MemoryFile so they
run without any actual Nepal land-cover data.
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import numpy as np
import pytest

from backend.agents.ingestion.validation import (
    IngestReport,
    check_class_codes,
    compute_class_histogram,
    read_metadata,
    validate_grid_alignment,
)


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

def _make_tif(
    path: Path,
    width: int = 100,
    height: int = 100,
    epsg: int = 32645,
    res: float = 30.0,
    origin_x: float = 500000.0,
    origin_y: float = 3100000.0,
    data: np.ndarray | None = None,
    nodata: float = 0.0,
) -> Path:
    """Write a minimal single-band GeoTIFF to path."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_origin

    transform = from_origin(origin_x, origin_y, res, res)
    if data is None:
        data = np.random.choice([1, 2, 3, 6], size=(1, height, width)).astype(np.uint8)

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
        dst.write(data)
    return path


# ------------------------------------------------------------------
# read_metadata
# ------------------------------------------------------------------

class TestReadMetadata:
    def test_reads_crs_epsg(self, tmp_path):
        p = _make_tif(tmp_path / "2015.tif", epsg=32645)
        meta = read_metadata(p, year=2015)
        assert meta.crs_epsg == 32645

    def test_reads_resolution(self, tmp_path):
        p = _make_tif(tmp_path / "2015.tif", res=30.0)
        meta = read_metadata(p, year=2015)
        assert abs(meta.res_x - 30.0) < 1e-6
        assert abs(meta.res_y - 30.0) < 1e-6

    def test_reads_year(self, tmp_path):
        p = _make_tif(tmp_path / "2015.tif")
        meta = read_metadata(p, year=2015)
        assert meta.year == 2015

    def test_checksum_is_sha256_hex(self, tmp_path):
        p = _make_tif(tmp_path / "2015.tif")
        meta = read_metadata(p, year=2015)
        assert len(meta.checksum) == 64
        assert all(c in "0123456789abcdef" for c in meta.checksum)

    def test_two_identical_files_same_checksum(self, tmp_path):
        data = np.ones((1, 10, 10), dtype=np.uint8)
        p1 = _make_tif(tmp_path / "a.tif", data=data)
        p2 = _make_tif(tmp_path / "b.tif", data=data)
        assert read_metadata(p1, 2000).checksum == read_metadata(p2, 2001).checksum


# ------------------------------------------------------------------
# validate_grid_alignment
# ------------------------------------------------------------------

class TestValidateGridAlignment:
    def test_identical_rasters_pass(self, tmp_path):
        paths = [_make_tif(tmp_path / f"{y}.tif") for y in range(2000, 2005)]
        metas = [read_metadata(p, 2000 + i) for i, p in enumerate(paths)]
        assert validate_grid_alignment(metas) == []

    def test_crs_mismatch_returns_error(self, tmp_path):
        ref = _make_tif(tmp_path / "2000.tif", epsg=32645)
        bad = _make_tif(tmp_path / "2001.tif", epsg=32644)
        metas = [read_metadata(ref, 2000), read_metadata(bad, 2001)]
        errors = validate_grid_alignment(metas)
        assert any("CRS mismatch" in e for e in errors)

    def test_resolution_mismatch_returns_error(self, tmp_path):
        ref = _make_tif(tmp_path / "2000.tif", res=30.0)
        bad = _make_tif(tmp_path / "2001.tif", res=60.0)
        metas = [read_metadata(ref, 2000), read_metadata(bad, 2001)]
        errors = validate_grid_alignment(metas)
        assert any("resolution" in e for e in errors)

    def test_origin_mismatch_returns_error(self, tmp_path):
        ref = _make_tif(tmp_path / "2000.tif", origin_x=500000.0)
        bad = _make_tif(tmp_path / "2001.tif", origin_x=600000.0)
        metas = [read_metadata(ref, 2000), read_metadata(bad, 2001)]
        errors = validate_grid_alignment(metas)
        assert any("origin" in e for e in errors)

    def test_single_raster_always_passes(self, tmp_path):
        p = _make_tif(tmp_path / "2000.tif")
        metas = [read_metadata(p, 2000)]
        assert validate_grid_alignment(metas) == []


# ------------------------------------------------------------------
# compute_class_histogram
# ------------------------------------------------------------------

class TestComputeClassHistogram:
    def test_counts_match_pixel_distribution(self, tmp_path):
        # 5×5 grid: 10 pixels of class 1, 5 pixels of class 2, 10 of class 3
        data = np.array([
            [1, 1, 1, 1, 1],
            [2, 2, 2, 2, 2],
            [1, 1, 1, 1, 1],
            [3, 3, 3, 3, 3],
            [3, 3, 3, 3, 3],
        ], dtype=np.uint8).reshape(1, 5, 5)
        p = _make_tif(tmp_path / "test.tif", width=5, height=5, data=data, nodata=255)
        hist = compute_class_histogram(p)
        assert hist[1] == 10
        assert hist[2] == 5
        assert hist[3] == 10

    def test_nodata_excluded(self, tmp_path):
        data = np.array([[1, 0, 1, 0, 1]], dtype=np.uint8).reshape(1, 1, 5)
        p = _make_tif(tmp_path / "test.tif", width=5, height=1, data=data, nodata=0)
        hist = compute_class_histogram(p)
        assert 0 not in hist
        assert hist[1] == 3

    def test_total_pixels_sum(self, tmp_path):
        data = np.full((1, 50, 50), fill_value=1, dtype=np.uint8)
        p = _make_tif(tmp_path / "test.tif", width=50, height=50, data=data, nodata=255)
        hist = compute_class_histogram(p)
        assert sum(hist.values()) == 2500


# ------------------------------------------------------------------
# check_class_codes
# ------------------------------------------------------------------

class TestCheckClassCodes:
    def test_valid_codebook_passes(self):
        hist = {1: 100, 2: 50, 6: 30}
        assert check_class_codes(hist) == []

    def test_nodata_code_zero_passes(self):
        hist = {0: 10, 1: 100}
        assert check_class_codes(hist) == []

    def test_unexpected_code_returns_error(self):
        hist = {1: 100, 99: 5}
        errors = check_class_codes(hist)
        assert len(errors) == 1
        assert "99" in errors[0]

    def test_multiple_unexpected_codes(self):
        hist = {1: 100, 10: 5, 20: 3}
        errors = check_class_codes(hist)
        assert len(errors) == 1
        assert "10" in errors[0] and "20" in errors[0]
