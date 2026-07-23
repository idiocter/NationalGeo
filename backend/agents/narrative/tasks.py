"""Narrative Agent — Celery task stub (Phase 4 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.narrative.tasks.run_narrative", queue="narrative")
def run_narrative(self, job_id: str, envelope: dict) -> dict:
    logger.info("Narrative generation started for job %s", job_id)
    raise NotImplementedError("Narrative Agent not yet implemented")
