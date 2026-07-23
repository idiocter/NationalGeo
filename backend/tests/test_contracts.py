"""Tests for canonical data contracts — the guardrails that keep agents honest."""

import pytest
from pydantic import ValidationError

from backend.contracts.models import (
    ChangeMatrix,
    JobEnvelope,
    LandCoverClass,
    LandCoverStatistics,
    Transition,
)


class TestJobEnvelope:
    def test_years_sorted(self):
        env = JobEnvelope(
            job_id="00000000-0000-0000-0000-000000000001",
            municipality_id="np-bag-ktm-01",
            years=[2022, 2000, 2015],
            requested_outputs=["stats", "change"],
            dataset_version="landcover-v3.1",
            boundary_version="mof-2021",
        )
        assert env.years == [2000, 2015, 2022]

    def test_invalid_year_rejected(self):
        with pytest.raises(ValidationError, match="out of expected range"):
            JobEnvelope(
                job_id="00000000-0000-0000-0000-000000000001",
                municipality_id="np-bag-ktm-01",
                years=[1990],
                requested_outputs=["stats"],
                dataset_version="landcover-v3.1",
                boundary_version="mof-2021",
            )


class TestLandCoverStatistics:
    def _make_classes(self, shares: list[float]) -> list[LandCoverClass]:
        return [
            LandCoverClass(
                code=i + 1,
                name=f"Class{i + 1}",
                pixels=int(shares[i] * 1000),
                area_km2=shares[i] * 100,
                share_pct=shares[i],
            )
            for i in range(len(shares))
        ]

    def test_valid_statistics(self):
        stats = LandCoverStatistics(
            year=2015,
            municipality_id="np-bag-ktm-01",
            boundary_version="mof-2021",
            dataset_version="landcover-v3.1",
            crs_used="EPSG:32645",
            pixel_area_m2=900.0,
            total_pixels=100000,
            classes=self._make_classes([44.2, 30.1, 10.0, 15.7]),
            unclassified_pct=0.0,
            cloud_or_nodata_pct=0.0,
            edge_pixel_fraction=0.04,
        )
        assert stats.year == 2015

    def test_wildly_wrong_shares_rejected(self):
        with pytest.raises(ValidationError):
            LandCoverStatistics(
                year=2015,
                municipality_id="np-bag-ktm-01",
                boundary_version="mof-2021",
                dataset_version="landcover-v3.1",
                crs_used="EPSG:32645",
                pixel_area_m2=900.0,
                total_pixels=100000,
                classes=self._make_classes([10.0, 10.0]),  # sums to 20%, rejected
                unclassified_pct=0.0,
                cloud_or_nodata_pct=0.0,
                edge_pixel_fraction=0.0,
            )
