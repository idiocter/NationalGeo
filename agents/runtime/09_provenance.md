# Agent 9 — Provenance Agent

**Phase introduced:** 1 (skeleton), full in Phase 4
**Type:** Deterministic
**Module:** `backend/agents/provenance/`

---

## Goal

Make every output auditable — the property that separates research-grade analysis from a dashboard.
Any number a user sees must trace to raw inputs in ≤ 2 clicks.

---

## Trigger

- **Record open:** called by Orchestrator at job start
- **Stage log:** called by each agent as it completes a stage
- **Record close:** called by Orchestrator at job completion
- **Evidence panel query:** called by the frontend when a user clicks "Show evidence"

---

## Process

### Phase 1 (skeleton)
1. `open_record(job_id, municipality_id, years, dataset_version, boundary_version)` → creates an append-only record in PostGIS
2. `close_record(job_id, status)` → marks the record complete or failed

### Phase 4 (full)
3. `log_stage(job_id, stage_name, ...)` → appends a stage entry with:
   - Agent name and version (`raster_analysis:v1.2.0`)
   - Input checksums (SHA-256 of every input file or JSON payload)
   - Parameters used (CRS, pixel area, mask strategy, model name)
   - Library versions (`rasterio==1.3.9`, `numpy==1.26.4`, etc.)
   - CRS used for area computation
   - Wall-clock runtime in milliseconds
   - Output checksum
4. `link_figure(provenance_id, figure_id, stage_name)` → links a statistic, map, or narrative sentence to its producing stage
5. `serve_evidence_panel(figure_id)` → returns the complete chain: figure → stage → inputs → raw files

### Reproducibility manifest
6. `generate_manifest(job_id)` → returns a JSON document listing every input, every parameter, and every library version needed to reproduce the outputs exactly

---

## Outputs

### Evidence panel payload (per figure)

```json
{
  "figure_id": "stat:2015-forest-area",
  "value": "371.64 km²",
  "produced_by": {
    "agent": "raster_analysis",
    "version": "v1.2.0",
    "timestamp": "2024-03-15T09:21:03Z",
    "runtime_ms": 4230
  },
  "inputs": [
    {"type": "raster", "path": "landcover/v3.1/2015.tif", "checksum": "sha256:abc123..."},
    {"type": "vector", "source": "mof-2021", "municipality": "np-bag-ktm-01", "checksum": "sha256:def456..."}
  ],
  "parameters": {
    "crs_for_area": "EPSG:32645",
    "mask_strategy": "all_touched=False",
    "pixel_area_m2": 900.0
  },
  "library_versions": {
    "rasterio": "1.3.9",
    "numpy": "1.26.4",
    "gdal": "3.8.4"
  },
  "quality_notes": ["nodata_pct=1.1%", "edge_pixel_fraction=4%"]
}
```

---

## Guardrails

- **Append-only:** records are never edited or deleted. Corrections are made by re-running the job, which creates a new record.
- Every `log_stage` call must include the output checksum — no stage is logged without it.
- The provenance record is opened before any stage runs and must be closeable even if all stages fail.

---

## Done when

- Any figure visible to a user resolves to its full provenance chain in ≤ 2 clicks in the UI
- Re-running the job with the same manifest produces identical output checksums
- The provenance appendix in every report matches the live evidence panel

---

## Key implementation notes

```sql
-- Append-only table — no UPDATE or DELETE in application code
CREATE TABLE provenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  stage TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  input_checksums JSONB NOT NULL,
  parameters JSONB NOT NULL,
  library_versions JSONB NOT NULL,
  crs_used TEXT,
  runtime_ms INTEGER,
  output_checksum TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Figure linkage
CREATE TABLE figure_provenance (
  figure_id TEXT NOT NULL,
  provenance_record_id UUID NOT NULL REFERENCES provenance_records(id),
  PRIMARY KEY (figure_id, provenance_record_id)
);
```

- Library version capture: `importlib.metadata.version('rasterio')` at stage execution time
- Checksum method: `hashlib.sha256(file_bytes).hexdigest()` for files; `hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()` for JSON
- Evidence panel API: `GET /provenance/figure/{figure_id}` → returns the chain
- Manifest: `GET /provenance/jobs/{job_id}/manifest` → returns the reproducibility document
