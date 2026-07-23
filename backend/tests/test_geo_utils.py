"""Tests for geospatial utility guardrails."""

import pytest


class TestComputePixelAreaM2:
    def test_projected_crs_succeeds(self):
        from unittest.mock import MagicMock

        from rasterio.transform import from_origin

        from backend.contracts.geo_utils import compute_pixel_area_m2

        transform = from_origin(west=83.0, north=28.0, xsize=30, ysize=30)
        crs = MagicMock()
        crs.is_projected = True
        area = compute_pixel_area_m2(transform, crs)
        assert area == pytest.approx(900.0, rel=1e-6)

    def test_geographic_crs_raises(self):
        from unittest.mock import MagicMock

        from rasterio.transform import from_origin

        from backend.contracts.geo_utils import compute_pixel_area_m2

        transform = from_origin(west=83.0, north=28.0, xsize=0.00027, ysize=0.00027)
        crs = MagicMock()
        crs.is_projected = False
        with pytest.raises(AssertionError, match="geographic"):
            compute_pixel_area_m2(transform, crs)


class TestClassHistogram:
    def test_basic_counts(self):
        import numpy as np

        from backend.contracts.geo_utils import class_histogram

        data = np.array([[1, 1, 2], [2, 3, 1]])
        hist = class_histogram(data)
        assert hist == {1: 3, 2: 2, 3: 1}

    def test_unexpected_code_raises(self):
        import numpy as np

        from backend.contracts.geo_utils import class_histogram

        data = np.array([[1, 99]])
        with pytest.raises(ValueError, match="Unexpected class codes"):
            class_histogram(data, valid_codes=frozenset(range(9)))
