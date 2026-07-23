"""Change Detection Agent — Celery task stub (Phase 2 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.change.tasks.run_change_detection", queue="gis")
def run_change_detection(self, job_id: str, envelope: dict) -> dict:
    """Build transition matrix, net-change table, trend series."""
    logger.info("Change detection started for job %s", job_id)
    # TODO Phase 2: implement transition matrix using numpy vectorized comparison
    raise NotImplementedError("Change Detection Agent not yet implemented")
