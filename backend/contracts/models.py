"""Canonical data contracts for NGLIP.

Every agent communicates through these Pydantic models. Nothing else crosses agent boundaries.
Corresponds to §5 of plan.md.
"""

from __future__ import annotations

from enum import IntEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Class codebook (fixed, versioned)
# ---------------------------------------------------------------------------

class LandCoverCode(IntEnum):
    NO_DATA = 0
    WATER_BODY = 1
    SNOW_ICE_GLACIER = 2
    BARREN_LAND = 3
    FOREST = 4
    GRASSLAND = 5
    SHRUBLAND = 6
    CULTIVATED_LAND = 7
    SETTLEMENT = 8
    OPEN_WOODLAND = 9
    ROCKY_BARE = 10
    OTHERS = 11


# ICIMOD Nepal 11-class Land Cover system (codes 1–11; 0 = nodata fill)
# Source: ICIMOD Land Cover of Nepal 2000–2020 (SERVIR-HKH).
# Verified against national pixel-count distributions from the original VAT
# files: code 2 = 3.1% nationally (matches Nepal glacier extent ~3.4%),
# code 7 = 23.4% (matches Nepal cultivated land ~21%), etc.
CLASS_NAMES: dict[int, str] = {
    0:  "NoData",
    1:  "Water Body",
    2:  "Snow/Ice/Glacier",
    3:  "Barren Land",
    4:  "Forest",
    5:  "Grassland",
    6:  "Shrubland",
    7:  "Cultivated Land",
    8:  "Settlement",
    9:  "Open Woodland",
    10: "Rocky/Bare Ground",
    11: "Others",
}

CLASS_COLOURS: dict[int, str] = {
    0:  "#cccccc",
    1:  "#4a90d9",   # Water Body     — blue
    2:  "#e8f4f8",   # Snow/Glacier   — light blue-white
    3:  "#c4b28a",   # Barren Land    — tan
    4:  "#1a7a4a",   # Forest         — dark green
    5:  "#90d44b",   # Grassland      — light green
    6:  "#a8c97f",   # Shrubland      — olive green
    7:  "#f5d44e",   # Cultivated     — yellow
    8:  "#d63b2f",   # Settlement     — red
    9:  "#5da06f",   # Open Woodland  — medium green
    10: "#8b7355",   # Rocky/Bare     — brown
    11: "#b0b0b0",   # Others         — grey
}


# ---------------------------------------------------------------------------
# §5.1 — Job envelope
# ---------------------------------------------------------------------------

JobStatus = Literal["queued", "running", "complete", "failed", "partial"]
OutputType = Literal["stats", "change", "maps", "report"]


class JobEnvelope(BaseModel):
    job_id: UUID | None = None  # server-generated if not provided by client
    municipality_id: str
    years: list[int]
    requested_outputs: list[OutputType]
    dataset_version: str
    boundary_version: str
    status: JobStatus = "queued"
    provenance_id: UUID | None = None

    @field_validator("years")
    @classmethod
    def years_must_be_valid(cls, v: list[int]) -> list[int]:
        for y in v:
            if not (2000 <= y <= 2030):
                raise ValueError(f"Year {y} out of expected range 2000–2030")
        return sorted(v)


# ---------------------------------------------------------------------------
# §5.2 — Land-cover statistics
# ---------------------------------------------------------------------------

class LandCoverClass(BaseModel):
    code: int
    name: str
    pixels: int
    area_km2: float
    share_pct: float


class LandCoverStatistics(BaseModel):
    year: int
    municipality_id: str
    boundary_version: str
    dataset_version: str
    crs_used: str
    pixel_area_m2: float
    total_pixels: int
    classes: list[LandCoverClass]
    unclassified_pct: float
    cloud_or_nodata_pct: float
    edge_pixel_fraction: float
    provenance_id: UUID | None = None
    data_quality_flags: list[str] = []

    @field_validator("classes")
    @classmethod
    def shares_must_sum_to_100(cls, v: list[LandCoverClass]) -> list[LandCoverClass]:
        total = sum(c.share_pct for c in v)
        if abs(total - 100.0) > 1.0:
            raise ValueError(f"Class share percentages sum to {total:.3f}% — expected ~100%")
        return v


# ---------------------------------------------------------------------------
# §5.3 — Change transition matrix
# ---------------------------------------------------------------------------

class Transition(BaseModel):
    from_code: int
    from_class: str
    to_code: int
    to_class: str
    pixels: int
    area_km2: float
    pct_of_source: float
    priority_flag: bool = False


class NetChange(BaseModel):
    code: int
    class_name: str
    delta_km2: float
    delta_pct: float


class TrendPoint(BaseModel):
    year: int
    classes: list[LandCoverClass]


class CAGREntry(BaseModel):
    code: int
    class_name: str
    cagr_pct: float


class Breakpoint(BaseModel):
    code: int
    class_name: str
    year: int
    confidence: Literal["high", "moderate", "low"]


class ChangeMatrix(BaseModel):
    municipality_id: str
    from_year: int
    to_year: int
    crs_used: str
    transitions: list[Transition]
    net_change: list[NetChange]
    trend_series: list[TrendPoint] = []
    cagr: list[CAGREntry] = []
    breakpoints: list[Breakpoint] = []
    confidence_note: str = "single-date annual composite; sub-pixel change not detectable"
    provenance_id: UUID | None = None


# ---------------------------------------------------------------------------
# Evidence statement
# ---------------------------------------------------------------------------

EvidenceStrength = Literal["strong", "moderate", "weak", "insufficient data"]


class EvidenceStatement(BaseModel):
    transition_from: str
    transition_to: str
    claim: str
    metric: str | None = None
    baseline: str | None = None
    effect_size: float | None = None
    ci_95_low: float | None = None
    ci_95_high: float | None = None
    strength: EvidenceStrength
    sources: list[str] = []
    reason: str | None = None  # populated when strength == "insufficient data"
    provenance_id: UUID | None = None


# ---------------------------------------------------------------------------
# Validation verdict
# ---------------------------------------------------------------------------

CheckStatus = Literal["pass", "warn", "block"]


class CheckResult(BaseModel):
    id: str
    status: CheckStatus
    detail: str
    annotation: str | None = None


class ValidationVerdict(BaseModel):
    job_id: UUID
    verdict: Literal["pass", "warn", "block"]
    checks: list[CheckResult]
    blocked_artefacts: list[str] = []
    warnings: list[str] = []
