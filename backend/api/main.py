"""NGLIP FastAPI gateway.

All geospatial computation happens in Celery workers (backend/agents/).
This module is routing and streaming only — no GIS logic here.
"""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.contracts.models import JobEnvelope, JobStatus

app = FastAPI(
    title="NGLIP API",
    description="Nepal GeoAI Land Intelligence Platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Analysis endpoint
# ---------------------------------------------------------------------------

@app.post("/analysis", response_model=dict, status_code=202)
async def submit_analysis(envelope: JobEnvelope) -> dict:
    """Submit a land-cover analysis job.

    Returns immediately with a job_id. Stream progress at GET /jobs/{job_id}/stream.
    """
    job_id = str(uuid4())
    # TODO Phase 2: dispatch to Celery orchestrator
    return {"job_id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    """Return current job status and result bundle if complete."""
    # TODO Phase 2: query job state from PostGIS/Redis
    raise HTTPException(status_code=404, detail="Job not found")


@app.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str) -> StreamingResponse:
    """Server-Sent Events stream for live job progress.

    Each event: {"stage": str, "status": str, "pct": int, "eta_s": int}
    """
    async def event_generator():
        # TODO Phase 2: subscribe to Redis pub/sub channel for this job_id
        # Placeholder: emit a single queued event then close
        yield f"data: {json.dumps({'stage': 'orchestrator', 'status': 'queued', 'pct': 0, 'job_id': job_id})}\n\n"
        await asyncio.sleep(0)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Provenance / evidence panel
# ---------------------------------------------------------------------------

@app.get("/provenance/figure/{figure_id}")
async def get_figure_provenance(figure_id: str) -> dict:
    """Return the full provenance chain for a figure visible in the UI."""
    # TODO Phase 4: query provenance_records and figure_provenance tables
    raise HTTPException(status_code=404, detail="Figure not found")


@app.get("/provenance/jobs/{job_id}/manifest")
async def get_job_manifest(job_id: str) -> dict:
    """Return the reproducibility manifest for a completed job."""
    # TODO Phase 4: build manifest from provenance_records
    raise HTTPException(status_code=404, detail="Job not found")


# ---------------------------------------------------------------------------
# Municipality metadata
# ---------------------------------------------------------------------------

@app.get("/municipalities")
async def list_municipalities() -> list[dict]:
    """Return all 753 Nepal local units with id, name, province, and bbox."""
    # TODO Phase 1: query PostGIS municipalities table
    return []


@app.get("/municipalities/{municipality_id}")
async def get_municipality(municipality_id: str) -> dict:
    """Return metadata and GeoJSON boundary for a single municipality."""
    # TODO Phase 1: query PostGIS municipalities table
    raise HTTPException(status_code=404, detail="Municipality not found")
