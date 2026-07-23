"""Provenance Agent — Phase 1 skeleton.

Phase 1 scope: open, close, and log provenance records. The full audit
trail (per-stage input checksums, library versions, figure linkage, evidence
panel) is implemented in Phase 4 once all upstream agents exist.

The append-only invariant is enforced at two levels:
1. The PostGIS schema has NO UPDATE / NO DELETE rules on provenance_records.
2. This code never issues UPDATE or DELETE queries on that table.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ProvenanceAgent:
    """Manages the append-only audit ledger for a job.

    Usage (Phase 1):
        agent = ProvenanceAgent(db)
        provenance_id = agent.open_record(job_id, envelope)
        # ... run stages ...
        agent.log_stage(job_id, "raster_analysis", agent_version="v0.1.0",
                        input_checksums={}, parameters={}, output_checksum="sha256:...")
        agent.close_record(job_id, status="complete")
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    def open_record(self, job_id: str, envelope: dict) -> str:
        """Open a new provenance record at job start.

        Returns the provenance_id that links every downstream output
        to this job's audit trail.
        """
        provenance_id = str(uuid4())
        logger.info("Opening provenance record %s for job %s", provenance_id, job_id)

        self._db.execute(
            text(
                """
                UPDATE jobs
                SET started_at = :now
                WHERE id = :job_id
                """
            ),
            {"now": datetime.now(timezone.utc), "job_id": job_id},
        )

        # Log the job-open event as the first provenance record
        self._append_record(
            job_id=job_id,
            stage="job_open",
            agent_version="provenance:v0.1.0",
            input_checksums={"envelope": _dict_checksum(envelope)},
            parameters={
                "municipality_id": envelope.get("municipality_id"),
                "years": envelope.get("years"),
                "dataset_version": envelope.get("dataset_version"),
                "boundary_version": envelope.get("boundary_version"),
            },
            library_versions=_capture_library_versions(),
            crs_used=None,
            runtime_ms=0,
            output_checksum=provenance_id,
        )
        self._db.commit()
        return provenance_id

    def log_stage(
        self,
        job_id: str,
        stage: str,
        agent_version: str,
        input_checksums: dict,
        parameters: dict,
        output_checksum: str,
        crs_used: str | None = None,
        runtime_ms: int = 0,
        library_versions: dict | None = None,
    ) -> None:
        """Append a stage record to the audit ledger.

        Called by each agent after it completes a stage. This is the core
        of the traceability guarantee: every stage's inputs, parameters,
        and outputs are recorded before the next stage runs.
        """
        self._append_record(
            job_id=job_id,
            stage=stage,
            agent_version=agent_version,
            input_checksums=input_checksums,
            parameters=parameters,
            library_versions=library_versions or _capture_library_versions(),
            crs_used=crs_used,
            runtime_ms=runtime_ms,
            output_checksum=output_checksum,
        )
        self._db.commit()

    def close_record(self, job_id: str, status: str) -> None:
        """Mark the job as complete/failed/partial in the jobs table."""
        logger.info("Closing provenance record for job %s (status=%s)", job_id, status)
        self._db.execute(
            text(
                """
                UPDATE jobs
                SET status = :status, completed_at = :now
                WHERE id = :job_id
                """
            ),
            {"status": status, "now": datetime.now(timezone.utc), "job_id": job_id},
        )
        self._append_record(
            job_id=job_id,
            stage="job_close",
            agent_version="provenance:v0.1.0",
            input_checksums={},
            parameters={"final_status": status},
            library_versions={},
            crs_used=None,
            runtime_ms=0,
            output_checksum="",
        )
        self._db.commit()

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _append_record(
        self,
        job_id: str,
        stage: str,
        agent_version: str,
        input_checksums: dict,
        parameters: dict,
        library_versions: dict,
        crs_used: str | None,
        runtime_ms: int,
        output_checksum: str,
    ) -> None:
        self._db.execute(
            text(
                """
                INSERT INTO provenance_records
                    (job_id, stage, agent_version, input_checksums,
                     parameters, library_versions, crs_used,
                     runtime_ms, output_checksum)
                VALUES
                    (:job_id, :stage, :agent_version, :input_checksums,
                     :parameters, :library_versions, :crs_used,
                     :runtime_ms, :output_checksum)
                """
            ),
            {
                "job_id": job_id,
                "stage": stage,
                "agent_version": agent_version,
                "input_checksums": json.dumps(input_checksums),
                "parameters": json.dumps(parameters),
                "library_versions": json.dumps(library_versions),
                "crs_used": crs_used,
                "runtime_ms": runtime_ms,
                "output_checksum": output_checksum,
            },
        )


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _capture_library_versions() -> dict[str, str]:
    """Capture versions of key libraries at runtime for reproducibility."""
    import importlib.metadata

    libs = ["rasterio", "numpy", "geopandas", "shapely", "gdal", "sqlalchemy"]
    versions: dict[str, str] = {}
    for lib in libs:
        try:
            versions[lib] = importlib.metadata.version(lib)
        except importlib.metadata.PackageNotFoundError:
            versions[lib] = "not installed"
    return versions


def _dict_checksum(d: dict) -> str:
    import hashlib
    payload = json.dumps(d, sort_keys=True).encode()
    return "sha256:" + hashlib.sha256(payload).hexdigest()
