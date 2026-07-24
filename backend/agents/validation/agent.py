"""Validation Agent — block and warn gates for Phase 2.

Block gates raise a hard stop: the job result must not be shown to users.
Warn gates flag data quality issues but do not suppress the result.

Phase 2 block gates:
1. share_sum       — class share_pct must sum to ~100% (±1%) per year
2. nodata_block    — cloud_or_nodata_pct ≥ 20% makes the year unusable
3. crs_assertion   — all statistics must use a projected CRS (EPSG:32645)
4. matrix_rowsum   — transition matrix rows vs source-year area (±5%)
5. plausibility    — year-over-year area change < 50% per class

Phase 2 warn gates:
- nodata_warn      — cloud_or_nodata_pct ≥ 10%
- plausibility_warn — year-over-year change 30–50%
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.contracts.models import (
    ChangeMatrix,
    CheckResult,
    LandCoverStatistics,
    ValidationVerdict,
)

logger = logging.getLogger(__name__)

VERSION = "validation:v0.1.0"

# Tolerance thresholds
SHARE_SUM_TOL = 1.0        # ±1% tolerance on share_pct sum
NODATA_WARN_PCT = 10.0     # warn above 10% nodata
NODATA_BLOCK_PCT = 20.0    # block above 20% nodata
MATRIX_ROW_TOL = 0.05      # 5% tolerance for transition row sums vs source totals
PLAUSIBILITY_WARN = 0.30   # warn if class area changes > 30% year-over-year
PLAUSIBILITY_BLOCK = 0.50  # block if class area changes > 50% year-over-year


class ValidationAgent:
    """Runs all QA gates against per-year statistics and a ChangeMatrix."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def validate(self, job_id: str, envelope: dict) -> ValidationVerdict:
        """Run all gates. Read stats and matrix from jobs.result.

        Writes the validation verdict to the validation_verdicts table and
        stores a summary under jobs.result['validation'].
        """
        row = self._db.execute(
            text("SELECT result FROM jobs WHERE id = :id"),
            {"id": job_id},
        ).first()

        if row is None or not row.result:
            return self._block_verdict(
                job_id,
                CheckResult(
                    id="prerequisite",
                    status="block",
                    detail="No analysis result found — raster analysis may have failed",
                ),
            )

        raw_stats: list[dict] = row.result.get("statistics", [])
        raw_matrices: list[dict] = row.result.get("change_matrix", [])

        statistics = [LandCoverStatistics(**s) for s in raw_stats]
        matrices = [ChangeMatrix(**m) for m in raw_matrices]

        checks: list[CheckResult] = []

        checks.extend(_check_share_sum(statistics))
        checks.extend(_check_nodata(statistics))
        checks.extend(_check_crs(statistics))
        checks.extend(_check_matrix_rowsum(statistics, matrices))
        checks.extend(_check_plausibility(statistics))

        # Fill in "pass" records for any gate that raised no issues
        gate_ids = {c.id.split(":")[0] for c in checks}
        for gate in (
            "share_sum", "nodata", "crs_assertion", "matrix_rowsum", "plausibility"
        ):
            if gate not in gate_ids:
                checks.append(CheckResult(id=gate, status="pass", detail="OK"))

        blocked = [c for c in checks if c.status == "block"]
        warned = [c for c in checks if c.status == "warn"]

        if blocked:
            verdict = "block"
        elif warned:
            verdict = "warn"
        else:
            verdict = "pass"

        result = ValidationVerdict(
            job_id=UUID(job_id),
            verdict=verdict,
            checks=checks,
            blocked_artefacts=["statistics", "change_matrix"] if blocked else [],
            warnings=[c.detail for c in warned],
        )

        # Persist to validation_verdicts table
        self._db.execute(
            text(
                """
                INSERT INTO validation_verdicts
                    (job_id, verdict, checks, blocked_artefacts, warnings)
                VALUES
                    (:job_id, :verdict, :checks::jsonb, :blocked::text[], :warnings::text[])
                """
            ),
            {
                "job_id": job_id,
                "verdict": verdict,
                "checks": json.dumps([c.model_dump() for c in checks]),
                "blocked": [c for c in (["statistics", "change_matrix"] if blocked else [])],
                "warnings": [c.detail for c in warned],
            },
        )

        # Merge verdict summary into jobs.result
        self._db.execute(
            text(
                """
                UPDATE jobs
                SET result = COALESCE(result, '{}'::jsonb) || :patch::jsonb
                WHERE id = :job_id
                """
            ),
            {
                "patch": json.dumps({
                    "validation": {
                        "verdict": verdict,
                        "checks": [c.model_dump() for c in checks],
                    }
                }),
                "job_id": job_id,
            },
        )
        self._db.commit()

        logger.info(
            "Validation %s for job %s (%d blocks, %d warns)",
            verdict.upper(),
            job_id,
            len(blocked),
            len(warned),
        )
        return result

    def _block_verdict(self, job_id: str, check: CheckResult) -> ValidationVerdict:
        return ValidationVerdict(
            job_id=UUID(job_id),
            verdict="block",
            checks=[check],
            blocked_artefacts=["statistics", "change_matrix"],
        )


# ---------------------------------------------------------------------------
# Individual gate functions (pure — no DB access, testable in isolation)
# ---------------------------------------------------------------------------

def _check_share_sum(statistics: list[LandCoverStatistics]) -> list[CheckResult]:
    results: list[CheckResult] = []
    for s in statistics:
        total = sum(c.share_pct for c in s.classes)
        if abs(total - 100.0) > SHARE_SUM_TOL:
            results.append(
                CheckResult(
                    id=f"share_sum:{s.year}",
                    status="block",
                    detail=(
                        f"Year {s.year}: class share percentages sum to {total:.3f}% "
                        f"(expected 100% ± {SHARE_SUM_TOL}%)"
                    ),
                )
            )
    return results


def _check_nodata(statistics: list[LandCoverStatistics]) -> list[CheckResult]:
    results: list[CheckResult] = []
    for s in statistics:
        pct = s.cloud_or_nodata_pct
        if pct >= NODATA_BLOCK_PCT:
            results.append(
                CheckResult(
                    id=f"nodata:{s.year}",
                    status="block",
                    detail=f"Year {s.year}: nodata {pct:.1f}% ≥ {NODATA_BLOCK_PCT}% — year is unusable",
                )
            )
        elif pct >= NODATA_WARN_PCT:
            results.append(
                CheckResult(
                    id=f"nodata:{s.year}",
                    status="warn",
                    detail=f"Year {s.year}: elevated nodata {pct:.1f}% (threshold {NODATA_WARN_PCT}%)",
                )
            )
    return results


def _check_crs(statistics: list[LandCoverStatistics]) -> list[CheckResult]:
    results: list[CheckResult] = []
    for s in statistics:
        if s.crs_used != "EPSG:32645":
            results.append(
                CheckResult(
                    id=f"crs_assertion:{s.year}",
                    status="block",
                    detail=(
                        f"Year {s.year}: CRS is {s.crs_used}, expected EPSG:32645 (UTM Zone 45N). "
                        "Area values are invalid."
                    ),
                )
            )
    return results


def _check_matrix_rowsum(
    statistics: list[LandCoverStatistics],
    matrices: list[ChangeMatrix],
) -> list[CheckResult]:
    if not matrices:
        return []

    stats_by_year = {s.year: s for s in statistics}
    results: list[CheckResult] = []

    for matrix in matrices:
        from_stats = stats_by_year.get(matrix.from_year)
        if from_stats is None:
            continue

        from_area_by_code = {c.code: c.area_km2 for c in from_stats.classes}

        from_codes = {t.from_code for t in matrix.transitions}
        for code in from_codes:
            row_sum = sum(
                t.area_km2 for t in matrix.transitions if t.from_code == code
            )
            source_area = from_area_by_code.get(code, 0.0)
            if source_area <= 0:
                continue
            discrepancy = abs(row_sum - source_area) / source_area
            if discrepancy > MATRIX_ROW_TOL:
                results.append(
                    CheckResult(
                        id=f"matrix_rowsum:{matrix.from_year}:{code}",
                        status="warn",
                        detail=(
                            f"Transition row for class {code} sums to {row_sum:.2f} km² "
                            f"but source-year area is {source_area:.2f} km² "
                            f"(discrepancy {discrepancy*100:.1f}% > {MATRIX_ROW_TOL*100:.0f}%)"
                        ),
                        annotation=(
                            "Expected: pixels classified in both years may be fewer than "
                            "single-year totals if nodata areas shifted between years."
                        ),
                    )
                )
    return results


def _check_plausibility(statistics: list[LandCoverStatistics]) -> list[CheckResult]:
    if len(statistics) < 2:
        return []

    sorted_stats = sorted(statistics, key=lambda s: s.year)
    results: list[CheckResult] = []

    for i in range(1, len(sorted_stats)):
        prev = sorted_stats[i - 1]
        curr = sorted_stats[i]
        prev_by_code = {c.code: c.area_km2 for c in prev.classes}

        for cls in curr.classes:
            prev_area = prev_by_code.get(cls.code, 0.0)
            if prev_area <= 0:
                continue
            change_frac = abs(cls.area_km2 - prev_area) / prev_area
            years_str = f"{prev.year}→{curr.year}"
            if change_frac >= PLAUSIBILITY_BLOCK:
                results.append(
                    CheckResult(
                        id=f"plausibility:{curr.year}:{cls.code}",
                        status="block",
                        detail=(
                            f"Class {cls.code} ({cls.name}) changed by "
                            f"{change_frac*100:.0f}% between {years_str} "
                            f"({prev_area:.1f}→{cls.area_km2:.1f} km²) — "
                            "exceeds 50% plausibility threshold"
                        ),
                    )
                )
            elif change_frac >= PLAUSIBILITY_WARN:
                results.append(
                    CheckResult(
                        id=f"plausibility:{curr.year}:{cls.code}",
                        status="warn",
                        detail=(
                            f"Class {cls.code} ({cls.name}) changed by "
                            f"{change_frac*100:.0f}% between {years_str} "
                            f"({prev_area:.1f}→{cls.area_km2:.1f} km²)"
                        ),
                    )
                )
    return results
