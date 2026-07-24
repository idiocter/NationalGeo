"""Raster Analysis Agent — Celery task."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.agents.raster.agent import RasterAnalysisAgent
from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.raster.tasks.run_raster_analysis",
    queue="gis",
    soft_time_limit=270,
    time_limit=300,
)
def run_raster_analysis(self, job_id: str, envelope: dict) -> dict:
    """Clip COG per year, mask to municipality, count pixels, convert to equal-area km²."""
    logger.info("Raster analysis started for job %s", job_id)

    with get_sync_db() as db:
        agent = RasterAnalysisAgent(db)
        statistics = agent.analyse_municipality(job_id, envelope)

    return {
        "status": "ok",
        "years_analysed": [s.year for s in statistics],
        "statistics": [s.model_dump(mode="json") for s in statistics],
    }
