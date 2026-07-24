"""Change Detection Agent — Celery task."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.agents.change.agent import ChangeDetectionAgent
from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.change.tasks.run_change_detection",
    queue="gis",
    soft_time_limit=120,
    time_limit=150,
)
def run_change_detection(self, job_id: str, envelope: dict) -> dict:
    """Build transition matrix, net-change table, trend series, CAGR, and breakpoints."""
    logger.info("Change detection started for job %s", job_id)

    with get_sync_db() as db:
        agent = ChangeDetectionAgent(db)
        matrix = agent.detect(job_id, envelope)

    return {
        "status": "ok",
        "from_year": matrix.from_year,
        "to_year": matrix.to_year,
        "transition_count": len(matrix.transitions),
        "breakpoint_count": len(matrix.breakpoints),
        "change_matrix": [matrix.model_dump(mode="json")],
    }
