.PHONY: up down logs shell-backend shell-db \
        migrate test test-fast lint typecheck \
        fetch-boundaries import-boundaries ingest prepare-dataset \
        check-docker

# Detect which compose command is available:
#   docker compose   — Compose V2 plugin (Docker Desktop, docker-ce)
#   docker-compose   — Compose V1 standalone binary
COMPOSE := $(shell docker compose version > /dev/null 2>&1 \
               && echo "docker compose" \
               || echo "docker-compose")

# ── Pre-flight ────────────────────────────────────────────────────────────────

check-docker:
	@docker info > /dev/null 2>&1 || ( \
	  echo ""; \
	  echo "  Docker daemon is not running."; \
	  echo ""; \
	  echo "  macOS options:"; \
	  echo "    A) Docker Desktop  →  brew install --cask docker  (then open Docker.app)"; \
	  echo "    B) Colima (no GUI) →  brew install colima docker-compose && colima start"; \
	  echo ""; \
	  exit 1 )

# ── Docker Compose ────────────────────────────────────────────────────────────

up: check-docker
	cd infra && $(COMPOSE) up -d

down: check-docker
	cd infra && $(COMPOSE) down

logs: check-docker
	cd infra && $(COMPOSE) logs -f backend worker

shell-backend: check-docker
	cd infra && $(COMPOSE) exec backend bash

shell-db: check-docker
	cd infra && $(COMPOSE) exec db psql -U nglip nglip

# ── Database ──────────────────────────────────────────────────────────────────
# Runs inside the backend container (alembic is not installed on the host).
# Requires: make up to be running first.

migrate: check-docker
	cd infra && $(COMPOSE) exec backend alembic upgrade head

# ── Tests ─────────────────────────────────────────────────────────────────────
# Tests run locally — no Docker needed (all tests use synthetic data).
# Activate your venv first: source .venv/bin/activate

test:
	cd backend && python -m pytest tests/ -v

test-fast:
	cd backend && python -m pytest tests/ -v -m "not slow"

# ── Code quality ──────────────────────────────────────────────────────────────

lint:
	cd backend && python -m ruff check .

typecheck:
	cd backend && python -m mypy .

# ── Data ops ──────────────────────────────────────────────────────────────────

# Preprocess raw ICIMOD TIFs → pipeline COGs.
# Runs locally (reads/writes data/ which is on the host).
# Requires rasterio: pip install rasterio pyproj  (already in .venv)
prepare-dataset:
	python -m backend.scripts.prepare_dataset

# Import and ingest run inside the backend container where PostGIS is reachable.
# Requires: make up to be running first.

# Download Nepal local-unit boundaries from OCHA COD (one-time, runs locally).
# Requires: pip install geopandas pyogrio requests  (or: source .venv/bin/activate)
fetch-boundaries:
	python -m backend.scripts.download_boundaries

import-boundaries: check-docker
	cd infra && $(COMPOSE) exec backend \
		python -m backend.scripts.import_boundaries \
		--file /data/boundaries/nepal_local_units.gpkg

# Usage: make ingest VERSION=landcover-v3.1
VERSION ?= landcover-v3.1

ingest: check-docker
	cd infra && $(COMPOSE) exec backend \
		python -m backend.scripts.ingest_rasters \
		--source-dir /data/landcover/$(VERSION) \
		--version $(VERSION)
