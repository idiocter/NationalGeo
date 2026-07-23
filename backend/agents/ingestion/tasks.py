"""Ingestion Agent — Celery task stub (Phase 1 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.ingestion.tasks.run_ingestion_check", queue="gis")
def run_ingestion_check(self, job_id: str, envelope: dict) -> dict:
    """Verify dataset_version is registered; run class-histogram sanity check."""
    logger.info("Ingestion check started for job %s", job_id)
    # TODO Phase 1: implement dataset version lookup + histogram baseline check
    raise NotImplementedError("Ingestion Agent not yet implemented")
