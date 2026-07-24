import asyncio
import hashlib
import json
from uuid import uuid4

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session
from backend.config import get_settings
from backend.contracts.models import JobEnvelope

router = APIRouter(tags=["analysis"])
settings = get_settings()


def _cache_key(envelope: JobEnvelope) -> str:
    payload = json.dumps(
        {
            "municipality_id": envelope.municipality_id,
            "years": sorted(envelope.years),
            "dataset_version": envelope.dataset_version,
            "boundary_version": envelope.boundary_version,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


@router.post("/analysis", status_code=202)
async def submit_analysis(
    envelope: JobEnvelope, db: AsyncSession = Depends(get_session)
) -> dict:
    """Submit a land-cover analysis job.

    Returns immediately with a job_id. Stream per-stage progress at
    GET /jobs/{job_id}/stream.
    """
    # Validate municipality exists
    result = await db.execute(
        text("SELECT id FROM municipalities WHERE id = :id"),
        {"id": envelope.municipality_id},
    )
    if result.first() is None:
        raise HTTPException(
            status_code=422, detail=f"Municipality '{envelope.municipality_id}' not found"
        )

    # Check result cache
    cache_key = _cache_key(envelope)
    cached = await db.execute(
        text("SELECT job_id, result FROM result_cache WHERE cache_key = :k"),
        {"k": cache_key},
    )
    hit = cached.first()
    if hit:
        return {"job_id": str(hit.job_id), "status": "complete", "cache_hit": True, "result": hit.result}

    # Create job record
    job_id = str(uuid4())
    await db.execute(
        text(
            """
            INSERT INTO jobs (id, municipality_id, years, requested_outputs,
                              dataset_version, boundary_version, status)
            VALUES (:id, :municipality_id, :years, :outputs, :dataset_version,
                    :boundary_version, 'queued')
            """
        ),
        {
            "id": job_id,
            "municipality_id": envelope.municipality_id,
            "years": envelope.years,
            "outputs": envelope.requested_outputs,
            "dataset_version": envelope.dataset_version,
            "boundary_version": envelope.boundary_version,
        },
    )
    await db.commit()

    # Dispatch to Celery orchestrator — pass cache_key so it can populate result_cache
    from backend.orchestrator.tasks import run_analysis  # noqa: PLC0415
    envelope_dict = envelope.model_dump(mode="json")
    envelope_dict["_cache_key"] = cache_key
    run_analysis.apply_async(
        kwargs={"job_id": job_id, "envelope": envelope_dict},
        task_id=job_id,
        queue="orchestrator",
    )

    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db: AsyncSession = Depends(get_session)) -> dict:
    """Return current job status and result bundle if complete."""
    result = await db.execute(
        text(
            """
            SELECT id, municipality_id, status, result, error,
                   created_at, started_at, completed_at, cache_hit
            FROM jobs WHERE id = :id
            """
        ),
        {"id": job_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str) -> StreamingResponse:
    """Server-Sent Events stream for live per-stage job progress.

    Each event JSON: {"stage": str, "status": str, "pct": int, "job_id": str}
    """

    async def event_generator():
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        channel = f"nglip:job:{job_id}"
        pubsub = r.pubsub()
        await pubsub.subscribe(channel)

        try:
            # Send initial queued event immediately
            yield f"data: {json.dumps({'stage': 'orchestrator', 'status': 'queued', 'pct': 0, 'job_id': job_id})}\n\n"

            async for message in pubsub.listen():
                if message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                    event = json.loads(message["data"])
                    # Close stream when job reaches a terminal stage
                    if event.get("stage") == "complete" or event.get("status") in ("complete", "failed", "partial"):
                        break
                await asyncio.sleep(0)
        finally:
            await pubsub.unsubscribe(channel)
            await r.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
