# NGLIP — Nepal GeoAI Land Intelligence Platform

## Project summary

Turn 23 years of national land-cover rasters (2000–2022) into one-click, auditable land-intelligence for every municipality in Nepal. The full specification lives in `plan.md`.

## Core principle

**Deterministic core, generative edge.** The GIS engine computes; the LLM only explains. Zero numeric values may originate from a language model.

## Repository layout

```
agents/runtime/      11 runtime agent specs (the product)
agents/build/        6 build agent specs (development agents)
backend/
  api/main.py        FastAPI gateway — routing and SSE only, no GIS logic here
  agents/            Runtime agent implementations (one dir per agent)
  contracts/         Canonical Pydantic models + shared geo utilities
  tests/golden/      QGIS-verified reference outputs for 5 test municipalities
infra/
  docker-compose.yml dev environment (start with: docker compose up --build)
  sql/init.sql       PostGIS schema
data/
  rasters/           COG GeoTIFFs by version (large, not in git)
  boundaries/        Nepal municipal boundaries
  supporting/        Roads, DEM, rivers, population grids
```

## Non-negotiable rules

1. **Area in degrees is wrong.** All area computation must use `contracts.geo_utils.compute_pixel_area_m2`, which asserts the CRS is projected. Never bypass this.
2. **`all_touched=False`** is mandatory on all `rasterio.mask` calls. Default must never be changed silently.
3. **Datasets are immutable once registered.** Corrections create a new version in the `datasets` table — never overwrite.
4. **Provenance records are append-only.** No UPDATE or DELETE on `provenance_records`. The DB rule enforces this.
5. **The LLM (Narrative Agent) receives only validated JSON.** Never pass raw rasters, unvalidated data, or partial results to Ollama.
6. **Forbidden causal language** in Evidence Agent output: `caused`, `because`, `due to`. Use: `associated with`, `concentrated near`, `co-occurs with`.
7. **FORECAST_ENABLED=false** until a passing backtest is documented in `backend/tests/golden/forecast_backtest.json`.

## Running the dev environment

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD
docker compose -f infra/docker-compose.yml up --build
# Backend: http://localhost:8000
# Frontend: http://localhost:3000
# API docs: http://localhost:8000/docs
```

## Running tests

```bash
cd backend
pytest tests/ -v                  # unit tests
pytest tests/golden/ -v           # golden-file tests (requires test raster data)
```

## Phase status

| Phase | Status |
|---|---|
| 1 — Foundation | Not started |
| 2 — GIS Core | Not started |
| 3 — Intelligence | Not started |
| 4 — Reporting | Not started |
| 5 — Platform | Not started |
| 6 — Forecasting | Not started |

## Key contacts / references

- Full plan: `plan.md`
- Runtime agent specs: `agents/runtime/`
- Build agent specs: `agents/build/`
- Data contracts: `backend/contracts/models.py`
