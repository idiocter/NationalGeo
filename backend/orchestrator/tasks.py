"""Celery tasks for the Orchestrator agent."""

from __future__ import annotations

from celery import Task
from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.orchestrator.service import build_phase2_dag, finalise_job, publish_stage_event

logger = get_task_logger(__name__)

MAX_RETRIES = 2

# Per-stage apply().get() timeouts (seconds).
# Must be ≥ the task's own time_limit to avoid premature caller-side timeout.
_STAGE_TIMEOUTS: dict[str, int] = {
    "ingestion_check": 30,
    "raster_analysis": 300,   # 23 years × windowed COG read
    "change_detection": 150,
    "validation": 30,
}


@celery.task(
    bind=True,
    name="backend.orchestrator.tasks.run_analysis",
    queue="orchestrator",
    soft_time_limit=570,
    time_limit=600,
)
def run_analysis(self: Task, job_id: str, envelope: dict) -> dict:
    """Top-level orchestrator task — dispatches Phase 2 agent stages in order.

    DAG: Ingestion check → Raster Analysis → Change Detection → Validation.

    Each stage is retried up to MAX_RETRIES times before being marked partial.
    The job result (statistics, change_matrix, validation) is accumulated in
    jobs.result by each agent and finalised when all stages complete.
    """
    from backend.agents.change.tasks import run_change_detection  # noqa: PLC0415
    from backend.agents.ingestion.tasks import run_ingestion_check  # noqa: PLC0415
    from backend.agents.provenance.tasks import close_record, open_record  # noqa: PLC0415
    from backend.agents.raster.tasks import run_raster_analysis  # noqa: PLC0415
    from backend.agents.validation.tasks import run_validation  # noqa: PLC0415

    results: dict[str, dict] = {}
    failed_stages: list[str] = []

    publish_stage_event(job_id, "orchestrator", "running", pct=0)

    # Open provenance record before any stage runs.
    # disable_sync_subtasks=False: explicit opt-in for an orchestrator that
    # coordinates subtasks synchronously — avoids Celery 5's default guard
    # against .get() inside a task.
    prov_result = open_record.apply(
        kwargs={"job_id": job_id, "envelope": envelope}
    ).get(timeout=10, disable_sync_subtasks=False)
    provenance_id: str = prov_result.get("provenance_id", "")
    logger.info("Provenance record opened: %s", provenance_id)

    stages = [
        ("ingestion_check", run_ingestion_check),
        ("raster_analysis", run_raster_analysis),
        ("change_detection", run_change_detection),
        ("validation", run_validation),
    ]

    for stage_name, task_fn in stages:
        timeout = _STAGE_TIMEOUTS.get(stage_name, 90)
        publish_stage_event(job_id, stage_name, "running", pct=0)

        succeeded = False
        for attempt in range(1, MAX_RETRIES + 2):
            try:
                result = task_fn.apply(
                    kwargs={"job_id": job_id, "envelope": envelope}
                ).get(timeout=timeout, disable_sync_subtasks=False)
                results[stage_name] = result
                publish_stage_event(job_id, stage_name, "complete", pct=100)
                succeeded = True
                break
            except Exception as exc:
                logger.warning(
                    "Stage %s attempt %d/%d failed: %s",
                    stage_name,
                    attempt,
                    MAX_RETRIES + 1,
                    exc,
                )
                if attempt > MAX_RETRIES:
                    failed_stages.append(stage_name)
                    publish_stage_event(job_id, stage_name, "failed")
                    results[stage_name] = {"error": str(exc)}

        # Raster analysis failure blocks all subsequent stages
        if stage_name == "raster_analysis" and not succeeded:
            logger.error("Raster analysis failed — aborting remaining stages")
            for remaining_stage, _ in stages[stages.index((stage_name, task_fn)) + 1 :]:
                failed_stages.append(remaining_stage)
                publish_stage_event(job_id, remaining_stage, "failed")
                results[remaining_stage] = {"error": "skipped — raster analysis failed"}
            break

    final_status = "partial" if failed_stages else "complete"

    # Retrieve the cache_key the API used for this job so we can populate result_cache
    cache_key: str | None = envelope.get("_cache_key")
    finalise_job(job_id, final_status, cache_key=cache_key)

    close_record.apply(
        kwargs={"job_id": job_id, "status": final_status}
    ).get(timeout=10, disable_sync_subtasks=False)

    publish_stage_event(job_id, "complete", final_status, pct=100)

    return {
        "job_id": job_id,
        "status": final_status,
        "provenance_id": provenance_id,
        "stage_results": results,
        "failed_stages": failed_stages,
    }
