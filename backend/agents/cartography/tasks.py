"""Cartography Agent — Celery task stub (Phase 4 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.cartography.tasks.run_cartography", queue="gis")
def run_cartography(self, job_id: str, envelope: dict) -> dict:
    logger.info("Cartography started for job %s", job_id)
    raise NotImplementedError("Cartography Agent not yet implemented")
