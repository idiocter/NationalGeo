# NGLIP — Nepal GeoAI Land Intelligence Platform: Full System Detail

## Table of Contents
1. [Repository Layout](#1-repository-layout)
2. [Infrastructure & Docker](#2-infrastructure--docker)
3. [Database Schema](#3-database-schema)
4. [Backend API](#4-backend-api)
5. [Analysis Pipeline (Celery DAG)](#5-analysis-pipeline-celery-dag)
6. [Agent Deep Dives](#6-agent-deep-dives)
7. [Data Ingest Pipeline](#7-data-ingest-pipeline)
8. [Land Cover Map Endpoint](#8-land-cover-map-endpoint)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Frontend Components](#10-frontend-components)
11. [Frontend State & Streaming](#11-frontend-state--streaming)
12. [Non-Negotiable Constraints](#12-non-negotiable-constraints)

---

## 1. Repository Layout

```
Intelligent_Land/
├── backend/               FastAPI app + Celery workers + all agents
│   ├── api/               HTTP layer (routes, dependencies, main.py)
│   ├── agents/            One folder per pipeline agent
│   │   ├── ingestion/     COG validation & dataset registration
│   │   ├── raster/        Per-year land-cover statistics from COGs
│   │   ├── change/        Transition matrix, net change, CAGR, breakpoints
│   │   ├── evidence/      Effect-size statements from transitions
│   │   ├── cartography/   Static PNG map generation (matplotlib/rasterio)
│   │   ├── narrative/     Deterministic template + optional Ollama LLM
│   │   ├── report/        PDF (WeasyPrint) + XLSX (openpyxl) assembly
│   │   ├── validation/    QA gate checks (block/warn/pass)
│   │   └── provenance/    Append-only audit records
│   ├── orchestrator/      Top-level Celery task that sequences all agents
│   ├── contracts/         Pydantic models (shared across agents) + geo_utils
│   ├── scripts/           One-off data scripts (ingest, boundary import)
│   └── tests/             Pytest unit + integration tests
├── frontend/              Next.js 14 (App Router) TypeScript SPA
│   ├── app/               Pages: / (home map) and /municipality/[id]
│   ├── components/        All UI components
│   ├── lib/               API client, SSE hook, constants
│   └── types/             Shared TypeScript types
├── infra/
│   ├── docker-compose.yml 6 services: db, redis, backend, worker, frontend, ollama
│   └── sql/init.sql       PostGIS schema (all tables, rules, indexes)
├── data/                  Persistent volumes mounted into containers
│   ├── dataset/           Raw ICIMOD GeoTIFFs (lc2000.tif … lc2020.tif)
│   ├── landcover/         Processed COGs (landcover-v3.1/2000.tif … 2020.tif)
│   └── reports/           Generated PDFs, XLSXs, map PNGs per job_id
└── agents/
    ├── build/             Markdown specs for each build-time role
    └── runtime/           Markdown specs for each runtime agent (01–11)
```

---

## 2. Infrastructure & Docker

### Services (`infra/docker-compose.yml`)

| Service | Image | Port | Role |
|---------|-------|------|------|
| `db` | postgis/postgis:16-3.4 | 5432 | PostgreSQL 16 with PostGIS 3.4. Healthcheck: `pg_isready`. Schema loaded from `infra/sql/init.sql` on first start. Data persisted in `pgdata` named volume. |
| `redis` | redis:7-alpine | 6379 | Message broker for Celery tasks AND pub/sub channel for SSE progress events. Configured with `maxmemory 2gb, allkeys-lru`. |
| `backend` | Built from `backend/Dockerfile` | 8000 | FastAPI app served by uvicorn. Waits for db + redis healthchecks. `../data` mounted at `/data`. |
| `worker` | Same image as backend | — | Celery worker. Command: `celery -A backend.celery_app worker --concurrency=4 -Q orchestrator,gis,celery`. Consumes tasks from those three queues. Same `/data` mount. |
| `frontend` | Built from `frontend/Dockerfile` | 3000 | Next.js production build served by Node. `NEXT_PUBLIC_API_URL=http://localhost:8000`. |
| `ollama` | ollama/ollama:latest | 11434 | Optional LLM server (profile: `narrative`). GPU passthrough via nvidia driver reservation. Not started by default. |

### Build commands
```bash
cd infra/
docker-compose build backend frontend   # rebuild both
docker-compose up -d                    # start everything
```
The `infra-frontend` image tag is what the running container uses — always build from `infra/` directory with `docker-compose build`, never `docker build -t` directly.

### Environment variables (`backend/config.py`)
Settings are read from `.env` via `pydantic_settings.BaseSettings`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql+asyncpg://nglip:dev_password…@localhost:5432/nglip` | Async DB for FastAPI; sync variant built on the fly for Celery agents |
| `REDIS_URL` | `redis://localhost:6379/0` | Celery broker + result backend + pub/sub |
| `OBJECT_STORE_PATH` | `/data` | Root for COGs, reports, maps |
| `OLLAMA_URL` | `http://localhost:11434` | Narrative agent's LLM endpoint |
| `OLLAMA_MODEL` | `llama3.1:8b` | Model name sent to Ollama API |
| `JWT_SECRET` | `change_me_in_production` | HS256 signing key |
| `FORECAST_ENABLED` | `false` | **Always false** — forecast feature disabled |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | Allowed CORS origins |
| `ANALYSIS_TIMEOUT_S` | `120` | Per-request timeout |
| `CACHE_TTL_S` | `86400` | Result cache TTL (24 h) |

---

## 3. Database Schema

All tables live in a PostGIS-enabled PostgreSQL 16 database. Schema is in `infra/sql/init.sql`; no migration framework runs it — it is applied once at container init via `docker-entrypoint-initdb.d`.

### `municipalities`
Stores all 753 Nepal local units imported from `data/boundaries/nepal_local_units.gpkg`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | e.g. `NP0771303` |
| `name` | TEXT | English name |
| `name_np` | TEXT | Nepali name |
| `province` | TEXT | Province name |
| `district` | TEXT | District name |
| `type` | TEXT | `metropolitan / sub_metropolitan / municipality / rural_municipality` |
| `total_area_km2` | FLOAT | Pre-computed from boundary |
| `population` | INTEGER | Census population |
| `geom` | GEOMETRY(MULTIPOLYGON, 4326) | Boundary in WGS84. GIST index. |

### `datasets`
Immutable registry of all data versions. **Once registered, never overwritten — corrections create a new version.**

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `version` | TEXT UNIQUE | e.g. `landcover-v3.1`, `mof-2021` |
| `dataset_type` | TEXT | `landcover / boundary / roads / dem / rivers / protected_areas / population` |
| `checksum` | TEXT | SHA-256 of the dataset package |
| `year_range` | INT4RANGE | e.g. `[2000, 2022]` |
| `ingested_at` | TIMESTAMPTZ | |

### `jobs`
One row per submitted analysis request.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Returned to client as `job_id` |
| `municipality_id` | TEXT FK → municipalities | |
| `years` | INT[] | e.g. `{2000,2005,2010,2015,2020}` |
| `requested_outputs` | TEXT[] | e.g. `{stats,change,maps,report}` |
| `dataset_version` | TEXT FK → datasets.version | |
| `boundary_version` | TEXT FK → datasets.version | |
| `status` | TEXT | `queued / running / complete / failed / partial` |
| `result` | JSONB | Accumulated result blob — each agent appends its output here |
| `cache_hit` | BOOLEAN | True if result came from `result_cache` |

The `result` JSONB blob grows during the pipeline. Final shape:
```json
{
  "statistics": [...],       // from RasterAnalysisAgent
  "change_matrix": [...],    // from ChangeDetectionAgent
  "evidence": [...],         // from EvidenceAgent
  "narrative": "...",        // from NarrativeAgent
  "artefacts": {             // from ReportAgent
    "pdf":  {"url": "/jobs/{id}/report.pdf"},
    "xlsx": {"url": "/jobs/{id}/report.xlsx"}
  },
  "validation": {            // from ValidationAgent
    "verdict": "pass|warn|block",
    "checks": [...]
  }
}
```

### `result_cache`
Keyed on SHA-256 of `(municipality_id + sorted(years) + dataset_version + boundary_version)`. Cache-hit jobs return the stored result immediately without running the pipeline.

### `provenance_records`
Append-only audit log. A PostgreSQL RULE prevents any `UPDATE` or `DELETE`:
```sql
CREATE RULE no_update_provenance AS ON UPDATE TO provenance_records DO INSTEAD NOTHING;
CREATE RULE no_delete_provenance AS ON DELETE TO provenance_records DO INSTEAD NOTHING;
```
Each agent stage writes one record storing: agent version, input checksums, parameters, library versions, CRS used, runtime ms, output checksum.

### `validation_verdicts`
One row per validation run storing verdict (`pass/warn/block`), full check JSON, blocked artefacts list, and warning strings.

### `class_histograms`
National pixel histogram per year and dataset version — used for calibration/QA, not for per-municipality analysis.

---

## 4. Backend API

Entry point: `backend/api/main.py` — creates `FastAPI` app, registers routers, sets up CORS middleware.

### Routers

#### `GET /health` (`routes/health.py`)
Simple liveness probe — returns `{"status": "ok"}`.

#### `GET /municipalities` (`routes/municipalities.py`)
Returns all municipalities as a list. Each item includes `id, name, province, district, type, total_area_km2, population, geometry` (GeoJSON geometry from PostGIS `ST_AsGeoJSON`).

#### `GET /municipalities/{id}` (`routes/municipalities.py`)
Single municipality by ID with full geometry.

#### `GET /municipalities/{id}/landcover/{year}.png` + HEAD (`routes/landcover_map.py`)
Renders a clipped RGBA PNG of the land cover raster for a municipality and year. See [section 8](#8-land-cover-map-endpoint) for full detail.

#### `POST /analysis` (`routes/analysis.py`)
Submits a job. Request body is a `JobEnvelope`:
```json
{
  "municipality_id": "NP0771303",
  "years": [2000, 2005, 2010, 2015, 2020],
  "requested_outputs": ["stats", "change", "maps", "report"],
  "dataset_version": "landcover-v3.1",
  "boundary_version": "mof-2021"
}
```
1. Validates municipality exists.
2. Computes `cache_key = SHA-256(municipality_id + sorted(years) + dataset_version + boundary_version)`.
3. Checks `result_cache` — if hit, returns immediately with `status: "complete"` and the cached `result`.
4. If miss: inserts a `jobs` row with `status: "queued"`, dispatches `run_analysis` Celery task to the `orchestrator` queue, returns `{job_id, status: "queued"}`.

#### `GET /jobs/{job_id}` (`routes/analysis.py`)
Returns full job row including `result` JSONB.

#### `GET /jobs/{job_id}/stream` (`routes/analysis.py`)
Server-Sent Events stream. Subscribes to Redis pub/sub channel `nglip:job:{job_id}`. Each message is a JSON object: `{stage, status, pct, job_id}`. Stream closes when a terminal event (`complete/failed/partial`) arrives or after 90s (client-side timeout in `lib/sse.ts`).

#### `GET /jobs/{job_id}/report.csv` (`routes/analysis.py`)
Builds and streams a CSV inline (no file on disk). Three sections: per-year statistics, net change summary, CAGR table.

#### `GET /jobs/{job_id}/report.pdf` (`routes/analysis.py`)
If `data/reports/{job_id}/report.pdf` exists, serves it. If not (e.g. old cache-hit jobs), calls `generate_pdf()` synchronously on demand, then serves it.

#### `GET /jobs/{job_id}/report.xlsx` (`routes/analysis.py`)
Same on-demand pattern as PDF.

#### `GET /jobs/{job_id}/maps/{filename}` (`routes/analysis.py`)
Serves `comparison_map.png` or `change_map.png` from `data/reports/{job_id}/`. Only those two filenames are allowed.

#### `GET /dashboard` (`routes/dashboard.py`)
Returns aggregate stats: total municipalities analysed, total jobs, jobs by status, dataset versions registered.

#### `GET /provenance/figure/{figure_id}` (`routes/provenance.py`)
Returns provenance record for a specific figure/output.

#### `GET /provenance/jobs/{job_id}/manifest` (`routes/provenance.py`)
Returns all provenance records for a job as an audit manifest.

#### `POST /auth/token`, `GET /auth/me` (`routes/auth.py`)
JWT-based authentication. `POST /auth/token` accepts `{username, password}`, returns `{access_token, token_type}`. `GET /auth/me` returns `{authenticated, username}`.

### Async DB sessions (`api/dependencies.py`)
`get_session()` yields an `AsyncSession` from SQLAlchemy 2.x async engine (`asyncpg` driver). Used in all route handlers via FastAPI `Depends`.

Celery agents use a separate sync engine built at task time:
```python
sync_url = f"postgresql+psycopg2://{raw_url.split('://', 1)[1]}"
engine = create_engine(sync_url, pool_size=1, max_overflow=0)
```

---

## 5. Analysis Pipeline (Celery DAG)

### Celery app (`backend/celery_app.py`)
Broker and result backend both point to Redis. Three queues: `orchestrator`, `gis`, `celery`.

### Orchestrator task (`backend/orchestrator/tasks.py`)

```
run_analysis (queue: orchestrator, time_limit: 900s)
```

Stages run **sequentially** in this order — each stage's output (written to `jobs.result` JSONB) is consumed by the next:

```
open_record (provenance)
    ↓
ingestion_check      [30s timeout]   — validates COG files exist
    ↓
raster_analysis      [300s timeout]  — per-year pixel stats
    ↓
change_detection     [150s timeout]  — transition matrix + net change
    ↓
evidence             [90s timeout]   — optional, skipped if change failed
    ↓
cartography          [150s timeout]  — optional, only if "maps" requested
    ↓
narrative            [120s timeout]  — optional, only if "report" requested
    ↓
report               [150s timeout]  — optional, only if "report" requested
    ↓
validation           [30s timeout]   — always runs, even if upstream failed
    ↓
close_record (provenance)
```

**Optional stages** (`evidence`, `cartography`, `narrative`, `report`): failures are logged but do not abort downstream. The job still finishes as `complete`.

**Core failure** (`raster_analysis` fails): all downstream stages are skipped except `validation`. Final status becomes `partial`.

Each stage publishes progress events to Redis pub/sub via `publish_stage_event(job_id, stage, status, pct)`. The SSE stream endpoint relays these to the browser in real time.

After all stages, `finalise_job()` updates `jobs.status` and writes to `result_cache` if the job succeeded. Then `close_record` appends the provenance close entry.

**Retry policy**: each stage gets 2 retries (`MAX_RETRIES = 2`) before being marked failed.

---

## 6. Agent Deep Dives

### 6.1 Ingestion Check (`agents/ingestion/`)
Validates that each requested COG exists at `{OBJECT_STORE_PATH}/landcover/{dataset_version}/{year}.tif`. Uses `rasterio.open()` to verify the file is readable and has valid CRS/nodata. Raises `FileNotFoundError` if any COG is missing, causing the pipeline to abort at `raster_analysis`.

### 6.2 Raster Analysis (`agents/raster/agent.py`)
**Input**: municipality boundary (from DB as WGS84 GeoJSON), COG per year.
**Process** (per year):
1. Fetch municipality geometry via `ST_AsGeoJSON`.
2. Reproject geometry from EPSG:4326 to the raster's native CRS (typically EPSG:32645 UTM Zone 45N).
3. Call `rasterio.mask()` with `crop=True, all_touched=False` — only pixels whose centroid falls inside the boundary are counted.
4. Count pixels per class code (`np.unique`). Separate raster fill-value pixels (outside boundary) from semantic NoData (code 0 inside boundary).
5. Convert pixel counts to km² using `pixel_area_m2 = abs(transform.a * transform.e)` computed in the raster's equal-area CRS.
6. Normalise `share_pct` to sum to exactly 100.0 (float drift correction applied to the dominant class).
7. Flag `cloud_or_nodata_pct ≥ 10%` as elevated, `≥ 20%` as high.

**Output**: `LandCoverStatistics` per year, written to `jobs.result["statistics"]`.

**Class system**: ICIMOD 11-class (codes 1–11). Code 0 = NoData. Codes 2/7 (Snow/Cultivated) and 3/6 (Barren/Shrubland) were historically swapped in some datasets — palette is verified against national pixel counts.

### 6.3 Change Detection (`agents/change/agent.py`)
**Input**: per-year statistics (from `jobs.result`) + raw COGs for `from_year` and `to_year`.
**Process**:
1. Re-reads exactly two COGs (first and last year in the series) using the same masking approach.
2. Aligns both arrays to the same pixel grid (shape must match — raises `RuntimeError` if not).
3. **Pixel-level transition matrix**: counts how many pixels of each class in `from_year` became each class in `to_year`. Only pixels classified in both years are counted. `priority_flag=True` if a cross-class transition exceeds 1% of the source class.
4. **Net change**: `delta_km2 = to_area - from_area` for each class.
5. **CAGR**: `(to_area / from_area)^(1/n_years) - 1` per class.
6. **Trend series**: wraps per-year `LandCoverStatistics` into `TrendPoint` objects.
7. **Breakpoint detection**: variance-split algorithm across 5+ year series. For each class, finds the year split maximising between-group variance. Flags breakpoints where variance reduction > 30% (confidence: high >60%, moderate 40–60%, low 30–40%).

**Output**: `ChangeMatrix`, written to `jobs.result["change_matrix"]`.

### 6.4 Evidence Agent (`agents/evidence/agent.py`)
**Input**: top-8 non-identity transitions (by area), sorted descending.
**Process**:
- For each transition `from → to`:
  - Computes Wilson score 95% CI: `ci_95_low, ci_95_high`.
  - Assigns strength: `strong` (pct ≥ 10% OR area ≥ 50 km²), `moderate` (≥ 3%/10 km²), `weak` (≥ 0.5%/1 km²), `insufficient data` otherwise.
  - Builds a neutral claim string using only approved language (no "caused", "because", "due to" — uses "associated with", "co-occurs with").
- Priority transition pairs (e.g. Forest→Settlement, Forest→Cultivated) are flagged.
- Adds 4 spatial evidence placeholders for `roads`, `dem`, `rivers`, `population` — shows "insufficient data" until supporting datasets are loaded via `make ingest-supporting`.

**Output**: list of `EvidenceStatement`, written to `jobs.result["evidence"]`.

### 6.5 Cartography Agent (`agents/cartography/agent.py`)
Generates two static PNG maps using matplotlib + rasterio:
- **`comparison_map.png`**: side-by-side from_year vs to_year land cover with legend.
- **`change_map.png`**: pixel-level change map showing transitions.
Saved to `data/reports/{job_id}/`. Served via `GET /jobs/{job_id}/maps/{filename}`.

### 6.6 Narrative Agent (`agents/narrative/agent.py`)
**Process**:
1. Tries Ollama first: sends a structured prompt with all statistics as JSON, temperature 0.3. Prompt forbids invented numbers and the words "caused/because/due to".
2. Numeric guard: scans LLM output for any number not present in the source JSON. If rogue numbers found → discard LLM output.
3. Falls back to deterministic template if Ollama is unavailable or numeric guard fails.
4. Template produces sections: Overview, Change Detection summary, Evidence summary, Data quality note.
5. Every output ends with a machine-generated disclaimer label.

**Output**: markdown narrative string, written to `jobs.result["narrative"]`.

### 6.7 Report Agent (`agents/report/agent.py`)
**PDF** (`generate_pdf`): renders an HTML template with 4 sections (statistics table, net change table, evidence table, narrative) using WeasyPrint. Output: `data/reports/{job_id}/report.pdf`.

**XLSX** (`generate_xlsx`): builds a 6-sheet workbook with openpyxl:
- Sheet 1: Statistics (year × class × area/share/pixels)
- Sheet 2: Net Change (from/to year × class × delta km²/%)
- Sheet 3: Transitions (full pixel-level matrix)
- Sheet 4: CAGR per class
- Sheet 5: Evidence statements
- Sheet 6: Metadata (municipality, job ID, generated timestamp, machine label)

Output: `data/reports/{job_id}/report.xlsx`.

Both functions are also callable on-demand from the download endpoints if files don't exist on disk (handles cache-hit jobs from before the report agent was added).

### 6.8 Validation Agent (`agents/validation/agent.py`)
Runs 5 QA gates — each returns `pass`, `warn`, or `block`:

| Gate | Block | Warn |
|------|-------|------|
| `share_sum` | Class share_pct doesn't sum to 100% ± 1% | — |
| `nodata` | nodata_pct ≥ 20% (year unusable) | nodata_pct ≥ 10% |
| `crs_assertion` | CRS is not EPSG:32645 | — |
| `matrix_rowsum` | — | Transition row sum differs from source-year area by > 5% |
| `plausibility` | Annualised area change ≥ 50%/yr | Annualised change ≥ 30%/yr |

Final verdict: `block` if any gate blocked, `warn` if any warned, `pass` otherwise. Writes to `validation_verdicts` table AND `jobs.result["validation"]`.

### 6.9 Provenance Agent (`agents/provenance/agent.py`)
`open_record`: inserts a row in `provenance_records` at pipeline start.
`close_record`: appends a completion record at pipeline end.
Because the DB rules prevent UPDATE/DELETE, these are always INSERT operations.

---

## 7. Data Ingest Pipeline

### Raw data location
Original ICIMOD GeoTIFFs are in `data/dataset/Land cover of Nepal {year}/data/lc{year}.tif`.

### COG preparation (`backend/scripts/prepare_dataset.py`)
Converts raw TIFFs to Cloud-Optimised GeoTIFFs using `gdal_translate` + `gdaladdo`. Output: `data/landcover/landcover-v3.1/{year}.tif`. COGs allow windowed reads — only the pixels covering a municipality's bounding box are loaded into memory, not the full national raster (~100–300 MB each).

### Dataset registration (`backend/scripts/ingest_rasters.py` / `make ingest`)
Registers each COG version in the `datasets` table with SHA-256 checksum, year range, and source metadata. Also populates `class_histograms` with national pixel counts per class per year.

### Boundary import (`backend/scripts/import_boundaries.py` / `make import-boundaries`)
Reads `data/boundaries/nepal_local_units.gpkg` (GeoPackage with 753 features) using GeoPandas, upserts each unit into `municipalities`. The boundary version (e.g. `mof-2021`) is registered in `datasets`.

---

## 8. Land Cover Map Endpoint

**Route**: `GET|HEAD /municipalities/{municipality_id}/landcover/{year}.png`
**File**: `backend/api/routes/landcover_map.py`

### HEAD request
- Validates municipality exists in DB.
- Checks COG file exists at `{OBJECT_STORE_PATH}/landcover/{dataset_version}/{year}.tif`.
- Returns empty body with headers: `Content-Type: image/png`, `Cache-Control: public, max-age=3600`.
- **Why HEAD matters**: MapLibre GL JS v3 sends a HEAD preflight before `updateImage()`. If HEAD fails (was returning 405), MapLibre silently aborts the image swap. Only the initial year (loaded via `addSource` which goes straight to GET) ever rendered.

### GET request
Runs in a thread pool via `loop.run_in_executor` (rasterio is synchronous):
1. Fetch municipality geometry via sync PostgreSQL connection (builds a fresh psycopg2 engine in the worker thread).
2. Compute bounding box from geometry.
3. Open COG with rasterio. Reproject geometry to raster's native CRS.
4. `rasterio.mask()` with `all_touched=False, crop=True` — clips and crops to the bounding box.
5. Apply RGBA palette (11 classes, hardcoded colour table, nodata → transparent).
6. Build numpy RGBA array, convert to PIL Image, save as PNG bytes in a BytesIO buffer.
7. Return `Response(png_bytes, media_type="image/png")` with bbox in custom headers:
   - `X-Bbox-West, X-Bbox-South, X-Bbox-East, X-Bbox-North` — WGS84 coordinates the frontend uses to position the image layer precisely.

### RGBA Palette
```
0  → transparent (NoData)
1  → #4A90D9  (Water Body)
2  → #B0D6EB  (Snow/Glacier)
3  → #C4B28A  (Barren Land)
4  → #1A7A4A  (Forest)
5  → #90D44B  (Grassland)
6  → #A8C97F  (Shrubland)
7  → #F5D44E  (Cultivated)
8  → #D63B2F  (Settlement)
9  → #5DA06F  (Open Woodland)
10 → #8B7355  (Rocky/Bare)
11 → #B0B0B0  (Others)
```

---

## 9. Frontend Architecture

**Framework**: Next.js 14, App Router, TypeScript, Tailwind CSS v4.
**Map library**: MapLibre GL JS v3.6.2.
**Charts**: Recharts.
**Build**: `next build` → standalone Node server. Served from `infra-frontend` Docker image.

### Pages

#### `/` (`frontend/app/page.tsx`)
Homepage with national-level Nepal map. Shows the full country with all 753 municipality boundaries rendered as a MapLibre GeoJSON fill layer. Clicking a municipality navigates to `/municipality/{id}`.

Top-right: a stats dashboard widget showing aggregate KPIs (total municipalities, jobs run, most-analysed region). Below the map: a search box with province/type filtering.

#### `/municipality/[id]` (`frontend/app/municipality/[id]/page.tsx`)
Main analysis view. Layout: fixed header + two-column body (sidebar left, main right).

**Header**: back button → `/`, municipality name + province/type, QA badge (pass/warn/block), CSV download link.

**Sidebar** (`w-80`):
- Analysis stream (stage-by-stage progress)
- Year selector buttons (2000–2020)
- `StatisticsPanel` (current-year breakdown)
- `NetChangeTable` (net change with horizontal bar chart)
- Data quality warnings (amber cards, only if verdict = warn)
- `EvidencePanel` (transition evidence)
- `ReportDownload` (PDF + XLSX download buttons)

**Main area** — two tabs:
- **"Land Cover Map"** tab: `LandCoverMap` component fills the area (map + seek bar).
- **"Charts & Tables"** tab: KPI cards row, then `ComparisonBarChart` + `DeltaLineChart` side-by-side, then full-width `TrendChart`, then `ChangeChart`.

### Job submission flow
On mount of `/municipality/[id]`:
1. `api.municipalities.get(id)` — fetch municipality metadata.
2. `api.analysis.submit({municipality_id, years, requested_outputs, ...})` — POST `/analysis`.
   - If response `status === "complete"`: cache hit → set result directly, mark `cacheHitDone`.
   - If `status === "queued"`: store `jobId`, start SSE stream.
3. `useJobStream(jobId)` opens `EventSource` to `/jobs/{jobId}/stream`.
4. When stream closes (`isDone = true`) or after 90s timeout: `api.analysis.getJob(jobId)` polls once to get the full result.

---

## 10. Frontend Components

### `LandCoverMap` (`components/LandCoverMap.tsx`)
MapLibre GL JS map with CARTO Positron basemap. Shows the municipality's land cover PNG as a raster image layer, with the boundary outline on top.

**Initial load**: `addSource` (type: `image`) + `addLayer` (type: `raster`). Boundary outline added first so land cover inserts below it via `beforeId: "boundary-line"`.

**Year switching**: uses remove + re-add pattern (removes existing layer/source, re-adds with new URL). This bypasses MapLibre's HEAD preflight issue with `updateImage()`.

**Download**: `map.getCanvas().toBlob()` exports full rendered canvas (basemap + overlay + boundary) as PNG. Requires `preserveDrawingBuffer: true` on the Map constructor.

**North arrow**: static two-tone SVG (dark north half, grey south half) pinned top-left.

**Seek bar**: range input styled with linear-gradient fill. Play/pause button auto-advances through years at 1600ms/frame. Year tick buttons. Download button (circle icon) at the end of the row.

**Legend**: absolute-positioned bottom-right. Shows class colour swatches + name + share% if stats are loaded for the current year.

### `TrendChart` (`components/TrendChart.tsx`)
Recharts `LineChart`. One line per land cover class. Title: "Area covered by each land type, year by year". Biggest-changing line gets `strokeWidth 2.5`, others `1.5`. Custom tooltip shows km² and % of total, sorted by area. Subtitle annotates the biggest change class with green/red text.

### `ChangeChart` (`components/ChangeChart.tsx`)
Recharts stacked `AreaChart` from the `trend_series` in `ChangeMatrix`. Title: "Land cover composition over time". Shows proportional areas across all years.

### `ComparisonBarChart` (`components/ComparisonBarChart.tsx`)
Recharts grouped `BarChart`. Two bars per class: base year (muted, `hexToRgba(color, 0.45)`) and latest year (full colour). Custom tooltip shows both values and net delta in green/red. X-axis: class names rotated -35°. Y-axis in km² with `k` suffix for thousands.

### `DeltaLineChart` (`components/DeltaLineChart.tsx`)
Recharts `LineChart` where all lines start at 0 (base year) and show cumulative km² gain/loss. `ReferenceLine y={0}` with "no change" label. Filters classes with < 1 km² peak change. Biggest gainer/loser highlighted with `strokeWidth 2.5`.

### `StatisticsPanel` (`components/StatisticsPanel.tsx`)
Stacked colour bar (proportional, one segment per class). Below it: rows showing each class with inline proportion bar, area in km², and share%. Filters trivial classes (< 0.5% share).

### `NetChangeTable` (`components/NetChangeTable.tsx`)
Horizontal bar chart for gains (green, left-aligned) and losses (red, right-aligned). CAGR shown as compact secondary row per class.

### `EvidencePanel` (`components/EvidencePanel.tsx`)
Cards per evidence statement. Filters `[all transitions]` / `[spatial]` placeholder entries with `isPlaceholder()`. Strength labels in plain English. Shows missing-data notice (amber) when only spatial placeholders exist. Empty state shown if no real evidence.

### `ReportDownload` (`components/ReportDownload.tsx`)
Two download buttons (PDF, XLSX) that open the API URL directly as an `<a href>` download. Shows a warning if job is not yet complete.

### `AnalysisStream` (`components/AnalysisStream.tsx`)
Renders per-stage progress from the SSE stream. Each stage: icon (spinner/check/x), human-readable label from `STAGE_LABELS`, and animated progress indicator.

### `NepalMap` (`components/NepalMap.tsx`)
Home page MapLibre map. Loads all municipality GeoJSON from `/municipalities`, renders as a fill layer with hover highlighting. Click navigates to the municipality page.

---

## 11. Frontend State & Streaming

### API client (`frontend/lib/api.ts`)
Single `api` object with typed methods. Uses `fetch` with `Content-Type: application/json`. Base URL from `NEXT_PUBLIC_API_URL` env var (default: `http://localhost:8000`). Throws on non-2xx with `body.detail` as message.

Key methods:
- `api.municipalities.landcoverPngUrl(id, year)` — builds the PNG URL (not a fetch, just a string).
- `api.analysis.submit(envelope)` — POST `/analysis`.
- `api.analysis.getJob(jobId)` — GET `/jobs/{jobId}`.
- `api.analysis.reportPdfUrl(jobId)` — returns URL string (used in `<a href>`).

### SSE hook (`frontend/lib/sse.ts`)
`useJobStream(jobId)` opens an `EventSource` to `/jobs/{jobId}/stream`. Accumulates events into `stages: Record<string, StageEvent>`. Closes on terminal status or after 90s timeout. Falls back to `GET /jobs/{jobId}` polling after the stream closes.

### TypeScript types (`frontend/types/api.ts`)
All API response shapes are typed: `Municipality`, `JobEnvelope`, `SubmitResponse`, `JobResult`, `LandCoverStatistics`, `LandCoverClass`, `ChangeMatrix`, `Transition`, `NetChange`, `CAGREntry`, `TrendPoint`, `EvidenceStatement`, `ValidationVerdict`, `StageEvent`, `DashboardStats`.

### Constants (`frontend/lib/constants.ts`)
- `CLASS_COLOURS`: map of class code → hex colour string.
- `CLASS_NAMES`: map of class code → English name.
- `STAGE_LABELS`: map of Celery stage name → human-readable label.
- `DEFAULT_DATASET_VERSION = "landcover-v3.1"`.
- `DEFAULT_BOUNDARY_VERSION = "mof-2021"`.
- `ANALYSIS_YEARS = [2000, 2005, 2010, 2015, 2020]`.

---

## 12. Non-Negotiable Constraints

These rules are enforced in code and must never be changed:

| Constraint | Where enforced |
|-----------|---------------|
| `FORECAST_ENABLED=false` always | `backend/config.py` default; docker-compose hardcodes `"false"` |
| Provenance records are append-only | PostgreSQL RULE prevents UPDATE/DELETE on `provenance_records` |
| LLM never receives raw rasters or unvalidated data | `narrative/agent.py` sends only pre-aggregated JSON stats |
| All area computation uses EPSG:32645 | `raster/agent.py` comment header; `validation/agent.py` `crs_assertion` gate blocks non-32645 results |
| `all_touched=False` on all `rasterio.mask` calls | Enforced in `raster/agent.py` and `change/agent.py` and `landcover_map.py` |
| Datasets are immutable once registered | `datasets.version` has UNIQUE constraint; application code always inserts new version |
| Git author always `Idiocter <bipulregmi2018@gmail.com>` | Global git config — never override locally or add co-authors |
| Numeric guard on LLM output | `narrative/agent.py` `_numeric_guard()` — rogue numbers → discard and fall back to template |
