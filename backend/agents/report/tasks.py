"""Report Agent — Celery task stub (Phase 4 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.report.tasks.run_report", queue="report")
def run_report(self, job_id: str, envelope: dict) -> dict:
    logger.info("Report generation started for job %s", job_id)
    raise NotImplementedError("Report Agent not yet implemented")
