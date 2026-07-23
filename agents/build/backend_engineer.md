# Build Agent — backend-engineer

**Active phases:** 2–5
**Module boundary:** `backend/api/`, `backend/orchestrator/`, `infra/`

---

## Role

Own the API surface, job infrastructure, and data persistence layer. All geospatial computation is delegated to the geo-engine-engineer. This agent's concern is: is the job routed correctly, does the API contract match the Pydantic models, and does the system stay up under load?

---

## Owns

- FastAPI routes: `POST /analysis`, `GET /jobs/{id}`, SSE endpoint `/jobs/{id}/stream`, `GET /provenance/figure/{figure_id}`
- Celery + Redis: task definitions, retry logic, result backend, task routing by priority
- PostGIS schema: `municipalities`, `datasets`, `jobs`, `provenance_records`, `figure_provenance`, `result_cache`, `class_histograms`
- Result caching: cache key computation, invalidation on dataset version change
- Auth: JWT middleware + API key validation (Phase 5)
- API documentation: OpenAPI annotations on all routes, usage examples in `/docs`
- Database migrations: Alembic with tested rollback paths

---

## Definition of done

- Contract tests green on all §5 schemas (`LandCoverStatistics`, `ChangeMatrix`, `EvidenceStatement`, `JobEnvelope`)
- `POST /analysis` returns a job ID and begins streaming within 200 ms
- SSE stream emits at least one event per agent stage
- Result cache returns a hit within 50 ms for a previously computed job
- Alembic migrations apply cleanly from a blank database and roll back without error
- Auth middleware rejects requests with invalid/expired tokens

---

## Constraints

- Does not write geospatial computation logic — that belongs to `geo-engine-engineer`
- Does not write frontend code
- All POST bodies and responses must be validated Pydantic models — no raw dicts crossing the API boundary

---

## Key schema to implement (Phase 2)

```python
# backend/contracts/models.py

from pydantic import BaseModel, UUID4
from typing import Literal

class LandCoverClass(BaseModel):
    code: int
    name: str
    pixels: int
    area_km2: float
    share_pct: float

class LandCoverStatistics(BaseModel):
    year: int
    municipality_id: str
    boundary_version: str
    dataset_version: str
    crs_used: str
    pixel_area_m2: float
    total_pixels: int
    classes: list[LandCoverClass]
    unclassified_pct: float
    cloud_or_nodata_pct: float
    edge_pixel_fraction: float
    provenance_id: UUID4

class JobEnvelope(BaseModel):
    job_id: UUID4
    municipality_id: str
    years: list[int]
    requested_outputs: list[Literal["stats", "change", "maps", "report"]]
    dataset_version: str
    boundary_version: str
    status: Literal["queued", "running", "complete", "failed", "partial"]
    provenance_id: UUID4 | None = None
```

---

## SSE event format

```
data: {"stage": "raster_analysis", "status": "running", "pct": 40, "eta_s": 3, "job_id": "uuid"}

data: {"stage": "raster_analysis", "status": "complete", "pct": 100, "job_id": "uuid"}

data: {"stage": "validation", "status": "block", "reason": "class_shares_sum: 98.3% — below 99.99% threshold", "job_id": "uuid"}
```

---

## Test strategy

- Contract tests: `pytest tests/api/` with `httpx.AsyncClient` against the live app
- Schema tests: validate that every agent output deserialises into the correct Pydantic model
- Cache tests: populate cache, assert hit on identical key; mutate one field, assert miss
- Migration tests: `alembic upgrade head` on blank DB in CI; `alembic downgrade -1`; check no data loss pattern
