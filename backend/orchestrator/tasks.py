"""Celery tasks for the Orchestrator agent."""

from __future__ import annotations

from celery import Task
from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.orchestrator.service import build_phase2_dag, publish_stage_event

logger = get_task_logger(__name__)

MAX_RETRIES = 2


@celery.task(bind=True, name="backend.orchestrator.tasks.run_analysis", queue="orchestrator")
def run_analysis(self: Task, job_id: str, envelope: dict) -> dict:
    """Top-level orchestrator task — dispatches agent stages in order.

    Phase 2 DAG: Ingestion check → Raster Analysis → Change Detection → Validation.
    Retries each stage up to MAX_RETRIES times before marking the job partial.
    """
    from backend.agents.change.tasks import run_change_detection  # noqa: PLC0415
    from backend.agents.raster.tasks import run_raster_analysis  # noqa: PLC0415
    from backend.agents.validation.tasks import run_validation  # noqa: PLC0415

    results: dict[str, dict] = {}
    failed_stages: list[str] = []

    publish_stage_event(job_id, "orchestrator", "running", pct=0)

    stages = [
        ("raster_analysis", run_raster_analysis),
        ("change_detection", run_change_detection),
        ("validation", run_validation),
    ]

    for stage_name, task_fn in stages:
        publish_stage_event(job_id, stage_name, "running", pct=0)
        last_exc = None

        for attempt in range(1, MAX_RETRIES + 2):
            try:
                result = task_fn.apply(kwargs={"job_id": job_id, "envelope": envelope}).get(timeout=90)
                results[stage_name] = result
                publish_stage_event(job_id, stage_name, "complete", pct=100)
                break
            except Exception as exc:
                last_exc = exc
                logger.warning("Stage %s attempt %d failed: %s", stage_name, attempt, exc)
                if attempt > MAX_RETRIES:
                    failed_stages.append(stage_name)
                    publish_stage_event(job_id, stage_name, "failed")
                    results[stage_name] = {"error": str(exc)}

    final_status = "partial" if failed_stages else "complete"
    publish_stage_event(job_id, "complete", final_status, pct=100)

    return {
        "job_id": job_id,
        "status": final_status,
        "results": results,
        "failed_stages": failed_stages,
    }
