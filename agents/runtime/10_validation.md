# Agent 10 — Validation Agent

**Phase introduced:** 2 (block gates), extended in Phase 4 (warn gates)
**Type:** Deterministic
**Module:** `backend/agents/validation/`

---

## Goal

Be the last gate before a user sees anything.
No blocked artefact is ever reachable from the UI.

---

## Trigger

Dispatched by the Orchestrator after each major stage completes. Also runs as a final pass before the Report Agent.

---

## Checks

| # | Check | Phase | Failure action |
|---|---|---|---|
| 1 | Class shares sum to 100 ± 0.01% | 2 | **Block** |
| 2 | Transition matrix row sums equal source-year class pixel totals | 2 | **Block** |
| 3 | Area values are positive and within municipality bounding box | 2 | **Block** |
| 4 | CRS used for area computation is projected (not geographic) | 2 | **Block** |
| 5 | Nodata / cloud share above 5% threshold | 4 | Warn + annotate |
| 6 | Year-over-year class change beyond ±30% of prior year total | 4 | Flag for review |
| 7 | Narrative numbers match source JSON (numeric guard) | 4 | **Block**, trigger Narrative Agent regeneration |
| 8 | Provenance record is complete (all stages logged with checksums) | 4 | **Block** |
| 9 | Maps contain: legend, scale bar, north arrow, CRS label, provenance ID | 4 | **Block** |
| 10 | Report contains provenance appendix | 4 | **Block** |
| 11 | Transition matrix column sums equal destination-year class totals | 4 | **Block** |

---

## Outputs

```json
{
  "job_id": "uuid",
  "verdict": "pass | warn | block",
  "checks": [
    {
      "id": "class_shares_sum",
      "status": "pass",
      "detail": "Shares sum to 99.9987% (within tolerance)"
    },
    {
      "id": "nodata_threshold",
      "status": "warn",
      "detail": "Cloud/nodata at 6.2% — above 5% threshold. Results annotated.",
      "annotation": "High cloud coverage in 2009 raster may affect accuracy."
    },
    {
      "id": "provenance_complete",
      "status": "block",
      "detail": "Missing stage log for 'cartography' — report cannot ship."
    }
  ],
  "blocked_artefacts": ["pdf", "docx"],
  "warnings": ["nodata_threshold:2009"]
}
```

A `block` verdict on any check means:
- The blocked artefact(s) are withheld from the job result
- The UI shows "Analysis incomplete — see quality report" with the blocking reason
- The Orchestrator marks the job `partial` and logs the block reason

A `warn` verdict means:
- The artefact is released with a visible annotation in the UI and in all exported formats
- The warning appears in the evidence panel

---

## Guardrails

- Validation Agent has no write access to any artefact — read-only.
- A passing numeric guard (check #7) does not remove the machine-generated label from narrative sections.
- Block reasons are always user-facing text (not stack traces).

---

## Done when

- No blocked artefact is reachable from the UI
- All warn annotations appear correctly in the frontend and in exported PDFs
- The Validation Agent's own output (the verdict JSON) is included in the provenance record

---

## Key implementation notes

```python
def check_class_shares_sum(stats: LandCoverStatistics) -> CheckResult:
    total = sum(c.share_pct for c in stats.classes) + stats.unclassified_pct + stats.cloud_or_nodata_pct
    if abs(total - 100.0) > 0.01:
        return CheckResult(id="class_shares_sum", status="block",
                          detail=f"Shares sum to {total:.4f}% — expected 100 ± 0.01%")
    return CheckResult(id="class_shares_sum", status="pass", detail=f"Shares sum to {total:.4f}%")

def check_transition_matrix(matrix: ChangeMatrix, from_stats: LandCoverStatistics) -> CheckResult:
    for cls in from_stats.classes:
        row_sum = sum(t.pixels for t in matrix.transitions if t.from_code == cls.code)
        if row_sum != cls.pixels:
            return CheckResult(id="transition_matrix_row_sums", status="block",
                              detail=f"Class {cls.name}: matrix row sum {row_sum} ≠ source pixels {cls.pixels}")
    return CheckResult(id="transition_matrix_row_sums", status="pass")
```

- Run checks 1–4 immediately after Raster Analysis and Change Detection complete (Phase 2 gates)
- Run checks 5–11 as a final pre-report gate (Phase 4 extension)
- Store the full verdict JSON in the provenance record for auditability
