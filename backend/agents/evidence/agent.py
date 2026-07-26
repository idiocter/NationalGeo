"""Evidence Agent — transition-based spatial evidence with effect sizes.

Computes evidence statements for the top-N land-cover transitions found in
the change matrix.  Spatial proximity analysis (roads, DEM, rivers, population)
requires supporting datasets; those statements are returned as "insufficient data"
until 'make ingest-supporting' has been run.

Language guardrails (plan.md §Phase 3):
  Forbidden words: caused, because, due to
  Required for associations: associated with, concentrated near, co-occurs with
"""

from __future__ import annotations

import json
import logging
import math

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.contracts.models import CLASS_NAMES, EvidenceStatement

logger = logging.getLogger(__name__)

VERSION = "evidence:v0.1.0"

# Transitions considered high-priority by land-management standards
_PRIORITY_PAIRS: frozenset[tuple[int, int]] = frozenset([
    (4, 8),  # Forest → Settlement
    (4, 7),  # Forest → Cultivated
    (4, 3),  # Forest → Barren
    (5, 7),  # Grassland → Cultivated
    (5, 8),  # Grassland → Settlement
    (7, 8),  # Cultivated → Settlement
    (6, 7),  # Shrubland → Cultivated
    (9, 7),  # Open Woodland → Cultivated
    (3, 7),  # Barren → Cultivated (reclamation)
])

# Evidence strength thresholds
_STRONG_PCT  = 10.0;  _STRONG_KM2  = 50.0
_MODERATE_PCT = 3.0;  _MODERATE_KM2 = 10.0
_WEAK_PCT     = 0.5;  _WEAK_KM2    =  1.0

_SUPPORTING_DATASETS = [
    ("road network",       "roads-dor"),
    ("elevation/slope",    "dem-srtm-30m"),
    ("river network",      "rivers-dof"),
    ("population density", "population-wbg-2020"),
]


def _strength(pct: float, area: float) -> str:
    if pct >= _STRONG_PCT  or area >= _STRONG_KM2:   return "strong"
    if pct >= _MODERATE_PCT or area >= _MODERATE_KM2: return "moderate"
    if pct >= _WEAK_PCT    or area >= _WEAK_KM2:     return "weak"
    return "insufficient data"


def _wilson_ci(p_pct: float, n: int) -> tuple[float, float]:
    """Wilson score 95% CI for a binomial proportion (n = pixel count)."""
    if n < 1 or p_pct <= 0:
        return (0.0, 0.0)
    z, p = 1.96, p_pct / 100.0
    denom  = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (round(max(0.0, centre - margin) * 100, 2),
            round(min(100.0, centre + margin) * 100, 2))


def _neutral_claim(from_name: str, to_name: str, pct: float, area: float,
                   y0: int, y1: int) -> str:
    return (
        f"{from_name} loss associated with {to_name} gain: "
        f"{pct:.1f}% of {from_name} area ({area:.1f} km²) "
        f"co-occurs with {to_name} increase between {y0} and {y1}."
    )


class EvidenceAgent:
    TOP_N = 8

    def __init__(self, db: Session) -> None:
        self.db = db

    def _supporting_available(self) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for _, ds_key in _SUPPORTING_DATASETS:
            row = self.db.execute(
                text("SELECT 1 FROM datasets WHERE version = :v LIMIT 1"),
                {"v": ds_key},
            ).first()
            out[ds_key] = row is not None
        return out

    def analyse(self, job_id: str, envelope: dict) -> list[EvidenceStatement]:
        row = self.db.execute(
            text("SELECT result FROM jobs WHERE id = :id"),
            {"id": job_id},
        ).first()
        if not row or not row.result:
            logger.warning("No result found for job %s — skipping evidence", job_id)
            return []

        result      = row.result
        matrices    = result.get("change_matrix", [])
        stats_list  = result.get("statistics", [])
        dataset_ver = envelope.get("dataset_version", "landcover-v3.1")

        if not matrices:
            return []

        matrix     = matrices[0]
        from_year  = matrix["from_year"]
        to_year    = matrix["to_year"]
        transitions = matrix.get("transitions", [])

        # Build {year: {code: pixels}} for CI computation
        from_pixels: dict[int, int] = {
            cls["code"]: cls["pixels"]
            for stat in stats_list if stat["year"] == from_year
            for cls in stat["classes"]
        }

        supporting = self._supporting_available()
        evidence: list[EvidenceStatement] = []

        top = sorted(
            [t for t in transitions if t["from_code"] != t["to_code"]],
            key=lambda t: t["area_km2"],
            reverse=True,
        )[: self.TOP_N]

        for t in top:
            fc, tc = t["from_code"], t["to_code"]
            fn = CLASS_NAMES.get(fc, t["from_class"])
            tn = CLASS_NAMES.get(tc, t["to_class"])
            pct, area = t["pct_of_source"], t["area_km2"]
            n_px       = from_pixels.get(fc, 1)
            lo, hi     = _wilson_ci(pct, n_px)

            evidence.append(EvidenceStatement(
                transition_from=fn,
                transition_to=tn,
                claim=_neutral_claim(fn, tn, pct, area, from_year, to_year),
                metric=f"{pct:.1f}% of {fn} area ({area:.1f} km²) converted",
                baseline=f"{fn} pixel count in {from_year}: {n_px:,}",
                effect_size=round(pct, 3),
                ci_95_low=lo,
                ci_95_high=hi,
                strength=_strength(pct, area),
                sources=[dataset_ver],
            ))

        # Spatial evidence entries — insufficient data until supporting datasets loaded
        for label, ds_key in _SUPPORTING_DATASETS:
            if not supporting.get(ds_key, False):
                evidence.append(EvidenceStatement(
                    transition_from="[all transitions]",
                    transition_to="[spatial]",
                    claim=f"Spatial association with {label}",
                    strength="insufficient data",
                    sources=[],
                    reason=(
                        f"'{ds_key}' dataset not loaded. "
                        f"Run 'make ingest-supporting' to enable {label} proximity analysis."
                    ),
                ))

        # Persist evidence into jobs.result
        self.db.execute(
            text(
                "UPDATE jobs "
                "SET result = COALESCE(result, '{}'::jsonb) || CAST(:patch AS jsonb) "
                "WHERE id = :id"
            ),
            {
                "patch": json.dumps({"evidence": [e.model_dump(mode="json") for e in evidence]}),
                "id": job_id,
            },
        )
        self.db.commit()
        return evidence
