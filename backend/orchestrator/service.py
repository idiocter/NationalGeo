"""Orchestrator service helpers — SSE pub/sub and job finalisation."""

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


def finalise_job(job_id: str, status: str, cache_key: str | None = None) -> None:
    """Set the job's terminal status, completed_at, and optionally populate result_cache.

    Called by the orchestrator task after all stages have run.
    Uses the sync DB so it can run inside a Celery task.
    """
    from sqlalchemy import text
    from backend.database_sync import get_sync_db

    with get_sync_db() as db:
        db.execute(
            text(
                """
                UPDATE jobs
                SET status = :status, completed_at = NOW()
                WHERE id = :job_id
                """
            ),
            {"status": status, "job_id": job_id},
        )

        if cache_key and status == "complete":
            row = db.execute(
                text("SELECT result FROM jobs WHERE id = :id"),
                {"id": job_id},
            ).first()
            if row and row.result:
                db.execute(
                    text(
                        """
                        INSERT INTO result_cache (cache_key, job_id, result)
                        VALUES (:key, :job_id, CAST(:result AS jsonb))
                        ON CONFLICT (cache_key) DO NOTHING
                        """
                    ),
                    {
                        "key": cache_key,
                        "job_id": job_id,
                        "result": json.dumps(row.result),
                    },
                )

        db.commit()


def build_phase2_dag(job_id: str, envelope: dict) -> list[dict]:
    """Phase 2 sequential DAG: Ingestion → Raster → Change → Validation."""
    return [
        {"agent": "ingestion", "task": "backend.agents.ingestion.tasks.run_ingestion_check"},
        {"agent": "raster_analysis", "task": "backend.agents.raster.tasks.run_raster_analysis"},
        {"agent": "change_detection", "task": "backend.agents.change.tasks.run_change_detection"},
        {"agent": "validation", "task": "backend.agents.validation.tasks.run_validation"},
    ]
