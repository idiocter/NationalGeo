"""Evidence Agent — Celery task (Phase 3)."""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(
    bind=True,
    name="backend.agents.evidence.tasks.run_evidence",
    queue="gis",
    soft_time_limit=60,
    time_limit=90,
)
def run_evidence(self, job_id: str, envelope: dict) -> dict:
    """Compute evidence statements for top-N transitions in the change matrix."""
    logger.info("Evidence analysis started for job %s", job_id)

    from backend.agents.evidence.agent import EvidenceAgent  # noqa: PLC0415

    with get_sync_db() as db:
        agent      = EvidenceAgent(db)
        statements = agent.analyse(job_id, envelope)

    strong   = sum(1 for s in statements if s.strength == "strong")
    moderate = sum(1 for s in statements if s.strength == "moderate")
    weak     = sum(1 for s in statements if s.strength == "weak")

    return {
        "status": "ok",
        "total": len(statements),
        "strong": strong,
        "moderate": moderate,
        "weak": weak,
    }
