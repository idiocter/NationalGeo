"""Orchestrator: converts a job envelope into an ordered, resumable agent DAG."""

from __future__ import annotations

import json
from uuid import UUID

import redis

from backend.config import get_settings

settings = get_settings()


def publish_stage_event(job_id: str, stage: str, status: str, pct: int = 0) -> None:
    """Publish an SSE-compatible event to the Redis pub/sub channel for this job."""
    r = redis.from_url(settings.redis_url, decode_responses=True)
    event = json.dumps({"job_id": job_id, "stage": stage, "status": status, "pct": pct})
    r.publish(f"nglip:job:{job_id}", event)
    r.close()


def build_phase2_dag(job_id: str, envelope: dict) -> list[dict]:
    """Phase 2 sequential DAG: Ingestion → Raster → Change → Validation."""
    return [
        {"agent": "ingestion", "task": "backend.agents.ingestion.tasks.run_ingestion_check"},
        {"agent": "raster_analysis", "task": "backend.agents.raster.tasks.run_raster_analysis"},
        {"agent": "change_detection", "task": "backend.agents.change.tasks.run_change_detection"},
        {"agent": "validation", "task": "backend.agents.validation.tasks.run_validation"},
    ]
