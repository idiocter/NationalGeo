"""Provenance Agent — Celery task stub (Phase 1 skeleton, full in Phase 4)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.provenance.tasks.open_record", queue="gis")
def open_record(self, job_id: str, envelope: dict) -> dict:
    logger.info("Opening provenance record for job %s", job_id)
    raise NotImplementedError("Provenance Agent not yet implemented")


@celery.task(bind=True, name="backend.agents.provenance.tasks.log_stage", queue="gis")
def log_stage(self, job_id: str, stage_data: dict) -> dict:
    logger.info("Logging provenance stage for job %s", job_id)
    raise NotImplementedError("Provenance Agent not yet implemented")
