"""Cartography Agent — Celery task (Phase 4)."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.cartography.tasks.run_cartography",
    queue="gis",
    soft_time_limit=120,
    time_limit=150,
)
def run_cartography(self, job_id: str, envelope: dict) -> dict:
    """Render comparison and change map PNGs for the report."""
    logger.info("Cartography started for job %s", job_id)

    from backend.agents.cartography.agent import CartographyAgent  # noqa: PLC0415

    with get_sync_db() as db:
        agent    = CartographyAgent(db)
        artefacts = agent.render(job_id, envelope)

    return {
        "status": "ok",
        "artefact_count": len(artefacts),
        "artefacts": artefacts,
    }
