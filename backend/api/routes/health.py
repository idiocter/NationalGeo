"""Health and monitoring endpoints (Phase 5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session
from backend.config import get_settings

router = APIRouter(tags=["monitoring"])
settings = get_settings()


@router.get("/health")
async def health_basic() -> dict:
    """Lightweight liveness probe."""
    return {"status": "ok", "version": "0.1.0"}


@router.get("/health/detailed")
async def health_detailed(db: AsyncSession = Depends(get_session)) -> dict:
    """Full readiness check: DB, Redis, queue depths, job stats."""
    result: dict = {"version": "0.1.0"}

    # Database
    try:
        await db.execute(text("SELECT 1"))
        result["db"] = "connected"
    except Exception as exc:
        result["db"] = f"error: {exc}"

    # Redis
    try:
        import redis  # noqa: PLC0415
        r = redis.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        r.close()
        result["redis"] = "connected"
    except Exception as exc:
        result["redis"] = f"error: {exc}"

    # Job stats
    try:
        rows = await db.execute(
            text("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
        )
        counts = {r.status: r.n for r in rows}
        total  = sum(counts.values())

        failed_24h = await db.execute(
            text(
                "SELECT COUNT(*) FROM jobs "
                "WHERE status = 'failed' "
                "AND created_at >= NOW() - INTERVAL '24 hours'"
            )
        )
        total_24h = await db.execute(
            text(
                "SELECT COUNT(*) FROM jobs "
                "WHERE created_at >= NOW() - INTERVAL '24 hours'"
            )
        )
        f24 = failed_24h.scalar() or 0
        t24 = total_24h.scalar() or 1
        result["job_stats"] = {
            "total": total,
            "by_status": counts,
            "failure_rate_24h_pct": round(f24 / t24 * 100, 2),
        }
    except Exception as exc:
        result["job_stats"] = f"error: {exc}"

    # Queue depths via Redis list lengths
    try:
        import redis  # noqa: PLC0415
        r = redis.from_url(settings.redis_url, socket_connect_timeout=2)
        result["queue_depths"] = {
            q: r.llen(q) for q in ["orchestrator", "gis", "celery"]
        }
        r.close()
    except Exception:
        result["queue_depths"] = "unavailable"

    # Overall status
    result["status"] = "ok" if result["db"] == "connected" and result["redis"] == "connected" else "degraded"
    return result
