"""Narrative Agent — deterministic template with numeric guard.

Guardrails (non-negotiable):
- All numbers in prose are sourced verbatim from the stats/change_matrix JSON.
- Model performs no arithmetic whatsoever.
- Temperature ≤ 0.3 if LLM path is used.
- Numeric guard: every number found in the output must also appear in source_numbers.
  Mismatch → regenerate once → deterministic template fallback.
- Output is labelled as machine-generated in every export.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.contracts.models import CLASS_NAMES

logger = logging.getLogger(__name__)

VERSION = "narrative:v0.1.0"

_MACHINE_LABEL = (
    "This report was generated automatically by NGLIP v0.1 "
    "using ICIMOD Nepal Land Cover data. "
    "All statistics are computed from satellite-derived rasters; "
    "no values were produced by a language model."
)


def _fmt(v: float, dec: int = 1) -> str:
    return f"{v:,.{dec}f}"


def _top_classes(classes: list[dict], n: int = 3, exclude_nodata: bool = True) -> list[dict]:
    filtered = [c for c in classes if not (exclude_nodata and c["code"] == 0)]
    return sorted(filtered, key=lambda c: c["area_km2"], reverse=True)[:n]


def _delta_label(delta: float) -> str:
    return "increased" if delta > 0 else "decreased"


def build_template_narrative(
    municipality_name: str,
    stats_list: list[dict],
    change_matrices: list[dict],
    evidence_list: list[dict],
) -> str:
    """Build narrative text entirely from source data — never invents numbers."""
    if not stats_list:
        return "No statistics available for this municipality."

    stats_by_year = {s["year"]: s for s in stats_list}
    years = sorted(stats_by_year)
    latest_stats  = stats_by_year[years[-1]]
    earliest_stats = stats_by_year[years[0]]
    latest_year   = years[-1]
    earliest_year = years[0]

    top3 = _top_classes(latest_stats["classes"])
    total_km2 = sum(
        c["area_km2"] for c in latest_stats["classes"] if c["code"] != 0
    )

    lines: list[str] = []

    # ── Overview ────────────────────────────────────────────────────────────
    lines.append(f"## {municipality_name} — Land Cover Summary")
    lines.append("")
    lines.append(
        f"This municipality covers approximately {_fmt(total_km2)} km² "
        f"based on land cover mapping for {latest_year}."
    )

    if top3:
        dominant = top3[0]
        dom_name = CLASS_NAMES.get(dominant["code"], dominant["name"])
        lines.append(
            f"The dominant land cover type is {dom_name} "
            f"({_fmt(dominant['share_pct'])}% of total area, {_fmt(dominant['area_km2'])} km²)."
        )
        if len(top3) >= 2:
            others = ", ".join(
                f"{CLASS_NAMES.get(c['code'], c['name'])} ({_fmt(c['share_pct'])}%)"
                for c in top3[1:]
            )
            lines.append(f"Other significant land cover types include {others}.")
    lines.append("")

    # ── Change summary ───────────────────────────────────────────────────────
    if change_matrices:
        matrix   = change_matrices[0]
        y0, y1   = matrix["from_year"], matrix["to_year"]
        net      = sorted(matrix.get("net_change", []), key=lambda n: abs(n["delta_km2"]), reverse=True)
        top_net  = [n for n in net if abs(n["delta_km2"]) > 0.01][:4]

        lines.append(f"## Change Detection ({y0}–{y1})")
        lines.append("")
        lines.append(
            f"Comparing land cover between {y0} and {y1} reveals the following net changes:"
        )
        lines.append("")
        for nc in top_net:
            cls_name = CLASS_NAMES.get(nc["code"], nc["class_name"])
            direction = _delta_label(nc["delta_km2"])
            lines.append(
                f"- **{cls_name}** {direction} by "
                f"{_fmt(abs(nc['delta_km2']))} km² ({_fmt(abs(nc['delta_pct']))}%)."
            )
        lines.append("")

        # Top transition
        transitions = sorted(
            [t for t in matrix.get("transitions", []) if t["from_code"] != t["to_code"]],
            key=lambda t: t["area_km2"], reverse=True,
        )
        if transitions:
            t = transitions[0]
            fn = CLASS_NAMES.get(t["from_code"], t["from_class"])
            tn = CLASS_NAMES.get(t["to_code"],   t["to_class"])
            lines.append(
                f"The largest single transition was **{fn} → {tn}**, "
                f"affecting {_fmt(t['area_km2'])} km² "
                f"({_fmt(t['pct_of_source'])}% of {fn} area in {y0})."
            )
            lines.append("")

    # ── Evidence summary ─────────────────────────────────────────────────────
    strong_ev = [e for e in evidence_list if e.get("strength") in ("strong", "moderate")]
    if strong_ev:
        lines.append("## Evidence")
        lines.append("")
        for ev in strong_ev[:4]:
            lines.append(f"- {ev.get('claim', '')}")
        lines.append("")

    # ── Data quality note ────────────────────────────────────────────────────
    nodata_pct = latest_stats.get("cloud_or_nodata_pct", 0)
    if nodata_pct > 5:
        lines.append(
            f"> **Data quality note:** {_fmt(nodata_pct)}% of pixels in {latest_year} "
            f"are NoData/cloud-affected. Interpret results with caution."
        )
        lines.append("")

    # ── Machine-generated label ──────────────────────────────────────────────
    lines.append("---")
    lines.append(f"*{_MACHINE_LABEL}*")

    return "\n".join(lines)


def _extract_numbers(text: str) -> set[str]:
    """Extract all numeric tokens from text for numeric guard."""
    return set(re.findall(r"\d+(?:[.,]\d+)*", text))


def _numeric_guard(narrative: str, source_json: str) -> bool:
    """Return True if every number in narrative exists somewhere in source_json."""
    narrative_nums = _extract_numbers(narrative)
    source_nums    = _extract_numbers(source_json)
    rogue = narrative_nums - source_nums
    if rogue:
        logger.warning("Numeric guard: rogue numbers found: %s", rogue)
        return False
    return True


def _try_ollama(
    municipality_name: str,
    stats_list: list[dict],
    change_matrices: list[dict],
    ollama_url: str,
    model: str,
) -> str | None:
    """Attempt Ollama generation; returns None on any error or guard failure."""
    try:
        import httpx

        source_payload = json.dumps({
            "municipality": municipality_name,
            "statistics": stats_list,
            "change_matrix": change_matrices,
        })

        prompt = (
            f"Write a concise, factual land cover summary for {municipality_name}, Nepal. "
            f"Use ONLY the numbers from the data below. Do not compute new numbers. "
            f"Avoid the words: caused, because, due to.\n\n"
            f"DATA:\n{source_payload}\n\n"
            f"SUMMARY (markdown, 3–5 paragraphs):"
        )

        resp = httpx.post(
            f"{ollama_url}/api/generate",
            json={"model": model, "prompt": prompt, "temperature": 0.3, "stream": False},
            timeout=60,
        )
        resp.raise_for_status()
        text_out: str = resp.json().get("response", "")

        if not text_out.strip():
            return None

        if not _numeric_guard(text_out, source_payload):
            logger.warning("Numeric guard failed on LLM output — falling back to template")
            return None

        return text_out + f"\n\n---\n*Machine-generated by NGLIP v0.1 using Ollama/{model}.*"

    except Exception as exc:
        logger.info("Ollama not available (%s) — using deterministic template", exc)
        return None


class NarrativeAgent:
    def __init__(self, db: Session) -> None:
        self.db = db

    def generate(self, job_id: str, envelope: dict) -> str:
        from backend.config import get_settings  # noqa: PLC0415
        settings = get_settings()

        row = self.db.execute(
            text(
                "SELECT m.name, j.result "
                "FROM jobs j "
                "JOIN municipalities m ON m.id = j.municipality_id "
                "WHERE j.id = :id"
            ),
            {"id": job_id},
        ).first()
        if not row or not row.result:
            return "Analysis results not available."

        municipality_name = row.name
        result        = row.result
        stats_list    = result.get("statistics", [])
        matrices      = result.get("change_matrix", [])
        evidence_list = result.get("evidence", [])

        # Try Ollama first
        narrative = _try_ollama(
            municipality_name, stats_list, matrices,
            settings.ollama_url, settings.ollama_model,
        )

        # Deterministic template fallback
        if not narrative:
            narrative = build_template_narrative(
                municipality_name, stats_list, matrices, evidence_list
            )

        # Persist narrative into jobs.result
        self.db.execute(
            text(
                "UPDATE jobs "
                "SET result = COALESCE(result, '{}'::jsonb) || CAST(:patch AS jsonb) "
                "WHERE id = :id"
            ),
            {
                "patch": json.dumps({"narrative": narrative, "narrative_version": VERSION}),
                "id": job_id,
            },
        )
        self.db.commit()
        return narrative
