"""Validation Agent — Celery task."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.agents.validation.agent import ValidationAgent
from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.validation.tasks.run_validation",
    queue="gis",
)
def run_validation(self, job_id: str, envelope: dict) -> dict:
    """Run all QA gates. Blocks on: share sum, nodata threshold, CRS, plausibility."""
    logger.info("Validation started for job %s", job_id)

    with get_sync_db() as db:
        agent = ValidationAgent(db)
        verdict = agent.validate(job_id, envelope)

    blocked = [c.model_dump() for c in verdict.checks if c.status == "block"]
    return {
        "status": "ok",
        "verdict": verdict.verdict,
        "block_count": len(blocked),
        "warn_count": len([c for c in verdict.checks if c.status == "warn"]),
        "verdict_summary": {
            "verdict": verdict.verdict,
            "checks": [c.model_dump() for c in verdict.checks],
        },
    }
