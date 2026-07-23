"""Evidence Agent — Celery task stub (Phase 3 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.evidence.tasks.run_evidence", queue="gis")
def run_evidence(self, job_id: str, envelope: dict) -> dict:
    logger.info("Evidence analysis started for job %s", job_id)
    raise NotImplementedError("Evidence Agent not yet implemented")
