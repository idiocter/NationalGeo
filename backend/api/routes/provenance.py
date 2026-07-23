from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session

router = APIRouter(prefix="/provenance", tags=["provenance"])


@router.get("/figure/{figure_id}")
async def get_figure_provenance(
    figure_id: str, db: AsyncSession = Depends(get_session)
) -> dict:
    """Return the full provenance chain for a figure shown in the UI.

    Enables the 'Show evidence' drill-down: figure → stage → inputs → raw files.
    """
    result = await db.execute(
        text(
            """
            SELECT
                fp.figure_id,
                pr.stage,
                pr.agent_version,
                pr.input_checksums,
                pr.parameters,
                pr.library_versions,
                pr.crs_used,
                pr.runtime_ms,
                pr.output_checksum,
                pr.logged_at
            FROM figure_provenance fp
            JOIN provenance_records pr ON fp.provenance_record_id = pr.id
            WHERE fp.figure_id = :figure_id
            ORDER BY pr.logged_at
            """
        ),
        {"figure_id": figure_id},
    )
    rows = result.mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail=f"No provenance found for figure '{figure_id}'")

    return {
        "figure_id": figure_id,
        "provenance_chain": [dict(r) for r in rows],
    }


@router.get("/jobs/{job_id}/manifest")
async def get_job_manifest(
    job_id: str, db: AsyncSession = Depends(get_session)
) -> dict:
    """Return the reproducibility manifest for a completed job.

    Same inputs + same versions must produce identical output checksums.
    """
    result = await db.execute(
        text(
            """
            SELECT
                pr.stage,
                pr.agent_version,
                pr.input_checksums,
                pr.parameters,
                pr.library_versions,
                pr.crs_used,
                pr.runtime_ms,
                pr.output_checksum,
                pr.logged_at
            FROM provenance_records pr
            WHERE pr.job_id = :job_id
            ORDER BY pr.logged_at
            """
        ),
        {"job_id": job_id},
    )
    rows = result.mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail="No provenance records for this job")

    job_result = await db.execute(
        text("SELECT municipality_id, years, dataset_version, boundary_version FROM jobs WHERE id = :id"),
        {"job_id": job_id},
    )
    job = job_result.mappings().first()

    return {
        "job_id": job_id,
        "municipality_id": job["municipality_id"] if job else None,
        "years": job["years"] if job else None,
        "dataset_version": job["dataset_version"] if job else None,
        "boundary_version": job["boundary_version"] if job else None,
        "stages": [dict(r) for r in rows],
    }


@router.get("/jobs/{job_id}/stages")
async def get_job_stages(
    job_id: str, db: AsyncSession = Depends(get_session)
) -> list[dict]:
    """Return all logged stage records for a job."""
    result = await db.execute(
        text(
            "SELECT stage, agent_version, runtime_ms, output_checksum, logged_at "
            "FROM provenance_records WHERE job_id = :job_id ORDER BY logged_at"
        ),
        {"job_id": job_id},
    )
    return [dict(r) for r in result.mappings().all()]
