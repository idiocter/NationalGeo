"""Tests for the Change Detection Agent.

Uses synthetic arrays and statistics — no real Nepal data required.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.agents.change.agent import (
    _build_transition_matrix,
    _cagr,
    _detect_breakpoints,
    _net_change,
)
from backend.contracts.models import (
    LandCoverClass,
    LandCoverStatistics,
    TrendPoint,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stats(year: int, class_areas: dict[int, float]) -> LandCoverStatistics:
    """Build a minimal LandCoverStatistics for testing."""
    total = sum(class_areas.values())
    classes = [
        LandCoverClass(
            code=code,
            name=f"Class{code}",
            pixels=int(area * 1000),
            area_km2=area,
            share_pct=round(100.0 * area / total, 4) if total > 0 else 0.0,
        )
        for code, area in sorted(class_areas.items())
    ]
    return LandCoverStatistics(
        year=year,
        municipality_id="test",
        boundary_version="b1",
        dataset_version="v1",
        crs_used="EPSG:32645",
        pixel_area_m2=900.0,
        total_pixels=int(total * 1000),
        classes=classes,
        unclassified_pct=0.0,
        cloud_or_nodata_pct=0.0,
        edge_pixel_fraction=0.0,
    )


# ---------------------------------------------------------------------------
# Transition matrix
# ---------------------------------------------------------------------------

class TestBuildTransitionMatrix:
    def _make_arrays(self, from_codes, to_codes):
        """Build flat arrays as if they came from a rasterio.mask call."""
        return (
            np.array(from_codes, dtype=np.int16).reshape(1, len(from_codes)),
            np.array(to_codes, dtype=np.int16).reshape(1, len(to_codes)),
        )

    def test_no_change_produces_diagonal_transitions(self):
        # 3 Forest, 2 Agriculture — unchanged between years
        f = np.array([[1, 1, 1, 2, 2]], dtype=np.int16)
        t = np.array([[1, 1, 1, 2, 2]], dtype=np.int16)
        transitions = _build_transition_matrix(f, t, pixel_area_m2=900.0)

        # Only same-class transitions
        for tr in transitions:
            assert tr.from_code == tr.to_code
            assert tr.priority_flag is False

    def test_forest_to_builtup_flagged(self):
        # All 5 Forest pixels → Built-up
        f = np.array([[1, 1, 1, 1, 1]], dtype=np.int16)
        t = np.array([[6, 6, 6, 6, 6]], dtype=np.int16)
        transitions = _build_transition_matrix(f, t, pixel_area_m2=900.0)

        assert len(transitions) == 1
        tr = transitions[0]
        assert tr.from_code == 1
        assert tr.to_code == 6
        assert tr.pixels == 5
        assert tr.pct_of_source == pytest.approx(100.0)
        assert tr.priority_flag is True  # 100% > 1% threshold

    def test_nodata_pixels_excluded(self):
        # Code 0 = nodata — should not appear in transitions
        f = np.array([[0, 1, 1, 2]], dtype=np.int16)
        t = np.array([[0, 1, 0, 2]], dtype=np.int16)
        transitions = _build_transition_matrix(f, t, pixel_area_m2=900.0)

        codes = {(tr.from_code, tr.to_code) for tr in transitions}
        assert (0, 0) not in codes
        assert (1, 0) not in codes
        assert (0, 1) not in codes

    def test_row_sums_equal_source_pixels_when_no_nodata(self):
        f = np.array([[1, 1, 2, 2, 3]], dtype=np.int16)
        t = np.array([[1, 2, 2, 3, 1]], dtype=np.int16)
        transitions = _build_transition_matrix(f, t, pixel_area_m2=900.0)

        # Row sum for code 1 (2 pixels from Forest)
        forest_row_pixels = sum(tr.pixels for tr in transitions if tr.from_code == 1)
        assert forest_row_pixels == 2

    def test_area_equals_pixel_count_times_pixel_area(self):
        f = np.array([[1, 1, 1]], dtype=np.int16)
        t = np.array([[1, 1, 1]], dtype=np.int16)
        transitions = _build_transition_matrix(f, t, pixel_area_m2=900.0)

        tr = transitions[0]
        expected_km2 = 3 * 900.0 / 1_000_000
        assert tr.area_km2 == pytest.approx(expected_km2, rel=1e-4)

    def test_mixed_transitions(self):
        # 4 pixels: Forest→Forest, Forest→Agri, Agri→Agri, Agri→Forest
        f = np.array([[1, 1, 2, 2]], dtype=np.int16)
        t = np.array([[1, 2, 2, 1]], dtype=np.int16)
        transitions = _build_transition_matrix(f, t, pixel_area_m2=900.0)

        trans_dict = {(tr.from_code, tr.to_code): tr.pixels for tr in transitions}
        assert trans_dict[(1, 1)] == 1
        assert trans_dict[(1, 2)] == 1
        assert trans_dict[(2, 2)] == 1
        assert trans_dict[(2, 1)] == 1


# ---------------------------------------------------------------------------
# Net change
# ---------------------------------------------------------------------------

class TestNetChange:
    def test_forest_loss(self):
        s_from = _stats(2000, {1: 100.0, 2: 50.0})
        s_to = _stats(2022, {1: 80.0, 2: 70.0})
        changes = _net_change(s_from, s_to)

        by_code = {c.code: c for c in changes}
        assert by_code[1].delta_km2 == pytest.approx(-20.0, rel=1e-4)
        assert by_code[1].delta_pct == pytest.approx(-20.0, rel=1e-4)
        assert by_code[2].delta_km2 == pytest.approx(20.0, rel=1e-4)

    def test_new_class_appearing(self):
        # Code 6 (Built-up) not in from_year
        s_from = _stats(2000, {1: 100.0})
        s_to = _stats(2022, {1: 90.0, 6: 10.0})
        changes = _net_change(s_from, s_to)

        by_code = {c.code: c for c in changes}
        assert 6 in by_code
        assert by_code[6].delta_km2 == pytest.approx(10.0)

    def test_class_disappearing(self):
        s_from = _stats(2000, {1: 100.0, 3: 5.0})
        s_to = _stats(2022, {1: 105.0})
        changes = _net_change(s_from, s_to)

        by_code = {c.code: c for c in changes}
        assert by_code[3].delta_km2 == pytest.approx(-5.0)


# ---------------------------------------------------------------------------
# CAGR
# ---------------------------------------------------------------------------

class TestCAGR:
    def test_stable_class_has_zero_cagr(self):
        s_from = _stats(2000, {1: 100.0})
        s_to = _stats(2022, {1: 100.0})
        entries = _cagr(s_from, s_to)
        assert entries[0].cagr_pct == pytest.approx(0.0, abs=0.01)

    def test_doubling_over_n_years(self):
        # 100 → 200 over 10 years → CAGR = 2^(1/10) - 1 ≈ 7.177%
        s_from = _stats(2000, {1: 100.0})
        s_to = _stats(2010, {1: 200.0})
        entries = _cagr(s_from, s_to)
        assert entries[0].cagr_pct == pytest.approx(7.177, abs=0.01)

    def test_no_result_for_zero_years(self):
        s = _stats(2000, {1: 100.0})
        entries = _cagr(s, s)  # same year
        assert entries == []


# ---------------------------------------------------------------------------
# Breakpoint detection
# ---------------------------------------------------------------------------

class TestBreakpointDetection:
    def _make_trend(self, years: list[int], areas_by_code: dict[int, list[float]]):
        points = []
        for i, yr in enumerate(years):
            classes = [
                LandCoverClass(
                    code=code,
                    name=f"Class{code}",
                    pixels=int(areas[i] * 1000),
                    area_km2=areas[i],
                    share_pct=50.0,
                )
                for code, areas in areas_by_code.items()
            ]
            points.append(TrendPoint(year=yr, classes=classes))
        return points

    def test_no_breakpoint_in_flat_series(self):
        # Flat series → no breakpoint
        years = list(range(2000, 2010))
        trend = self._make_trend(years, {1: [100.0] * 10})
        bps = _detect_breakpoints(trend)
        assert bps == []

    def test_detects_step_change(self):
        # Sharp step at year 2005: 100 → 50
        years = list(range(2000, 2010))
        areas = [100.0] * 5 + [50.0] * 5
        trend = self._make_trend(years, {1: areas})
        bps = _detect_breakpoints(trend)

        assert len(bps) == 1
        assert bps[0].code == 1
        assert bps[0].year == 2005  # split at index 5 → year 2005
        assert bps[0].confidence in ("high", "moderate")

    def test_requires_five_or_more_points(self):
        years = [2000, 2001, 2002]
        trend = self._make_trend(years, {1: [100.0, 50.0, 80.0]})
        bps = _detect_breakpoints(trend)
        assert bps == []

    def test_ignores_class_zero(self):
        years = list(range(2000, 2010))
        trend = self._make_trend(years, {0: [100.0] * 5 + [1.0] * 5})
        bps = _detect_breakpoints(trend)
        assert all(bp.code != 0 for bp in bps)
