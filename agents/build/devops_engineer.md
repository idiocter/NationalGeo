# Build Agent — devops-engineer

**Active phases:** 1, 5
**Module boundary:** `infra/`, root config files

---

## Role

Own the deployment environment, data storage, monitoring, and backup/restore. Every other build agent assumes the infrastructure works — this agent is responsible for that assumption being true.

---

## Owns

- Docker Compose: dev environment (PostGIS, Redis, backend, frontend, Ollama)
- Production config: environment-specific overrides, secrets management
- Object storage: GeoTIFF COG store, report artefact store, tile cache
- Database migrations: Alembic integration in CI/CD
- Monitoring: Celery task failure rates, p95 latency per API endpoint, disk usage (rasters grow)
- Alerting: job failure rate > 5% in a 15-min window → alert; p95 `/analysis` > 5 s → alert
- Backup: nightly PostGIS dump + object storage snapshot; restore tested monthly
- CI/CD: GitHub Actions pipeline — lint, test, build, migrate, deploy

---

## Definition of done

- One-command dev environment: `docker compose up --build` starts everything, including sample data
- One-command production deploy: `./infra/deploy.sh` applies migrations and restarts services
- Restore from backup tested and documented (time to restore < 30 min)
- Celery task failure rate alert fires within 60 s of a simulated failure in staging
- p95 latency dashboard shows per-stage breakdown (not just total job time)
- `docker compose down -v && docker compose up --build` passes all golden-file tests

---

## Constraints

- Does not write application code — only infrastructure, config, and CI files
- All secrets must be injected via environment variables — no secrets in Docker images or git
- Production database backups must be encrypted at rest
- Object storage paths must be deterministic: `{prefix}/{version}/{filename}` — no UUID-only paths

---

## Docker Compose structure (Phase 1)

```yaml
# infra/docker-compose.yml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: nglip
      POSTGRES_USER: nglip
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/sql/init.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 2gb --maxmemory-policy allkeys-lru

  backend:
    build: ./backend
    depends_on: [db, redis]
    environment:
      DATABASE_URL: postgresql://nglip:${POSTGRES_PASSWORD}@db:5432/nglip
      REDIS_URL: redis://redis:6379/0
      OBJECT_STORE_PATH: /data
    volumes:
      - ./data:/data

  worker:
    build: ./backend
    command: celery -A backend.celery worker --loglevel=info
    depends_on: [db, redis]

  frontend:
    build: ./frontend
    depends_on: [backend]
    ports:
      - "3000:3000"

  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
    profiles: ["narrative"]  # Only started when narrative generation is needed

volumes:
  pgdata:
  ollama_data:
```

---

## Monitoring stack (Phase 5)

- **Celery:** Flower for task monitoring (`/flower` internal)
- **Application metrics:** Prometheus client in FastAPI; expose `/metrics`
- **Dashboards:** Grafana with pre-built dashboards for job success rate, stage latency, disk usage
- **Alerting:** Alertmanager → email/Slack on job failure rate and latency SLA breach

---

## Backup strategy

```bash
# infra/backup.sh
pg_dump $DATABASE_URL | gzip | gpg --encrypt --recipient $BACKUP_GPG_KEY > backup_$(date +%Y%m%d).sql.gz.gpg
# Upload to object storage backup prefix
# Retain 30 daily + 12 monthly
```

Restore test checklist (run monthly):
1. Restore PostGIS dump to staging DB
2. Run `pytest tests/golden/` against restored data
3. Assert golden-file tests pass within 0.5% tolerance
4. Document time-to-restore in `infra/restore_log.md`

---

## CI/CD pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    steps:
      - run: docker compose -f infra/docker-compose.test.yml up --build -d
      - run: pytest tests/ -v
      - run: pytest tests/golden/ -v  # requires test raster data in CI cache

  lint:
    steps:
      - run: ruff check backend/
      - run: mypy backend/
      - run: npx eslint frontend/

  deploy:
    needs: [test, lint]
    if: github.ref == 'refs/heads/main'
    steps:
      - run: ./infra/deploy.sh
```
