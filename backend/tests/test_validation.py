"""Tests for the Validation Agent gate functions.

All gate functions are pure (no DB access) and tested in isolation.
"""

from __future__ import annotations

import pytest

from backend.agents.validation.agent import (
    _check_crs,
    _check_matrix_rowsum,
    _check_nodata,
    _check_plausibility,
    _check_share_sum,
)
from backend.contracts.models import (
    ChangeMatrix,
    LandCoverClass,
    LandCoverStatistics,
    NetChange,
    Transition,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cls(code: int, area_km2: float, share_pct: float) -> LandCoverClass:
    return LandCoverClass(
        code=code, name=f"Class{code}",
        pixels=int(area_km2 * 1000), area_km2=area_km2, share_pct=share_pct
    )


def _stats(
    year: int,
    classes: list[LandCoverClass],
    crs: str = "EPSG:32645",
    nodata_pct: float = 0.0,
) -> LandCoverStatistics:
    return LandCoverStatistics(
        year=year, municipality_id="test", boundary_version="b1",
        dataset_version="v1", crs_used=crs, pixel_area_m2=900.0,
        total_pixels=sum(c.pixels for c in classes),
        classes=classes, unclassified_pct=0.0,
        cloud_or_nodata_pct=nodata_pct, edge_pixel_fraction=0.0,
    )


# ---------------------------------------------------------------------------
# share_sum gate
# ---------------------------------------------------------------------------

class TestCheckShareSum:
    def test_exact_100_passes(self):
        stats = _stats(2000, [_cls(1, 100.0, 50.0), _cls(2, 100.0, 50.0)])
        assert _check_share_sum([stats]) == []

    def test_99_9_passes_within_tolerance(self):
        stats = _stats(2000, [_cls(1, 100.0, 49.9), _cls(2, 100.0, 50.0)])
        assert _check_share_sum([stats]) == []

    def test_95_pct_blocked(self):
        # model_construct bypasses Pydantic validators — needed to simulate corrupted DB data
        stats = LandCoverStatistics.model_construct(
            year=2000, municipality_id="test", boundary_version="b1",
            dataset_version="v1", crs_used="EPSG:32645", pixel_area_m2=900.0,
            total_pixels=200, classes=[_cls(1, 100.0, 45.0), _cls(2, 100.0, 50.0)],
            unclassified_pct=0.0, cloud_or_nodata_pct=0.0, edge_pixel_fraction=0.0,
            data_quality_flags=[],
        )
        results = _check_share_sum([stats])
        assert len(results) == 1
        assert results[0].status == "block"

    def test_multiple_years_each_checked(self):
        good = _stats(2000, [_cls(1, 100.0, 50.0), _cls(2, 100.0, 50.0)])
        bad = LandCoverStatistics.model_construct(
            year=2005, municipality_id="test", boundary_version="b1",
            dataset_version="v1", crs_used="EPSG:32645", pixel_area_m2=900.0,
            total_pixels=200, classes=[_cls(1, 100.0, 40.0), _cls(2, 100.0, 40.0)],
            unclassified_pct=0.0, cloud_or_nodata_pct=0.0, edge_pixel_fraction=0.0,
            data_quality_flags=[],
        )
        results = _check_share_sum([good, bad])
        assert len(results) == 1
        assert "2005" in results[0].id


# ---------------------------------------------------------------------------
# nodata gate
# ---------------------------------------------------------------------------

class TestCheckNodata:
    def test_zero_nodata_passes(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], nodata_pct=0.0)
        assert _check_nodata([stats]) == []

    def test_9pct_nodata_passes(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], nodata_pct=9.0)
        assert _check_nodata([stats]) == []

    def test_11pct_nodata_warns(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], nodata_pct=11.0)
        results = _check_nodata([stats])
        assert len(results) == 1
        assert results[0].status == "warn"

    def test_25pct_nodata_blocks(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], nodata_pct=25.0)
        results = _check_nodata([stats])
        assert len(results) == 1
        assert results[0].status == "block"


# ---------------------------------------------------------------------------
# CRS assertion gate
# ---------------------------------------------------------------------------

class TestCheckCrs:
    def test_epsg_32645_passes(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], crs="EPSG:32645")
        assert _check_crs([stats]) == []

    def test_epsg_4326_geographic_blocked(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], crs="EPSG:4326")
        results = _check_crs([stats])
        assert len(results) == 1
        assert results[0].status == "block"
        assert "4326" in results[0].detail

    def test_wrong_utm_zone_blocked(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)], crs="EPSG:32644")
        results = _check_crs([stats])
        assert results[0].status == "block"


# ---------------------------------------------------------------------------
# Matrix row-sum gate
# ---------------------------------------------------------------------------

class TestCheckMatrixRowSum:
    def _matrix(self, from_year: int, to_year: int, transitions) -> ChangeMatrix:
        return ChangeMatrix(
            municipality_id="test",
            from_year=from_year,
            to_year=to_year,
            crs_used="EPSG:32645",
            transitions=transitions,
            net_change=[],
        )

    def test_no_matrix_passes(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)])
        assert _check_matrix_rowsum([stats], []) == []

    def test_exact_row_sum_passes(self):
        stats = _stats(2000, [_cls(1, 100.0, 100.0)])
        t = Transition(
            from_code=1, from_class="Forest", to_code=1, to_class="Forest",
            pixels=100, area_km2=100.0, pct_of_source=100.0
        )
        matrix = self._matrix(2000, 2022, [t])
        results = _check_matrix_rowsum([stats], [matrix])
        assert all(r.status != "block" for r in results)

    def test_large_discrepancy_warns(self):
        # Source area = 100 km², row sum = 60 km² → 40% discrepancy → warn
        stats = _stats(2000, [_cls(1, 100.0, 100.0)])
        t = Transition(
            from_code=1, from_class="Forest", to_code=1, to_class="Forest",
            pixels=60, area_km2=60.0, pct_of_source=100.0
        )
        matrix = self._matrix(2000, 2022, [t])
        results = _check_matrix_rowsum([stats], [matrix])
        assert any(r.status == "warn" for r in results)


# ---------------------------------------------------------------------------
# Plausibility gate
# ---------------------------------------------------------------------------

class TestCheckPlausibility:
    def test_stable_series_passes(self):
        s1 = _stats(2000, [_cls(1, 100.0, 100.0)])
        s2 = _stats(2001, [_cls(1, 102.0, 100.0)])  # 2% change
        assert _check_plausibility([s1, s2]) == []

    def test_moderate_change_warns(self):
        s1 = _stats(2000, [_cls(1, 100.0, 100.0)])
        s2 = _stats(2001, [_cls(1, 65.0, 100.0)])  # 35% drop → warn
        results = _check_plausibility([s1, s2])
        assert any(r.status == "warn" for r in results)

    def test_catastrophic_change_blocks(self):
        s1 = _stats(2000, [_cls(1, 100.0, 100.0)])
        s2 = _stats(2001, [_cls(1, 40.0, 100.0)])  # 60% drop → block
        results = _check_plausibility([s1, s2])
        assert any(r.status == "block" for r in results)

    def test_single_year_always_passes(self):
        s = _stats(2000, [_cls(1, 100.0, 100.0)])
        assert _check_plausibility([s]) == []

    def test_detects_per_class_independently(self):
        # Forest stable, Agriculture drops 60%
        s1 = _stats(2000, [_cls(1, 100.0, 50.0), _cls(2, 100.0, 50.0)])
        s2 = _stats(2001, [_cls(1, 101.0, 51.0), _cls(2, 40.0, 49.0)])
        results = _check_plausibility([s1, s2])

        blocked_ids = [r.id for r in results if r.status == "block"]
        assert any(":2" in rid for rid in blocked_ids)  # code 2 blocked
        # Forest should not appear as block
        assert all(":1" not in rid for rid in blocked_ids)
