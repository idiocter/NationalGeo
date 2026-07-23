"""Ingestion Agent — Celery tasks.

run_ingestion_check: called by the Orchestrator per-job to verify the requested
  dataset_version is registered and its class-histogram baseline exists.

ingest_dataset: called by the operator CLI (scripts/ingest_rasters.py) to run
  the full ingestion pipeline for a new dataset version.
"""

from __future__ import annotations

from pathlib import Path

from celery.utils.log import get_task_logger

from backend.agents.ingestion.agent import IngestionAgent
from backend.celery_app import celery
from backend.database_sync import get_sync_db

logger = get_task_logger(__name__)


@celery.task(bind=True, name="backend.agents.ingestion.tasks.run_ingestion_check", queue="gis")
def run_ingestion_check(self, job_id: str, envelope: dict) -> dict:
    """Verify the requested dataset_version is registered and has histogram baselines.

    Called by the Orchestrator before dispatching Raster Analysis.
    Returns immediately on success; raises on any missing registration.
    """
    dataset_version = envelope["dataset_version"]
    years = envelope["years"]
    logger.info("Ingestion check for job %s (version=%s)", job_id, dataset_version)

    with get_sync_db() as db:
        from sqlalchemy import text  # noqa: PLC0415

        # Check dataset version is registered
        row = db.execute(
            text("SELECT version FROM datasets WHERE version = :v"),
            {"v": dataset_version},
        ).first()
        if row is None:
            raise ValueError(
                f"Dataset version '{dataset_version}' is not registered. "
                "Run scripts/ingest_rasters.py before submitting analysis jobs."
            )

        # Check histograms exist for all requested years
        missing_years = []
        for year in years:
            h = db.execute(
                text(
                    "SELECT 1 FROM class_histograms "
                    "WHERE dataset_version = :v AND year = :y"
                ),
                {"v": dataset_version, "y": year},
            ).first()
            if h is None:
                missing_years.append(year)

        if missing_years:
            raise ValueError(
                f"Missing class histogram baseline for years: {missing_years} "
                f"in dataset version '{dataset_version}'."
            )

    logger.info("Ingestion check passed for job %s", job_id)
    return {"status": "ok", "dataset_version": dataset_version}


@celery.task(bind=True, name="backend.agents.ingestion.tasks.ingest_dataset", queue="gis")
def ingest_dataset(
    self,
    raster_paths: dict[str, str],  # {year_str: path_str}
    version: str,
    source_url: str = "",
    license: str = "",
    operator_note: str = "",
) -> dict:
    """Run the full ingestion pipeline for a new dataset version.

    Called by scripts/ingest_rasters.py. Not called per-job.
    """
    logger.info("Ingesting dataset version '%s' (%d years)…", version, len(raster_paths))

    paths_by_year = {int(y): Path(p) for y, p in raster_paths.items()}

    with get_sync_db() as db:
        agent = IngestionAgent(db)
        result = agent.ingest_landcover(
            raster_paths=paths_by_year,
            version=version,
            source_url=source_url,
            license=license,
            operator_note=operator_note,
        )

    if not result.success:
        raise RuntimeError(
            f"Ingestion failed for version '{version}':\n"
            + "\n".join(result.errors)
        )

    logger.info(
        "Ingestion complete: %d years, %d COGs",
        len(result.years_ingested),
        len(result.cog_paths),
    )
    return {
        "version": version,
        "years_ingested": result.years_ingested,
        "cog_count": len(result.cog_paths),
    }
