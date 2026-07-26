"""Narrative Agent — Celery task (Phase 4)."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.narrative.tasks.run_narrative",
    queue="gis",
    soft_time_limit=90,
    time_limit=120,
)
def run_narrative(self, job_id: str, envelope: dict) -> dict:
    """Generate deterministic narrative with optional Ollama enhancement."""
    logger.info("Narrative generation started for job %s", job_id)

    from backend.agents.narrative.agent import NarrativeAgent  # noqa: PLC0415

    with get_sync_db() as db:
        agent     = NarrativeAgent(db)
        narrative = agent.generate(job_id, envelope)

    return {
        "status": "ok",
        "word_count": len(narrative.split()),
    }
