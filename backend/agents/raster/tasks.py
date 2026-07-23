"""Raster Analysis Agent — Celery task stub (Phase 2 implementation)."""

from celery.utils.log import get_task_logger

from backend.celery_app import celery

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.raster.tasks.run_raster_analysis", queue="gis")
def run_raster_analysis(self, job_id: str, envelope: dict) -> dict:
    """Clip COG, mask, count pixels per class, convert to equal-area km²."""
    logger.info("Raster analysis started for job %s", job_id)
    # TODO Phase 2: implement using rasterio windowed read + numpy bincount
    raise NotImplementedError("Raster Analysis Agent not yet implemented")
