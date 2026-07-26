"""Celery tasks for the Orchestrator agent."""

from __future__ import annotations

from celery import Task
from celery.utils.log import get_task_logger

from backend.celery_app import celery
from backend.orchestrator.service import finalise_job, publish_stage_event

logger = get_task_logger(__name__)

MAX_RETRIES = 2

# Per-stage apply().get() timeouts (seconds).
# Must be ≥ the task's own time_limit to avoid premature caller-side timeout.
_STAGE_TIMEOUTS: dict[str, int] = {
    "ingestion_check":  30,
    "raster_analysis": 300,   # 23 years × windowed COG read
    "change_detection": 150,
    "evidence":          90,
    "cartography":      150,
    "narrative":        120,
    "report":           150,
    "validation":        30,
}

# Stages that may fail without blocking the rest of the pipeline
_OPTIONAL_STAGES = frozenset(["evidence", "cartography", "narrative", "report"])


@celery.task(
    bind=True,
    name="backend.orchestrator.tasks.run_analysis",
    queue="orchestrator",
    soft_time_limit=870,
    time_limit=900,
)
def run_analysis(self: Task, job_id: str, envelope: dict) -> dict:
    """Top-level orchestrator.

    DAG (sequential):
      Ingestion check
      → Raster Analysis
      → Change Detection
      → Evidence          (Phase 3 — optional: skips if change_detection failed)
      → Cartography       (Phase 4 — optional: generates static maps for report)
      → Narrative         (Phase 4 — optional: deterministic template + Ollama)
      → Report            (Phase 4 — optional: PDF + XLSX)
      → Validation        (always runs last)

    Optional stages log failures and continue; raster_analysis failure still
    aborts change_detection and all downstream stages.
    """
    from backend.agents.cartography.tasks import run_cartography  # noqa: PLC0415
    from backend.agents.change.tasks import run_change_detection  # noqa: PLC0415
    from backend.agents.evidence.tasks import run_evidence  # noqa: PLC0415
    from backend.agents.ingestion.tasks import run_ingestion_check  # noqa: PLC0415
    from backend.agents.narrative.tasks import run_narrative  # noqa: PLC0415
    from backend.agents.provenance.tasks import close_record, open_record  # noqa: PLC0415
    from backend.agents.raster.tasks import run_raster_analysis  # noqa: PLC0415
    from backend.agents.report.tasks import run_report  # noqa: PLC0415
    from backend.agents.validation.tasks import run_validation  # noqa: PLC0415

    requested = set(envelope.get("requested_outputs", ["stats", "change"]))
    results: dict[str, dict] = {}
    failed_stages: list[str] = []

    publish_stage_event(job_id, "orchestrator", "running", pct=0)

    # Open provenance record before any stage runs.
    # disable_sync_subtasks=False: explicit opt-in for an orchestrator that
    # coordinates subtasks synchronously — avoids Celery 5's default guard.
    prov_result = open_record.apply(
        kwargs={"job_id": job_id, "envelope": envelope}
    ).get(timeout=10, disable_sync_subtasks=False)
    provenance_id: str = prov_result.get("provenance_id", "")
    logger.info("Provenance record opened: %s", provenance_id)

    # Core Phase 2 stages (always run)
    core_stages = [
        ("ingestion_check",  run_ingestion_check),
        ("raster_analysis",  run_raster_analysis),
        ("change_detection", run_change_detection),
    ]

    # Phase 3 + 4 stages (optional, gated on requested_outputs)
    extended_stages: list[tuple[str, object]] = []
    if "change" in requested or "stats" in requested:
        extended_stages.append(("evidence", run_evidence))
    if "maps" in requested:
        extended_stages.append(("cartography", run_cartography))
    if "report" in requested:
        extended_stages.extend([
            ("narrative", run_narrative),
            ("report",    run_report),
        ])

    # Validation always last
    all_stages = core_stages + extended_stages + [("validation", run_validation)]

    core_failed = False

    for stage_name, task_fn in all_stages:
        # Skip downstream if raster_analysis failed
        if core_failed and stage_name not in {"validation"}:
            failed_stages.append(stage_name)
            publish_stage_event(job_id, stage_name, "failed")
            results[stage_name] = {"error": "skipped — raster analysis failed"}
            continue

        timeout    = _STAGE_TIMEOUTS.get(stage_name, 90)
        is_optional = stage_name in _OPTIONAL_STAGES
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
                    stage_name, attempt, MAX_RETRIES + 1, exc,
                )
                if attempt > MAX_RETRIES:
                    failed_stages.append(stage_name)
                    publish_stage_event(job_id, stage_name, "failed")
                    results[stage_name] = {"error": str(exc)}

        if stage_name == "raster_analysis" and not succeeded:
            logger.error("Raster analysis failed — aborting core pipeline")
            core_failed = True

    # A job is "complete" if only optional stages failed; "partial" if core failed
    core_failures = [f for f in failed_stages if f not in _OPTIONAL_STAGES]
    final_status  = "partial" if core_failures else "complete"

    cache_key: str | None = envelope.get("_cache_key")
    finalise_job(job_id, final_status, cache_key=cache_key)

    close_record.apply(
        kwargs={"job_id": job_id, "status": final_status}
    ).get(timeout=10, disable_sync_subtasks=False)

    publish_stage_event(job_id, "complete", final_status, pct=100)

    return {
        "job_id":        job_id,
        "status":        final_status,
        "provenance_id": provenance_id,
        "stage_results": results,
        "failed_stages": failed_stages,
    }
