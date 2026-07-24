.PHONY: up down logs shell-backend shell-db \
        migrate test test-fast lint typecheck \
        import-boundaries ingest

# ── Docker Compose ────────────────────────────────────────────────────────────

up:
	cd infra && docker compose up -d

down:
	cd infra && docker compose down

logs:
	cd infra && docker compose logs -f backend worker

shell-backend:
	cd infra && docker compose exec backend bash

shell-db:
	cd infra && docker compose exec db psql -U nglip nglip

# ── Database ──────────────────────────────────────────────────────────────────

migrate:
	cd backend && alembic upgrade head

# ── Tests ─────────────────────────────────────────────────────────────────────

test:
	cd backend && python -m pytest tests/ -v

test-fast:
	cd backend && python -m pytest tests/ -v -m "not slow"

# ── Code quality ──────────────────────────────────────────────────────────────

lint:
	cd backend && ruff check .

typecheck:
	cd backend && mypy .

# ── Data ops ──────────────────────────────────────────────────────────────────

import-boundaries:
	cd backend && python -m backend.scripts.import_boundaries \
		--file ../data/boundaries/nepal.gpkg

# Usage: make ingest VERSION=landcover-v3.1 SOURCE_DIR=../data/rasters
VERSION    ?= landcover-v3.1
SOURCE_DIR ?= ../data/rasters

ingest:
	cd backend && python -m backend.scripts.ingest_rasters \
		--source-dir $(SOURCE_DIR) \
		--version $(VERSION)
