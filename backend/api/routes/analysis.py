import asyncio
import csv
import hashlib
import io
import json
import logging
import zipfile
from pathlib import Path
from uuid import uuid4

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session
from backend.config import get_settings
from backend.contracts.models import CLASS_NAMES, JobEnvelope

logger = logging.getLogger(__name__)
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
    try:
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
    except IntegrityError as exc:
        await db.rollback()
        detail = str(exc.orig) if exc.orig else str(exc)
        if "dataset_version" in detail:
            raise HTTPException(
                status_code=400,
                detail=f"Dataset version '{envelope.dataset_version}' is not registered. "
                       f"Run 'make ingest' to register the COG rasters.",
            )
        if "boundary_version" in detail:
            raise HTTPException(
                status_code=400,
                detail=f"Boundary version '{envelope.boundary_version}' is not registered. "
                       f"Run 'make import-boundaries' then ensure the boundary dataset is registered.",
            )
        raise HTTPException(status_code=400, detail=f"Database constraint violation: {detail}")

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
    """Return current job status and result bundle if complete.

    Returns a flat JobResult envelope: top-level fields from the jobs row merged
    with the contents of result so the frontend can access statistics, artefacts,
    etc. directly without unwrapping a nested 'result' key.
    """
    res = await db.execute(
        text(
            """
            SELECT id, municipality_id, status, result, error,
                   created_at, started_at, completed_at, cache_hit
            FROM jobs WHERE id = :id
            """
        ),
        {"id": job_id},
    )
    row = res.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    job = dict(row)
    nested = job.pop("result") or {}
    # Flatten: merge result payload into the top-level response
    return {"job_id": job["id"], "status": job["status"], **nested}


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
                    # Close stream only on the job-level terminal event
                    # (stage="complete" is published by the orchestrator at the very end).
                    # Individual stage events also carry status="complete" — do NOT break on those.
                    if event.get("stage") == "complete":
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


@router.get("/jobs/{job_id}/report.csv")
async def download_report_csv(job_id: str, db: AsyncSession = Depends(get_session)) -> StreamingResponse:
    """Download a CSV report of land-cover statistics for a completed job."""
    result = await db.execute(
        text("SELECT municipality_id, result FROM jobs WHERE id = :id AND status IN ('complete', 'partial')"),
        {"id": job_id},
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found or not yet complete")

    job_result = row.result or {}
    municipality_id = row.municipality_id
    statistics: list[dict] = job_result.get("statistics", [])
    change_matrices: list[dict] = job_result.get("change_matrix", [])

    buf = io.StringIO()
    writer = csv.writer(buf)

    # Section 1: per-year land-cover statistics
    writer.writerow(["# Nepal Land Cover Statistics", f"Municipality: {municipality_id}"])
    writer.writerow([])
    writer.writerow(["Year", "Class Code", "Class Name", "Area km2", "Share %", "Pixels", "Pixel Area m2", "Nodata %"])
    for stat in sorted(statistics, key=lambda s: s["year"]):
        for cls in sorted(stat["classes"], key=lambda c: c["code"]):
            writer.writerow([
                stat["year"], cls["code"], cls["name"],
                round(cls["area_km2"], 2), round(cls["share_pct"], 2),
                cls["pixels"], stat.get("pixel_area_m2", ""),
                round(stat.get("cloud_or_nodata_pct", 0), 2),
            ])

    if change_matrices:
        writer.writerow([])
        writer.writerow(["# Net Change Summary"])
        writer.writerow(["From Year", "To Year", "Class Code", "Class Name", "Delta km2", "Delta %"])
        for matrix in change_matrices:
            for nc in matrix.get("net_change", []):
                writer.writerow([
                    matrix["from_year"], matrix["to_year"],
                    nc["code"], nc["class_name"],
                    round(nc["delta_km2"], 2), round(nc["delta_pct"], 2),
                ])

        writer.writerow([])
        writer.writerow(["# CAGR (Compound Annual Growth Rate)"])
        writer.writerow(["Class Code", "Class Name", "CAGR %/yr"])
        for matrix in change_matrices[:1]:  # only first matrix has full series CAGR
            for entry in matrix.get("cagr", []):
                writer.writerow([entry["code"], entry["class_name"], round(entry["cagr_pct"], 4)])

    buf.seek(0)
    filename = f"nglip_{municipality_id}_{job_id[:8]}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _resolve_job_for_report(job_id: str, db: AsyncSession) -> tuple[str, dict]:
    """Return (municipality_name, result_dict) for a completed job.

    Looks up the jobs table first; falls back to result_cache so that
    cache-hit job IDs (which may reference old jobs whose files are gone)
    still resolve correctly.
    """
    row = (await db.execute(
        text("""
            SELECT m.name AS municipality_name, j.result
            FROM jobs j
            JOIN municipalities m ON m.id = j.municipality_id
            WHERE j.id = :id AND j.status IN ('complete', 'partial')
        """),
        {"id": job_id},
    )).mappings().first()

    if row is None:
        # Fall back to result_cache (job_id may come from the cache record)
        row = (await db.execute(
            text("""
                SELECT m.name AS municipality_name, rc.result
                FROM result_cache rc
                JOIN municipalities m ON m.id = (rc.result->>'municipality_id')
                WHERE rc.job_id = :id
            """),
            {"id": job_id},
        )).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Job not found or not yet complete")

    return row["municipality_name"] or job_id[:8], row["result"] or {}


# Figures embedded in the PDF. If any is newer than report.pdf, the PDF is
# stale (e.g. maps were re-rendered after a forest-definition change) and must
# be regenerated so it doesn't keep showing the old classification.
_PDF_SOURCE_FIGURES = (
    "comparison_map.png", "change_map.png", "forest_change_4class.png",
    "trend_chart.png", "sankey.png",
)


def _pdf_is_stale(pdf_path: Path, reports_dir: Path) -> bool:
    if not pdf_path.exists():
        return True
    pdf_mtime = pdf_path.stat().st_mtime
    for fname in _PDF_SOURCE_FIGURES:
        fp = reports_dir / fname
        if fp.exists() and fp.stat().st_mtime > pdf_mtime:
            return True
    return False


def _ensure_report_pdf(job_id: str, municipality_name: str, job_result: dict, pdf_path: Path) -> None:
    """(Re)generate the PDF if it is missing or older than the maps it embeds.

    First ensures the map/chart figures exist (regenerating them via the
    cartography renderer if missing), so the rebuilt PDF embeds current maps.
    """
    from backend.agents.report.agent import generate_pdf  # noqa: PLC0415

    reports_dir = pdf_path.parent
    dataset_version = (
        (job_result.get("statistics") or [{}])[0].get("dataset_version") or "landcover-v3.1"
    )
    # Ensure the embedded figures are present (regenerates all maps + charts).
    if not (reports_dir / "forest_change_4class.png").exists():
        try:
            _ensure_figure_file(job_id, "forest_change_4class.png", dataset_version, job_result)
        except Exception as exc:
            logger.warning("Figure regen for PDF failed (%s): %s", job_id, exc)

    if _pdf_is_stale(pdf_path, reports_dir):
        generate_pdf(job_id, municipality_name, job_result, pdf_path)


@router.get("/jobs/{job_id}/report.pdf")
async def download_report_pdf(job_id: str, db: AsyncSession = Depends(get_session)) -> FileResponse:
    """Download PDF report for a completed job.

    Generated on-demand if missing, and regenerated if it is older than the
    map/chart figures it embeds (so a re-render — e.g. after a forest-definition
    change — is reflected instead of serving a stale report).
    """
    municipality_name, job_result = await _resolve_job_for_report(job_id, db)

    pdf_path = Path(settings.object_store_path) / "reports" / job_id / "report.pdf"
    try:
        await run_in_threadpool(_ensure_report_pdf, job_id, municipality_name, job_result, pdf_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}") from exc

    if not pdf_path.exists():
        raise HTTPException(status_code=500, detail="PDF could not be generated")

    return FileResponse(
        str(pdf_path),
        media_type="application/pdf",
        filename=f"nglip_{municipality_name.replace(' ', '_')}_{job_id[:8]}.pdf",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.get("/jobs/{job_id}/report.xlsx")
async def download_report_xlsx(job_id: str, db: AsyncSession = Depends(get_session)) -> FileResponse:
    """Download XLSX report for a completed job.

    Generated on-demand if the file does not exist on disk.
    """
    municipality_name, job_result = await _resolve_job_for_report(job_id, db)

    xlsx_path = Path(settings.object_store_path) / "reports" / job_id / "report.xlsx"
    if not xlsx_path.exists():
        from backend.agents.report.agent import generate_xlsx  # noqa: PLC0415
        try:
            generate_xlsx(job_id, municipality_name, job_result, xlsx_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"XLSX generation failed: {exc}") from exc

    return FileResponse(
        str(xlsx_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"nglip_{municipality_name.replace(' ', '_')}_{job_id[:8]}.xlsx",
    )


# Figures that need only the job result (stats / change matrix) — no COG rasters
_CHART_FIGURES = {"trend_chart.png", "sankey.png"}
# Figures that need the cartography renderer (COG rasters + geometry)
_MAP_FIGURES = {"comparison_map.png", "change_map.png", "forest_change_4class.png"}
_ALLOWED_FIGURES = _CHART_FIGURES | _MAP_FIGURES


def _ensure_figure_file(
    job_id: str, filename: str, dataset_version: str, job_result: dict,
) -> None:
    """Generate a single report figure on-demand if it is missing on disk.

    Charts (trend / Sankey) are rendered directly from the job result.
    Maps run the cartography renderer, which regenerates all map + chart PNGs
    and refreshes the artefact URLs in jobs.result.
    Runs in a threadpool — safe to do blocking I/O / rasterio here.
    """
    out_dir = Path(settings.object_store_path) / "reports" / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / filename
    if target.exists():
        return

    if filename == "trend_chart.png":
        from backend.agents.report.agent import _generate_trend_chart_png  # noqa: PLC0415
        png = _generate_trend_chart_png(job_result.get("statistics", []))
        if png:
            target.write_bytes(png)
        return

    if filename == "sankey.png":
        from backend.agents.report.agent import _generate_sankey_png  # noqa: PLC0415
        png = _generate_sankey_png(job_result.get("change_matrix", []))
        if png:
            target.write_bytes(png)
        return

    # Map figures — render via the cartography agent (also (re)creates charts)
    from backend.agents.cartography.agent import CartographyAgent  # noqa: PLC0415
    from backend.database_sync import get_sync_db  # noqa: PLC0415
    with get_sync_db() as sdb:
        CartographyAgent(sdb).render(job_id, {"dataset_version": dataset_version})


@router.get("/jobs/{job_id}/maps/{filename}")
async def serve_map_file(
    job_id: str, filename: str, db: AsyncSession = Depends(get_session)
) -> FileResponse:
    """Serve a generated report figure PNG, generating it on-demand if missing.

    This lets figures appear for jobs that completed before the figure pipeline
    existed (e.g. cache-hit jobs) without needing to re-run the analysis.
    """
    if filename not in _ALLOWED_FIGURES:
        raise HTTPException(status_code=400, detail=f"Unknown figure file '{filename}'")

    row = (await db.execute(
        text("SELECT dataset_version, result FROM jobs WHERE id = :id"),
        {"id": job_id},
    )).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    map_path = Path(settings.object_store_path) / "reports" / job_id / filename
    if not map_path.exists():
        try:
            await run_in_threadpool(
                _ensure_figure_file,
                job_id, filename,
                row["dataset_version"] or "landcover-v3.1",
                row["result"] or {},
            )
        except Exception as exc:
            logger.warning("On-demand figure generation failed (%s/%s): %s", job_id, filename, exc)

    if not map_path.exists():
        raise HTTPException(status_code=404, detail="Figure could not be generated")

    # no-store: these figures are regenerated when the rendering logic changes
    # (e.g. boundary outline, forest definition) while the URL stays stable, so
    # caching them makes the browser keep serving the old image.
    return FileResponse(
        str(map_path),
        media_type="image/png",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.get("/jobs/{job_id}/download.zip")
async def download_zip(job_id: str, db: AsyncSession = Depends(get_session)) -> StreamingResponse:
    """Download all job outputs (PDF, XLSX, CSV, maps) as a single ZIP archive."""
    from backend.agents.report.agent import generate_xlsx  # noqa: PLC0415

    municipality_name, job_result = await _resolve_job_for_report(job_id, db)

    reports_dir = Path(settings.object_store_path) / "reports" / job_id
    reports_dir.mkdir(parents=True, exist_ok=True)

    # Ensure PDF exists and is current (regenerate if missing or older than its
    # embedded figures) so the zip never bundles a stale report.
    pdf_path = reports_dir / "report.pdf"
    try:
        _ensure_report_pdf(job_id, municipality_name, job_result, pdf_path)
    except Exception as exc:
        logger.warning("PDF generation failed for zip (job %s): %s", job_id, exc)

    # Ensure XLSX exists — generate on-demand if the pipeline stage was skipped or failed
    xlsx_path = reports_dir / "report.xlsx"
    if not xlsx_path.exists():
        try:
            generate_xlsx(job_id, municipality_name, job_result, xlsx_path)
        except Exception as exc:
            logger.warning("XLSX generation failed for zip (job %s): %s", job_id, exc)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add all available output files
        for fname in ["report.pdf", "report.xlsx", "comparison_map.png", "change_map.png", "forest_change_4class.png", "trend_chart.png", "sankey.png"]:
            fpath = reports_dir / fname
            if fpath.exists():
                zf.write(str(fpath), fname)

        # Generate and add CSV inline
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        statistics = job_result.get("statistics", [])
        change_matrices = job_result.get("change_matrix", [])

        writer.writerow(["# NGLIP Land Cover Statistics", f"Municipality: {municipality_name}"])
        writer.writerow([])
        writer.writerow(["Year", "Class Code", "Class Name", "Area km2", "Share %", "Pixels"])
        for stat in sorted(statistics, key=lambda s: s["year"]):
            for cls in sorted(stat["classes"], key=lambda c: c["code"]):
                writer.writerow([
                    stat["year"], cls["code"],
                    CLASS_NAMES.get(cls["code"], cls["name"]),
                    round(cls["area_km2"], 4), round(cls["share_pct"], 3), cls["pixels"],
                ])
        if change_matrices:
            writer.writerow([])
            writer.writerow(["# Net Change"])
            writer.writerow(["From Year", "To Year", "Code", "Class", "Delta km2", "Delta %"])
            for m in change_matrices:
                for nc in m.get("net_change", []):
                    writer.writerow([
                        m["from_year"], m["to_year"], nc["code"],
                        CLASS_NAMES.get(nc["code"], nc["class_name"]),
                        round(nc["delta_km2"], 4), round(nc["delta_pct"], 3),
                    ])
            writer.writerow([])
            writer.writerow(["# Transitions"])
            writer.writerow(["From Year", "To Year", "From Code", "From Class", "To Code", "To Class", "Area km2", "% of Source", "Priority"])
            for m in change_matrices:
                for t in sorted(m.get("transitions", []), key=lambda x: x["area_km2"], reverse=True):
                    writer.writerow([
                        m["from_year"], m["to_year"],
                        t["from_code"], CLASS_NAMES.get(t["from_code"], t["from_class"]),
                        t["to_code"], CLASS_NAMES.get(t["to_code"], t["to_class"]),
                        round(t["area_km2"], 4), round(t["pct_of_source"], 3),
                        "Yes" if t.get("priority_flag") else "No",
                    ])

        zf.writestr("report.csv", csv_buf.getvalue())

        # Add a README
        readme = (
            f"NGLIP — Nepal GeoAI Land Intelligence Platform\n"
            f"Municipality: {municipality_name}\n"
            f"Job ID: {job_id}\n\n"
            f"Files:\n"
            f"  report.pdf         — Full PDF report\n"
            f"  report.xlsx        — Excel workbook (stats + change + transitions + CAGR + evidence)\n"
            f"  report.csv         — CSV data (statistics + net change + transitions)\n"
            f"  comparison_map.png        — Side-by-side land cover comparison map\n"
            f"  change_map.png            — Change detection map\n"
            f"  forest_change_4class.png  — 4-class forest change map (Stable/Loss/Gain)\n"
            f"  trend_chart.png           — Land cover area trend (major/minor classes)\n"
            f"  sankey.png                — Land cover transition (alluvial) diagram\n\n"
            f"All statistics are computed from ICIMOD Nepal Land Cover (SERVIR-HKH).\n"
            f"Projection: EPSG:32645 (UTM Zone 45N, equal-area).\n"
            f"Generated by NGLIP v0.1 — machine-generated output.\n"
        )
        zf.writestr("README.txt", readme)

    buf.seek(0)
    safe_name = municipality_name.replace(" ", "_")
    filename = f"nglip_{safe_name}_{job_id[:8]}.zip"
    return StreamingResponse(
        io.BytesIO(buf.getvalue()),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
