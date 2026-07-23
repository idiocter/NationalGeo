# NGLIP — Nepal GeoAI Land Intelligence Platform
## 6-Phase Development Plan

> **Core principle — Deterministic core, generative edge.**
> The GIS engine computes. The LLM only explains what the engine computed.
> Every number is traceable to the raster, boundary version, and processing step that produced it.

---

## Project at a glance

| | |
|---|---|
| **Goal** | Turn 23 years of national land-cover rasters (2000–2022) into one-click, auditable land-intelligence for every municipality in Nepal |
| **Primary user action** | Click a municipality → get statistics, change detection, maps, charts, narrative, and an exportable report |
| **Non-negotiable property** | Every number is traceable to the raster, boundary version, and processing step that produced it |
| **MVP scope** | Phases 1–4 (Foundation + GIS Core + Intelligence + Reporting) |
| **Timeline** | ~8 months part-time, solo |

### Success criteria (MVP complete when)

1. Any of Nepal's 753 local units analyzed in **< 20 s** (single year), **< 90 s** (full 2000–2022 series)
2. Land-cover area totals reconcile within **±0.5%** against a manual QGIS control run on 5 sample municipalities
3. Every generated report opens an **evidence panel** listing sources, methods, and versions
4. Zero numeric values in any report originate from a language model

---

## Phase 1 — Foundation
### Weeks 1–4 · Infrastructure, Data Ingestion, Basic Map

**Goal:** Infrastructure is running, all 23 raster years are ingested and validated, and a municipality is selectable on a map.

### What to build

| Component | Description |
|---|---|
| PostGIS database | Schema for municipalities, datasets, provenance records, result cache |
| Boundary import | All 753 Nepal local units loaded, geometry validated (`ST_MakeValid`), spatially indexed |
| COG conversion pipeline | All 23 GeoTIFFs (2000–2022) converted to Cloud Optimized GeoTIFF with overviews |
| Ingestion Agent (basic) | Dataset registration, metadata capture, checksum, class-histogram baseline |
| Provenance Agent (skeleton) | Append-only record creation, job-open/close lifecycle |
| Basic Next.js frontend | MapLibre GL map of Nepal, municipality selector, click → shows name + boundary |
| Docker Compose dev environment | PostGIS, Redis, backend, frontend running with one command |

### Agent responsibilities this phase

- **Ingestion Agent** — full implementation (data integrity is the hardest risk to fix later)
- **Provenance Agent** — create/open/close records only
- **Build agents active:** `devops-engineer`, `geo-engine-engineer`, `frontend-engineer`

### Exit criterion

- Any municipality is selectable on the map; boundary renders in < 1 s
- All 23 rasters registered in the `datasets` table with checksums
- `class_histogram` baseline stored for every year
- All 23 years share identical CRS, resolution, and grid origin (Ingestion Agent verification passes)

---

## Phase 2 — GIS Core
### Weeks 5–8 · Raster Analysis, Change Detection, Validation

**Goal:** Pixel-accurate, projection-correct statistics for any municipality and year. The hardest technical risk is retired here.

### What to build

| Component | Description |
|---|---|
| Raster Analysis Agent | Windowed COG read → mask → pixel count → equal-area km² → statistics JSON (§5.2) |
| Change Detection Agent | Transition matrix, net change, trend series, CAGR, breakpoint detection (§5.3) |
| Validation Agent | All QA gates: class-share sum, matrix reconciliation, nodata threshold, plausibility band |
| Orchestrator (basic) | Job envelope, cache check, sequential DAG dispatch, SSE progress stream |
| FastAPI gateway | `POST /analysis`, `GET /jobs/{id}`, SSE endpoint |
| Celery + Redis | Task queue for long jobs, result caching by `(municipality_id, years, dataset_version)` |
| Golden-file tests | QGIS-verified reference outputs for 5 test municipalities, all years |
| Frontend: statistics panel | On municipality click: statistics table + one stacked-area chart |

### Agent responsibilities this phase

- **Raster Analysis Agent** — full implementation
- **Change Detection Agent** — full implementation
- **Validation Agent** — full implementation (block gates only; warn gates can come in Phase 4)
- **Orchestrator** — sequential job flow (parallel execution deferred to Phase 4)
- **Build agents active:** `geo-engine-engineer`, `backend-engineer`, `frontend-engineer`

### Exit criterion

- Stats match a manual QGIS run within **±0.5%** on 5 test municipalities for both single-year and full 2000–2022 series
- Transition matrix row sums equal source-year class totals exactly
- Single-year analysis completes in < 20 s; full 2000–2022 series in < 90 s
- All golden-file tests pass in CI

> **Sequencing rule:** Phase 3 does not begin until the ±0.5% reconciliation is verified. A beautiful report built on wrong numbers is a government liability.

---

## Phase 3 — Intelligence
### Weeks 9–13 · Evidence Agent, Supporting Datasets

**Goal:** Explain *why* changes happened with spatial evidence grounded in supporting datasets, not invented reasoning.

### What to build

| Component | Description |
|---|---|
| Supporting dataset ingestion | Road network (DoR), river network, DEM, protected area boundaries, population grids |
| Evidence Agent | Spatial association tests: distance-to-road decay, protected-area overlap, DEM/slope distribution, river proximity, population correlation |
| Effect-size computation | Chi-squared / Mann-Whitney with explicit uncertainty; no bare correlation coefficients |
| Evidence strength labels | `strong / moderate / weak / insufficient data` for every top-N transition |
| Evidence API endpoints | `GET /evidence/{job_id}` returning ranked evidence statements with sources |
| Frontend: evidence panel | Collapsible per-transition evidence cards; "insufficient data" shown honestly |

### Data contracts added

```json
{
  "claim": "Forest→Built-up concentrated near roads",
  "metric": "68% of transition area within 500 m of road network",
  "baseline": "31% for random points in same municipality",
  "strength": "strong",
  "sources": ["roads-dor-2020", "landcover-v3.1"]
}
```

### Agent responsibilities this phase

- **Evidence Agent** — full implementation
- **Ingestion Agent** — extended to handle supporting vector datasets
- **Build agents active:** `geo-engine-engineer`, `backend-engineer`, `frontend-engineer`

### Language guardrails (enforced in Evidence Agent output)

Words **forbidden** in output: `caused`, `because`, `due to`
Words **required** for association claims: `associated with`, `concentrated near`, `co-occurs with`

### Exit criterion

- Every top-N land-cover transition for any analyzed municipality has either:
  - A ranked evidence statement with strength label and source list, OR
  - An explicit `"insufficient data"` gap note
- No evidence statement contains causal language

---

## Phase 4 — Reporting
### Weeks 14–18 · Cartography, Narrative, Reports, Full Provenance

**Goal:** Professional, self-contained, auditable deliverables that a ministry can cite as a source.

### What to build

| Component | Description |
|---|---|
| Cartography Agent | Maps (land-cover, change, forest-loss, urban-expansion), charts (stacked area, Sankey, trend lines, bar), time-lapse MP4+GIF at 300 DPI |
| Narrative Agent | Ollama (Llama 3.1 8B) prose generation; strict numeric guard; deterministic fallback template; citation IDs on every quantitative sentence |
| Report Agent | PDF (WeasyPrint), DOCX (python-docx), XLSX (openpyxl), map bundle assembly |
| Provenance Agent (full) | Complete audit ledger: input checksums, parameters, library versions, CRS, runtime, output checksum per stage |
| Orchestrator (complete) | Full parallel DAG: `Ingestion → Raster Analysis → (Change Detection ∥ Cartography) → Evidence → Narrative → Validation → Report`; retry × 2 on failure; partial result emission |
| Frontend: report UI | SSE-driven progressive rendering; map tiles load before narrative; download links for all formats; evidence panel with "Show evidence" drill-down |
| Validation Agent (extended) | Warn gates for nodata/cloud threshold and year-over-year plausibility band |

### Narrative Agent guardrails

- Temperature ≤ 0.3
- Model performs no arithmetic whatsoever
- Every number in prose must match source JSON (numeric guard); mismatch → regenerate once → deterministic template
- Output labelled as machine-generated in every export

### Agent responsibilities this phase

- **Cartography Agent** — full implementation
- **Narrative Agent** — full implementation
- **Report Agent** — full implementation
- **Provenance Agent** — full implementation (complete audit trail)
- **Orchestrator** — complete parallel DAG
- **Validation Agent** — extended with warn gates
- **Build agents active:** `geo-engine-engineer`, `backend-engineer`, `frontend-engineer`, `ai-integration-engineer`

### Exit criterion

- Full PDF report with working evidence panel for any of 753 municipalities
- Narrative numbers pass the numeric guard 100% of the time in a 50-report regression test
- Every map is self-describing at A3 print (legend, north arrow, scale bar, CRS, source, provenance ID)
- Any figure a user sees traces to raw inputs in ≤ 2 clicks in the evidence panel
- All four report formats (PDF, DOCX, XLSX, map bundle) generate without error

---

## Phase 5 — Platform
### Weeks 19–24 · Production Hardening, Dashboard, Performance

**Goal:** Production-ready platform that reliably handles all 753 municipalities at scale.

### What to build

| Component | Description |
|---|---|
| National dashboard | Municipality comparison, national overview heatmap, trend analytics, top-N change rankings |
| Performance optimization | Precomputed national statistics nightly, tile CDN, response time SLA enforcement |
| Auth | JWT + API key (basic; no multi-tenant) |
| Monitoring + alerting | Job failure rates, p95 latency per stage, data quality metrics, Grafana dashboards |
| Production deployment | Docker Compose → production config; object storage for GeoTIFFs and reports; nightly backups with restore test |
| API documentation | OpenAPI spec, usage examples, data contract reference |
| Load testing | Verify < 20 s / < 90 s SLA at 20 concurrent users |
| Lighthouse audit | Score ≥ 90 on performance, accessibility, best practices |

### Agent responsibilities this phase

- All 10 runtime agents in full production configuration
- **Build agents active:** `devops-engineer`, `backend-engineer`, `frontend-engineer`

### Exit criterion

- One-command deploy to production environment
- Backup restore tested and documented
- All 753 municipalities pass the performance SLA (verified by load test)
- Lighthouse ≥ 90 on dashboard
- Monitoring alerts fire within 60 s of a simulated job failure

---

## Phase 6 — Forecasting
### Months 7–8 · ML Projection, Risk Layers

**Goal:** Honest land-cover projections to 2025/2030/2040 with validated accuracy and unambiguous uncertainty labelling.

> **This phase does not ship unless the backtest beats the Markov baseline. Accuracy below threshold means the feature stays disabled.**

### What to build

| Component | Description |
|---|---|
| Per-pixel feature stack | Historical class sequence, distance-to-road, distance-to-river, elevation, slope, population density, protected-area flag |
| Baseline: Markov projection | Transition-probability matrix applied forward. Ship this before any ML. |
| ML model: Random Forest / XGBoost | Per-pixel transition probability; trained per municipality or region |
| Backtesting harness | Train 2000–2015 → test 2016–2022; report overall accuracy, kappa, per-class recall and F1 |
| Forecast Agent | Feature stack assembly, model inference, uncertainty interval computation, prediction caching |
| Prediction UI | Visually distinct from observed data (striped/lighter styling); year sliders for 2025/2030/2040; confidence band overlays |
| Risk layers | High-risk-of-deforestation overlay; urban expansion pressure zones |

### Forecast Agent guardrails

- Predictions labelled as **projections** everywhere — UI, maps, reports, API responses
- Confidence intervals always displayed; never a point estimate alone
- Feature disabled if backtest kappa < agreed threshold (set after Markov baseline is measured)
- Projections visually styled so they cannot be mistaken for observed data

### Agent responsibilities this phase

- **Forecast Agent** — full implementation (new)
- All Phase 5 agents remain active
- **Build agents active:** `ml-engineer`, `geo-engine-engineer`, `frontend-engineer`

### Exit criterion

- Backtest on 2016–2022 data beats the Markov baseline on kappa score
- Per-class recall reported and documented for the backtesting period
- All forecast outputs carry "PROJECTION" labels in every export format
- Feature can be disabled via a feature flag without affecting any Phase 1–5 functionality

---

## Agent roster

### Runtime agents (product components)

| # | Agent | Phase introduced | Type |
|---|---|---|---|
| 1 | Orchestrator | 2 (full in 4) | Deterministic |
| 2 | Ingestion Agent | 1 | Deterministic |
| 3 | Raster Analysis Agent | 2 | Deterministic |
| 4 | Change Detection Agent | 2 | Deterministic |
| 5 | Evidence Agent | 3 | Deterministic |
| 6 | Cartography Agent | 4 | Deterministic |
| 7 | Narrative Agent | 4 | LLM (Ollama) |
| 8 | Report Agent | 4 | Deterministic |
| 9 | Provenance Agent | 1 (full in 4) | Deterministic |
| 10 | Validation Agent | 2 (extended in 4) | Deterministic |
| 11 | Forecast Agent | 6 | ML |

### Build agents (development-time)

| Agent | Phase | Owns |
|---|---|---|
| `devops-engineer` | 1, 5 | Docker, storage, migrations, monitoring, backups, one-command deploy |
| `geo-engine-engineer` | 1–6 | Rasterio/GDAL/GeoPandas pipeline, CRS correctness, COG tooling, golden-file tests |
| `backend-engineer` | 2–5 | FastAPI, Celery, SSE, PostGIS schema, caching, auth, API docs |
| `frontend-engineer` | 1–6 | Next.js, MapLibre, Recharts, streaming UI, evidence panel, Lighthouse |
| `ai-integration-engineer` | 4 | Ollama serving, prompt templates, numeric guard, fallback templates |
| `ml-engineer` | 6 | Feature stack, Markov baseline, RF/XGBoost, backtesting harness |

---

## Data contracts (canonical — nothing else crosses agent boundaries)

### Job envelope

```json
{
  "job_id": "uuid",
  "municipality_id": "np-bag-ktm-01",
  "years": [2000, 2022],
  "requested_outputs": ["stats", "change", "maps", "report"],
  "dataset_version": "landcover-v3.1",
  "boundary_version": "mof-2021",
  "status": "queued|running|complete|failed",
  "provenance_id": "uuid"
}
```

### Land-cover statistics

```json
{
  "year": 2015,
  "crs_used": "EPSG:32645",
  "pixel_area_m2": 900,
  "classes": [
    {"code": 1, "name": "Forest", "pixels": 412934, "area_km2": 371.64, "share_pct": 44.2}
  ],
  "unclassified_pct": 0.3,
  "cloud_or_nodata_pct": 1.1
}
```

### Change transition matrix

```json
{
  "from_year": 2015, "to_year": 2022,
  "transitions": [
    {"from": "Forest", "to": "Built-up", "area_km2": 6.31, "pct_of_source": 1.7}
  ],
  "net_change": [{"class": "Forest", "delta_km2": -18.42}],
  "confidence_note": "single-date annual composite; sub-pixel change not detectable"
}
```

### Class codebook (fixed, versioned)

| Code | Class |
|---|---|
| 0 | NoData |
| 1 | Forest |
| 2 | Agriculture |
| 3 | Water |
| 4 | Grassland |
| 5 | Open woodland |
| 6 | Built-up |
| 7 | Barren |
| 8 | Snow |

---

## Repository layout

```
nglip/
├── plan.md                         # this file
├── agents/
│   ├── runtime/                    # one spec per runtime agent
│   └── build/                      # one spec per build agent
├── backend/
│   ├── api/                        # FastAPI routes
│   ├── orchestrator/               # job router and DAG
│   ├── agents/                     # runtime agent implementations
│   │   ├── ingestion/
│   │   ├── raster/
│   │   ├── change/
│   │   ├── evidence/
│   │   ├── cartography/
│   │   ├── narrative/
│   │   ├── report/
│   │   ├── provenance/
│   │   ├── validation/
│   │   └── forecast/
│   ├── contracts/                  # Pydantic models from data contracts
│   └── tests/
│       └── golden/                 # QGIS-verified reference outputs
├── frontend/                       # Next.js app
├── data/
│   ├── rasters/{version}/          # COG GeoTIFFs
│   ├── boundaries/                 # Nepal municipal boundaries
│   └── supporting/                 # Roads, DEM, rivers, population
└── infra/                          # Docker, migrations, monitoring
```

---

## Top risks

| Risk | Mitigation | Phase caught |
|---|---|---|
| Area computed in degrees | Enforce equal-area reprojection in one shared util; assert in all tests | 2 |
| Class definitions drift across years | Ingestion Agent histogram check; version the codebook | 1 |
| LLM invents numbers | Numeric guard + deterministic fallback template | 4 |
| Boundary changes over time | Pin `boundary_version` per job; surface in every report | 1 |
| Full-Nepal series too slow | COG + windowed reads + result cache + Celery | 2 |
| Users treat projections as facts | Distinct styling, mandatory labelling, disabled if backtest fails | 6 |
| Evidence claims causality | Forbidden-word enforcement in Evidence Agent output validation | 3 |
| Incomplete provenance breaks audit | Validation Agent blocks any output without complete provenance record | 4 |
