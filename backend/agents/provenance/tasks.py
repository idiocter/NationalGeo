"""Provenance Agent — Celery tasks (Phase 1 skeleton).

Phase 1 implements open/close/log. The full evidence panel and figure-linkage
(Phase 4) are added once Cartography and Narrative agents exist.
"""

from __future__ import annotations

from celery.utils.log import get_task_logger

from backend.agents.provenance.agent import ProvenanceAgent
from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.provenance.tasks.open_record", queue="gis")
def open_record(self, job_id: str, envelope: dict) -> dict:
    """Open a provenance record at job start. Returns the provenance_id."""
    with get_sync_db() as db:
        agent = ProvenanceAgent(db)
        provenance_id = agent.open_record(job_id, envelope)
    return {"provenance_id": provenance_id}


@celery.task(bind=True, name="backend.agents.provenance.tasks.log_stage", queue="gis")
def log_stage(self, job_id: str, stage_data: dict) -> dict:
    """Append a stage record to the audit ledger."""
    with get_sync_db() as db:
        agent = ProvenanceAgent(db)
        agent.log_stage(
            job_id=job_id,
            stage=stage_data["stage"],
            agent_version=stage_data["agent_version"],
            input_checksums=stage_data.get("input_checksums", {}),
            parameters=stage_data.get("parameters", {}),
            output_checksum=stage_data.get("output_checksum", ""),
            crs_used=stage_data.get("crs_used"),
            runtime_ms=stage_data.get("runtime_ms", 0),
        )
    return {"status": "logged"}


@celery.task(bind=True, name="backend.agents.provenance.tasks.close_record", queue="gis")
def close_record(self, job_id: str, status: str) -> dict:
    """Close a provenance record when a job reaches a terminal state."""
    with get_sync_db() as db:
        agent = ProvenanceAgent(db)
        agent.close_record(job_id, status)
    return {"status": "closed"}
