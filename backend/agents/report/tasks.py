"""Report Agent — Celery task (Phase 4)."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.report.tasks.run_report",
    queue="gis",
    soft_time_limit=120,
    time_limit=150,
)
def run_report(self, job_id: str, envelope: dict) -> dict:
    """Build PDF and XLSX report artefacts."""
    logger.info("Report generation started for job %s", job_id)

    from backend.agents.report.agent import ReportAgent  # noqa: PLC0415

    with get_sync_db() as db:
        agent    = ReportAgent(db)
        artefacts = agent.build(job_id, envelope)

    return {
        "status": "ok",
        "artefacts": list(artefacts.keys()),
    }
