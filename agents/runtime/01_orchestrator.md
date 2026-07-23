# Agent 1 — Orchestrator

**Phase introduced:** 2 (basic sequential), complete in Phase 4 (parallel DAG)
**Type:** Deterministic
**Module:** `backend/orchestrator/`

---

## Goal

Convert one user click into a correct, ordered, resumable set of agent tasks.
Never compute geospatial values. Never invoke the LLM. Route only.

---

## Trigger

`POST /analysis` from the web app.

---

## Inputs

Job envelope (see §5.1 of plan.md):

```json
{
  "job_id": "uuid",
  "municipality_id": "np-bag-ktm-01",
  "years": [2000, 2022],
  "requested_outputs": ["stats", "change", "maps", "report"],
  "dataset_version": "landcover-v3.1",
  "boundary_version": "mof-2021"
}
```

---

## Process

1. Validate `municipality_id` and `year_range` against PostGIS.
2. Check result cache for `(municipality_id, years, dataset_version)`. Return immediately on hit.
3. Open a provenance record via the Provenance Agent.
4. Build the execution DAG:
   ```
   Ingestion → Raster Analysis → (Change Detection ∥ Cartography) → Evidence → Narrative → Validation → Report
   ```
   - Phase 2: sequential only (`Ingestion → Raster → Change → Validation`)
   - Phase 4: full parallel DAG as above
5. Dispatch stages to Celery workers; stream per-stage progress to the client over SSE.
6. On stage failure: retry twice, then mark the job **partial** and emit whatever completed. Never fail silently — always emit a reason.

---

## Outputs

- Job status stream (SSE events per stage: `queued`, `running`, `complete`, `failed`)
- Final result bundle (aggregated outputs from all completed stages)
- Provenance ID linking to the complete audit record

---

## Guardrails

- Never invokes the LLM directly.
- Never computes geospatial values itself.
- Must emit a reason string for every failed or skipped stage.
- Partial results are valid outputs — better than a silent failure.

---

## Done when

Every requested output is either present in the result bundle, or explicitly marked unavailable with a reason string.

---

## Key implementation notes

- Cache key: `sha256(municipality_id + sorted(years) + dataset_version + boundary_version)`
- SSE event format: `{"stage": "raster_analysis", "status": "running", "pct": 40, "eta_s": 3}`
- DAG state is persisted to PostGIS so jobs survive worker restarts
- Retry budget: 2 retries per stage with exponential backoff (1 s, 4 s)
