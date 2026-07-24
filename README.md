# NGLIP — Nepal GeoAI Land Intelligence Platform

NGLIP analyses land-cover change across Nepal's 753 municipalities using deterministic GIS methods. It reads five ICIMOD land-cover rasters (2000, 2005, 2010, 2015, 2020), computes per-municipality statistics, detects change, validates data quality, and presents the results through a Next.js map interface with downloadable CSV reports.

LLM integration is deliberately kept out of the data pipeline. All numbers come from the GIS core; the Narrative Agent only receives validated summaries.

---

## Architecture

```
Browser (Next.js)
    │  REST + SSE
FastAPI  ──────►  Celery workers (via Redis)
    │                   │
    ▼                   ▼
PostGIS          COG rasters on disk
```

| Service | Technology | Port |
|---------|-----------|------|
| Frontend | Next.js 16 | 3000 |
| API | FastAPI + Uvicorn | 8000 |
| Workers | Celery 5 | — |
| Queue / pub-sub | Redis 7 | 6379 |
| Database | PostgreSQL 16 + PostGIS 3.4 | 5432 |
| Narrative (optional) | Ollama | 11434 |

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Docker + Compose | 24+ / V2 | see below |
| Python | 3.12 | for dataset preprocessing and local dev |
| Node.js | 22 | for local frontend dev only |

### Installing Docker on macOS

`brew install docker` installs only the Docker CLI client — it does **not** include the daemon or Compose plugin. You need one of:

**Option A — Docker Desktop (recommended, all-in-one):**
```bash
brew install --cask docker
# Open Docker.app from /Applications and wait for the whale icon to stop animating
```

**Option B — Colima (lightweight, no GUI):**
```bash
brew install colima docker-compose
colima start --cpu 4 --memory 8    # adjust to your machine
# colima start persists across reboots via a launchd service
```

After either option, verify with:
```bash
docker info          # should show server details, not an error
docker compose version   # or: docker-compose version
```

---

## Quick Start (Docker)

```bash
# 1. Clone
git clone https://github.com/idiocter/NationalGeo.git
cd NationalGeo

# 2. Environment
cp .env.example .env
# Edit .env — change POSTGRES_PASSWORD and JWT_SECRET at minimum

# 3. Prepare the dataset COGs (one-time, outside Docker)
python -m venv .venv && source .venv/bin/activate
pip install rasterio pyproj
python -m backend.scripts.prepare_dataset

# 4. Start services
make up

# 5. Apply the database schema
make migrate

# 6. Import boundaries and register the dataset
make import-boundaries     # requires data/boundaries/nepal.gpkg
make ingest                # registers landcover-v3.1 COGs in the DB

# 7. Open the app
open http://localhost:3000
```

---

## Step-by-Step Setup

### 1. Environment file

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
POSTGRES_PASSWORD=your_secure_password   # required
JWT_SECRET=your_secure_secret            # required

REDIS_URL=redis://localhost:6379/0       # default
OBJECT_STORE_PATH=/data                  # maps to ./data inside containers
FORECAST_ENABLED=false                   # keep false — Phase 5 not built
```

### 2. Dataset preparation

The raw ICIMOD TIF files live in `data/dataset/`. They are in EPSG:4326 (geographic) and must be reprojected to EPSG:32645 (UTM Zone 45N) and converted to Cloud-Optimised GeoTIFF before the pipeline can use them.

```bash
# Install rasterio in any Python 3.12 environment
pip install rasterio pyproj

# Run from the repo root — outputs to data/landcover/landcover-v3.1/
python -m backend.scripts.prepare_dataset

# Process specific years only
python -m backend.scripts.prepare_dataset --years 2000 2005 2010 2015 2020
```

This takes around 3 minutes and produces five `~30 MB` COG files. The script is safe to re-run; existing files are skipped.

**Raw dataset layout expected:**
```
data/dataset/
  Copy of Land cover of Nepal 2000/data/lc2000.tif
  Land cover of Nepal 2005/data/lc2005.tif
  Land cover of Nepal 2010/data/lc2010.tif
  Land cover of Nepal 2015/data/lc2015.tif
  Land cover of Nepal 2020/data/lc2020.tif
```

### 3. Start services

```bash
make up       # starts db, redis, backend, worker, frontend
make logs     # tail backend + worker logs
make down     # stop everything
```

The `ollama` service (Narrative Agent) is in the `narrative` profile and not started by default:

```bash
cd infra && docker compose --profile narrative up -d
```

### 4. Database schema

The PostGIS schema is applied automatically from `infra/sql/init.sql` the first time the `db` container starts. If you need to reset or apply Alembic migrations:

```bash
make migrate    # runs: alembic upgrade head
```

To open a database shell:

```bash
make shell-db   # psql as the nglip user
```

### 5. Import boundaries

You need the Nepal local-units GeoPackage (753 municipalities):

```bash
make import-boundaries
# equivalent to:
# python -m backend.scripts.import_boundaries --file data/boundaries/nepal.gpkg
```

The boundary file should contain columns `id`, `NAME_EN`, `NAME_NP`, `PROVINCE`, `DISTRICT`, `TYPE`, `AREA_KM2`, `POPULATION`, and a polygon geometry in EPSG:4326. See `backend/scripts/import_boundaries.py` for exact column names.

### 6. Register the dataset

```bash
make ingest
# equivalent to:
# python -m backend.scripts.ingest_rasters \
#     --source-dir data/landcover/landcover-v3.1 \
#     --version landcover-v3.1

# Custom version or directory:
make ingest VERSION=landcover-v3.1 SOURCE_DIR=../data/landcover/landcover-v3.1
```

---

## Local Development (without Docker)

### Backend

```bash
# Dependencies
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Requires a running PostgreSQL+PostGIS and Redis (can use the Docker services)
make up   # start only db and redis
make down

# Set env vars (or use a .env file read by pydantic-settings)
export DATABASE_URL="postgresql+asyncpg://nglip:dev_password_change_in_prod@localhost:5432/nglip"
export REDIS_URL="redis://localhost:6379/0"
export OBJECT_STORE_PATH="$(pwd)/../data"

# API server
uvicorn backend.api.main:app --reload --port 8000

# Celery worker (separate terminal)
celery -A backend.celery_app worker --loglevel=info --concurrency=4
```

### Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
# open http://localhost:3000
```

---

## Running Tests

Tests use synthetic rasters only — no real data files required.

```bash
# Fast suite (excludes slow integration tests)
make test-fast
# equivalent: cd backend && python -m pytest tests/ -v -m "not slow"

# Full suite
make test

# Single file
cd backend && python -m pytest tests/test_raster_analysis.py -v
```

85 tests, all passing. No database or Redis needed for the test suite.

---

## Make Reference

| Command | What it does |
|---------|-------------|
| `make up` | Start all Docker services in background |
| `make down` | Stop and remove containers |
| `make logs` | Tail backend and worker logs |
| `make shell-backend` | Open bash inside the backend container |
| `make shell-db` | Open psql inside the db container |
| `make migrate` | Apply Alembic migrations |
| `make test` | Run full test suite |
| `make test-fast` | Run tests excluding slow markers |
| `make lint` | Run ruff linter |
| `make typecheck` | Run mypy type checker |
| `make prepare-dataset` | Convert raw ICIMOD TIFs → pipeline COGs |
| `make import-boundaries` | Import nepal.gpkg into PostGIS |
| `make ingest` | Register COG rasters in the DB |

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/municipalities` | List all 753 municipalities |
| `GET` | `/municipalities/{id}` | Single municipality with geometry |
| `POST` | `/analysis` | Submit an analysis job (returns `job_id`) |
| `GET` | `/jobs/{job_id}` | Job status and result bundle |
| `GET` | `/jobs/{job_id}/stream` | SSE stream of per-stage progress |
| `GET` | `/jobs/{job_id}/report.csv` | Download results as CSV |
| `GET` | `/provenance/jobs/{job_id}/manifest` | Full provenance manifest |

**Submit an analysis job:**

```bash
curl -X POST http://localhost:8000/analysis \
  -H "Content-Type: application/json" \
  -d '{
    "municipality_id": "np-bag-ktm-01",
    "years": [2000, 2005, 2010, 2015, 2020],
    "requested_outputs": ["stats", "change"],
    "dataset_version": "landcover-v3.1",
    "boundary_version": "mof-2021"
  }'
```

---

## Land Cover Classes

The dataset uses the ICIMOD 11-class Nepal land-cover system:

| Code | Class | Colour |
|------|-------|--------|
| 1 | Water Body | `#4a90d9` |
| 2 | Cultivated Land | `#f5d44e` |
| 3 | Shrubland | `#a8c97f` |
| 4 | Forest | `#1a7a4a` |
| 5 | Grassland | `#90d44b` |
| 6 | Barren Land | `#c4b28a` |
| 7 | Snow/Ice/Glacier | `#e8f4f8` |
| 8 | Settlement | `#d63b2f` |
| 9 | Open Woodland | `#5da06f` |
| 10 | Rocky/Bare Ground | `#8b7355` |
| 11 | Others | `#b0b0b0` |

Class names are inferred from ICIMOD documentation. Verify against the dataset PDF for authoritative definitions.

**Projection:** EPSG:32645 (UTM Zone 45N). Area distortion across Nepal is < 0.04% — acceptable for land-cover analysis at this scale.

---

## Data Pipeline

Each analysis job runs four stages in sequence:

```
ingestion_check (30 s) → raster_analysis (up to 5 min)
    → change_detection (2.5 min) → validation (30 s)
```

Progress is streamed to the browser via SSE. Results are cached by content hash (municipality + years + dataset version); repeated requests return instantly.

**Validation gates** (hard block):
- Class share percentages must sum to 100% ± 1%
- Nodata coverage ≥ 20% → year is unusable
- CRS must be EPSG:32645 (geographic data is rejected)
- Annualised area change rate ≥ 50%/yr per class

**Provenance:** every agent write is recorded in `provenance_records`, which is append-only enforced at the database level.

---

## Project Layout

```
.
├── backend/
│   ├── agents/          # One directory per pipeline agent
│   │   ├── ingestion/
│   │   ├── raster/      # Per-year land-cover statistics
│   │   ├── change/      # Transition matrix, CAGR, breakpoints
│   │   └── validation/  # QA gates
│   ├── api/             # FastAPI routes
│   ├── contracts/       # Shared Pydantic models (agent boundary)
│   ├── migrations/      # Alembic
│   ├── orchestrator/    # Celery task graph
│   ├── scripts/         # One-off data ops (prepare, ingest, import)
│   └── tests/
├── frontend/
│   ├── app/             # Next.js App Router pages
│   ├── components/      # UI components
│   ├── lib/             # API client, SSE hook, constants
│   └── types/           # TypeScript API types
├── data/
│   ├── dataset/         # Raw ICIMOD TIFs (gitignored, not committed)
│   ├── landcover/       # Processed COGs (gitignored, generated locally)
│   └── boundaries/      # Nepal municipality GeoPackage (gitignored)
├── infra/
│   ├── docker-compose.yml
│   └── sql/init.sql     # PostGIS schema
└── Makefile
```

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Core infrastructure (DB, API, Celery, COG pipeline) | Complete |
| 2 | Raster Analysis, Change Detection, Validation agents | Complete |
| 3 | ICIMOD dataset integration, TrendChart, CSV reports | Complete |
| 4 | Report Agent (PDF/DOCX/XLSX output) | Planned |
| 5 | Narrative Agent (LLM summaries via Ollama) | Planned |
| 6 | Forecast Agent | Planned (`FORECAST_ENABLED=false`) |
