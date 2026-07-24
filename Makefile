.PHONY: up down logs shell-backend shell-db \
        migrate test test-fast lint typecheck \
        import-boundaries ingest prepare-dataset \
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

# Convert raw ICIMOD TIFs to pipeline COGs (run once before make ingest)
prepare-dataset:
	python -m backend.scripts.prepare_dataset

import-boundaries:
	cd backend && python -m backend.scripts.import_boundaries \
		--file ../data/boundaries/nepal.gpkg

# Usage: make ingest VERSION=landcover-v3.1 SOURCE_DIR=../data/landcover/landcover-v3.1
VERSION    ?= landcover-v3.1
SOURCE_DIR ?= ../data/landcover/landcover-v3.1

ingest:
	cd backend && python -m backend.scripts.ingest_rasters \
		--source-dir $(SOURCE_DIR) \
		--version $(VERSION)
