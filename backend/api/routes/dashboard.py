"""Dashboard route — national overview statistics for the home page (Phase 5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(db: AsyncSession = Depends(get_session)) -> dict:
    """Return national overview: municipality counts, analysis coverage, recent jobs."""

    total_row = await db.execute(text("SELECT COUNT(*) AS n FROM municipalities"))
    total_municipalities = total_row.scalar() or 0

    analyzed_row = await db.execute(
        text(
            "SELECT COUNT(DISTINCT municipality_id) AS n "
            "FROM jobs WHERE status IN ('complete', 'partial')"
        )
    )
    analyzed_count = analyzed_row.scalar() or 0

    # Province breakdown
    province_rows = await db.execute(
        text(
            "SELECT m.province, COUNT(DISTINCT j.municipality_id) AS analyzed, COUNT(DISTINCT m.id) AS total "
            "FROM municipalities m "
            "LEFT JOIN jobs j ON j.municipality_id = m.id AND j.status IN ('complete','partial') "
            "GROUP BY m.province "
            "ORDER BY m.province"
        )
    )
    provinces = [
        {"province": r.province, "analyzed": r.analyzed, "total": r.total}
        for r in province_rows
    ]

    # Recent jobs (last 10)
    recent_rows = await db.execute(
        text(
            "SELECT j.id, m.name AS municipality_name, j.status, "
            "j.created_at, j.completed_at "
            "FROM jobs j JOIN municipalities m ON m.id = j.municipality_id "
            "ORDER BY j.created_at DESC LIMIT 10"
        )
    )
    recent_jobs = [
        {
            "job_id": str(r.id),
            "municipality_name": r.municipality_name,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        }
        for r in recent_rows
    ]

    # Job status distribution
    status_rows = await db.execute(
        text("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
    )
    job_counts = {r.status: r.n for r in status_rows}

    return {
        "total_municipalities": total_municipalities,
        "analyzed_count": analyzed_count,
        "coverage_pct": round(analyzed_count / total_municipalities * 100, 1) if total_municipalities else 0,
        "provinces": provinces,
        "recent_jobs": recent_jobs,
        "job_counts": job_counts,
    }
